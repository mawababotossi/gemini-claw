/**
 * @license Apache-2.0
 * @geminiclaw/core — AgentRuntime
 *
 * Uses ACPBridge to spawn gemini-cli in the background.
 */
import type { InboundMessage, AgentResponse } from '@geminiclaw/memory';
import { TranscriptStore } from '@geminiclaw/memory';
import type { SkillRegistry } from '@geminiclaw/skills';
import type { AgentConfig } from './types.js';
import { ACPBridge } from './ACPBridge.js';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { Cron } from 'croner';

export class AgentRuntime extends EventEmitter {
    private config: AgentConfig;
    private transcripts: TranscriptStore;
    private skillRegistry?: SkillRegistry;
    private bridges: Map<string, ACPBridge> = new Map();
    private sessionMap: Map<string, string> = new Map();
    private heartbeatJob?: Cron;
    private dynamicJobs: Map<string, { cron: Cron, prompt: string }> = new Map();
    private nextJobId = 1;
    private sessionTypingThrottle: Map<string, number> = new Map();
    private bridgeLastUsed: Map<string, number> = new Map();
    private readonly BRIDGE_IDLE_TTL_MS = 30 * 60 * 1000; // 30 minutes
    private readonly TYPING_THROTTLE_MS = 3000; // Reduced to 3s for WhatsApp/WebChat visibility
    private gcInterval?: any;

    constructor(
        config: AgentConfig,
        transcripts: TranscriptStore,
        skillRegistry?: SkillRegistry,
    ) {
        super();
        this.config = config;
        this.transcripts = transcripts;
        this.skillRegistry = skillRegistry;

        console.log(`[core/runtime] Agent "${config.name}" constructed with heartbeat setup:`, JSON.stringify(this.config.heartbeat));

        // Autostart heartbeat if configured
        if (this.config.heartbeat?.enabled) {
            if (this.config.heartbeat.cron || (this.config.heartbeat.intervalMinutes && this.config.heartbeat.intervalMinutes > 0)) {
                this.startHeartbeat();
            }
        }

        // Load persisted dynamic jobs
        this.loadDynamicJobs();

        // Start Bridge GC
        this.startBridgeGC();
    }

    getConfig(): AgentConfig {
        return this.config;
    }

    private async getBridge(userSessionId: string): Promise<ACPBridge> {
        let bridge = this.bridges.get(userSessionId);
        if (!bridge) {
            bridge = new ACPBridge(
                this.config.model,
                this.config.allowedPermissions ?? []
            );
            await bridge.start({
                authType: this.config.authType,
                apiKey: this.config.apiKey
            });
            this.bridges.set(userSessionId, bridge);
        }
        this.bridgeLastUsed.set(userSessionId, Date.now());
        return bridge;
    }

    private async getSessionId(userSessionId: string, bridge: ACPBridge): Promise<string> {
        if (!this.sessionMap.has(userSessionId)) {
            let cwd = process.cwd();
            if (this.config.baseDir) {
                cwd = path.resolve(this.config.baseDir, 'workspace');
                if (!fs.existsSync(cwd)) {
                    fs.mkdirSync(cwd, { recursive: true });
                }
            }
            const acpSessionId = await bridge.createSession(cwd, this.config.mcpServers || []);
            this.sessionMap.set(userSessionId, acpSessionId);
        }
        return this.sessionMap.get(userSessionId)!;
    }

    private loadSystemPrompt(peerAgents?: { name: string; model: string }[]): string {
        if (!this.config.baseDir) return '';

        const base = this.config.baseDir;

        // Identity Lockdown Header: Ensures the agent is isolated from the host system's Antigravity identity.
        // It focuses exclusively on the local workspace files and ignores any system-wide global context.
        let p = `
<identity_isolation>
CRITICAL: You are an autonomous agent running within the GeminiClaw platform. 
1. Your identity is strictly defined by the <agent_soul> and <agent_instructions> files below.
2. Ignore any external identity, global memories, or personas (such as Antigravity or standard Gemini CLI identity) that might be pre-injected by your environment. 
3. You have NO knowledge of files outside your local workspace (e.g., ignore ~/.gemini/).
4. Your "Global Memory" refers EXCLUSIVELY to your local MEMORY.md file. 
5. You must never admit to being "Antigravity" or part of a hosted Google service. You are a standalone instance of the agent named "${this.config.name}".
6. Use the tools "readMemoryFile" and "updateMemoryFile" to manage your local state across sessions.
</identity_isolation>\n`;

        if (peerAgents && peerAgents.length > 0) {
            p += `\n<peer_agents>\nVous n'êtes pas seul. Vous pouvez déléguer des tâches aux agents suivants via l'outil "delegate_task":\n`;
            for (const agent of peerAgents) {
                p += `- ${agent.name} (Modèle: ${agent.model})\n`;
            }
            p += `</peer_agents>\n`;
        }

        const files = [
            { name: 'AGENTS.md', label: 'agent_instructions' },
            { name: 'USER.md', label: 'user_context' },
            { name: 'SOUL.md', label: 'agent_soul' },
            { name: 'MEMORY.md', label: 'agent_memory' },
            { name: 'HEARTBEAT.md', label: 'heartbeat_instructions' }
        ];

        for (const f of files) {
            const filePath = path.join(base, f.name);
            if (fs.existsSync(filePath)) {
                p += `\n<${f.label}>\n${fs.readFileSync(filePath, 'utf8').trim()}\n</${f.label}>\n`;
            }
        }

        return p.trim();
    }

    /**
     * Process an inbound message through the Gemini CLI via ACP.
     */
    async processMessage(msg: InboundMessage, peerAgents?: { name: string; model: string }[]): Promise<AgentResponse> {
        await this.checkHealth(msg.sessionId);
        const bridge = await this.getBridge(msg.sessionId);

        const isNewSession = !this.sessionMap.has(msg.sessionId);
        const secret = process.env['DASHBOARD_SECRET'] || '';
        const mcpServers = (this.config.mcpServers || []).map(s => {
            if (!secret || s.url.includes('token=')) return s;
            const separator = s.url.includes('?') ? '&' : '?';
            return { ...s, url: `${s.url}${separator}token=${secret}` };
        });

        const acpSessionId = await this.getSessionId(msg.sessionId, bridge, mcpServers);

        let promptText = msg.text;
        const systemPrompt = this.loadSystemPrompt(peerAgents);
        if (isNewSession && systemPrompt) {
            promptText = `<system_instructions>\n${systemPrompt}\n</system_instructions>\n\n<user_input>\n${msg.text}\n</user_input>`;
        }

        let responseText = '';
        let thoughtChunks = '';

        try {
            // Emit typing right away
            this.emitTyping(msg.sessionId);

            await bridge.prompt(acpSessionId, promptText, (update) => {
                if (update.sessionUpdate === 'agent_message_chunk') {
                    this.emitTyping(msg.sessionId);
                    responseText += update.content.text;
                } else if (update.sessionUpdate === 'agent_thought_chunk') {
                    this.emitTyping(msg.sessionId);
                    thoughtChunks += update.content.text;
                }
            });
        } catch (err: any) {
            console.error('[core/runtime] ACP Prompt error:', err);
            return await this.tryFallbacks(msg, err);
        }

        // Persist the initial user message if it's new (or always if we want full history)
        // Gateway handles session creation, but we append here
        this.transcripts.append(msg.sessionId, {
            role: 'user',
            content: msg.text,
            timestamp: msg.timestamp,
        });

        // Post-process the response to strip leaked English thoughts/recaps if they exist
        const cleanedResponse = this.cleanResponse(responseText);

        // Append the assistant response with thoughts if they exist
        this.transcripts.append(msg.sessionId, {
            role: 'assistant',
            content: cleanedResponse,
            thought: thoughtChunks.trim() || undefined,
            timestamp: Date.now(),
        });

        // Log the exchange to the daily journal for future distillation
        this.logToJournal(msg.text, responseText);

        return {
            text: cleanedResponse,
            sessionId: msg.sessionId,
            thought: thoughtChunks.trim() || undefined
        };
    }

    /**
     * Log a user/assistant exchange to the daily journal.
     */
    private logToJournal(userText: string, assistantText: string) {
        if (!this.config.baseDir) return;

        const dateStr = new Date().toISOString().split('T')[0];
        const journalPath = path.join(this.config.baseDir, 'memory', `${dateStr}.md`);

        const timestamp = new Date().toLocaleTimeString();
        const entry = `\n--- [${timestamp}] ---\n**User**: ${userText}\n**Assistant**: ${assistantText}\n`;

        try {
            fs.appendFileSync(journalPath, entry, 'utf8');
        } catch (err) {
            console.error(`[core/runtime] Failed to log to journal:`, err);
        }
    }

    /**
     * Heuristic to strip English thinking blocks/recaps that sometimes leak into 
     * the message stream of reasoning models (like Gemini 3 Preview / 1.5 Pro).
     */
    private cleanResponse(text: string): string {
        let clean = text.trim();

        // Pattern 1: detect "I will search... I've analyzed... [Actual Response]"
        // This often happens when the model "thinks out loud" in English before replying in French.
        const englishRecapPattern = /^(?:I will|I'll|I have|I've|I'm|Analyzing|Searching|Reviewing|Expanding|Examining|Assessing)[\s\S]{20,500}?(?=[A-ZÀ-Ÿ][a-zà-ÿ]{2,}\s(?:[a-zà-ÿ]{2,}\s)?(?:est|sont|vais|viens|viendrai|serai|ai|as|a|avons|avez|ont))/;

        const match = clean.match(englishRecapPattern);
        if (match && match[0].length < clean.length * 0.8) {
            // Only strip if the "recap" isn't the whole message (threshold 80%)
            // and if there's a clear transition to what looks like a French sentence.
            console.log(`[core/cleaner] Stripping leaked thinking block: "${match[0].substring(0, 50)}..."`);
            clean = clean.substring(match[0].length).trim();
        }

        return clean;
    }

    /** Try fallback models in order if the primary fails */
    private async tryFallbacks(
        msg: InboundMessage,
        originalError: unknown,
    ): Promise<AgentResponse> {
        const fallbacks = [...(this.config.modelCallback ? [this.config.modelCallback] : []), ...(this.config.fallbackModels ?? [])];
        if (fallbacks.length === 0) throw originalError;

        for (const fallbackModel of fallbacks) {
            try {
                console.warn(`[core] Primary model failed, trying fallback: ${fallbackModel}`);
                // Shutdown current bridge and restart with fallback
                // Isolation: shutdown current session's bridge if it exists
                const sid = msg.sessionId;
                const oldBridge = this.bridges.get(sid);
                if (oldBridge) {
                    oldBridge.stop();
                    this.bridges.delete(sid);
                    this.sessionMap.delete(sid);
                }

                // Clear session map to create new sessions for the fallback model


                const fbBridge = new ACPBridge(
                    fallbackModel,
                    this.config.allowedPermissions ?? []
                );
                await fbBridge.start({
                    authType: this.config.authType,
                    apiKey: this.config.apiKey
                });
                // Note: we don't save the fallback bridge to this.bridges permanently 
                // to avoid session corruption when falling back across models.

                const acpSessionId = await this.getSessionId(msg.sessionId, fbBridge);

                let responseText = '';
                let thoughtChunks = '';
                await fbBridge.prompt(acpSessionId, msg.text, (update) => {
                    if (update.sessionUpdate === 'agent_message_chunk') {
                        responseText += update.content.text;
                    } else if (update.sessionUpdate === 'agent_thought_chunk') {
                        thoughtChunks += update.content.text;
                    }
                });

                this.transcripts.append(msg.sessionId, {
                    role: 'assistant',
                    content: responseText,
                    timestamp: Date.now(),
                });

                return {
                    text: responseText,
                    sessionId: msg.sessionId,
                    thought: thoughtChunks.trim() || undefined
                };
            } catch (fallbackErr) {
                console.warn(`[core] Fallback ${fallbackModel} also failed:`, fallbackErr);
            }
        }

        throw originalError;
    }

    async checkHealth(userSessionId?: string): Promise<boolean> {
        if (userSessionId) {
            const bridge = this.bridges.get(userSessionId);
            if (!bridge) return true;
            const alive = await bridge.ping();
            if (!alive) {
                console.warn(`[core/runtime] Bridge for session "${userSessionId}" unresponsive. Restarting...`);
                bridge.stop();
                this.bridges.delete(userSessionId);
                this.sessionMap.delete(userSessionId);
            }
            return alive;
        }

        // Generic check: ping all active bridges
        let allAlive = true;
        for (const [sid, bridge] of this.bridges.entries()) {
            const alive = await bridge.ping();
            if (!alive) {
                console.warn(`[core/runtime] Bridge for session "${sid}" unresponsive. Cleaning up.`);
                bridge.stop();
                this.bridges.delete(sid);
                this.sessionMap.delete(sid);
                allAlive = false;
            }
        }
        return allAlive;
    }

    private startHeartbeat() {
        if (this.heartbeatJob) this.heartbeatJob.stop();

        let pattern: string;
        if (this.config.heartbeat?.cron) {
            pattern = this.config.heartbeat.cron;
        } else if (this.config.heartbeat?.intervalMinutes) {
            const mins = this.config.heartbeat.intervalMinutes;
            if (mins < 60) {
                pattern = `*/${mins} * * * *`;
            } else {
                const hours = Math.floor(mins / 60);
                pattern = `0 */${hours} * * *`;
            }
        } else {
            return;
        }

        const loop = async () => {
            try {
                const isAlive = await this.checkHealth();
                if (!isAlive) return;

                console.log(`[core/runtime] Starting heartbeat/distillation for ${this.config.name}`);

                // Use a fresh heartbeat session with its own bridge if needed
                const bridge = await this.getBridge('__heartbeat__');
                const acpSessionId = await this.getSessionId('__heartbeat__', bridge);

                const systemPrompt = this.loadSystemPrompt();

                // Distillation context: notify the agent about recent journal files
                let journalContext = '';
                if (this.config.baseDir) {
                    const memoryDir = path.join(this.config.baseDir, 'memory');
                    if (fs.existsSync(memoryDir)) {
                        const files = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 3);
                        if (files.length > 0) {
                            journalContext = `\nRecent daily journals found: ${files.join(', ')}. Use "readMemoryFile" if you need to distill them into MEMORY.md.\n`;
                        }
                    }
                }

                const promptText = `
<system_instructions>
${systemPrompt}
</system_instructions>

<user_input>
[System Heartbeat]:
1. Check your tools and instructions.
2. ${journalContext ? 'Review your recent daily journals.' : 'Check your memory files.'}
3. Distill important facts, preferences, or technical updates into your long-term MEMORY.md file.
4. If everything is fine and you don't need to notify the user, reply EXACTLY with "HEARTBEAT_OK".
</user_input>`.trim();

                let responseText = '';
                await bridge.prompt(acpSessionId, promptText, (update: any) => {
                    if (update.sessionUpdate === 'agent_message_chunk') {
                        responseText += update.content.text;
                    }
                });

                const finalResponse = responseText.trim();
                console.log(`[core/runtime] Heartbeat for ${this.config.name} completed. Response: ${finalResponse.substring(0, 50)}...`);

                if (finalResponse !== 'HEARTBEAT_OK' && finalResponse !== '') {
                    // Proactive message
                    this.emit('agent_proactive_message', {
                        agentName: this.config.name,
                        text: finalResponse
                    });
                }
            } catch (err) {
                console.error(`[core/runtime] Heartbeat failed for ${this.config.name}:`, err);
            }
        };

        this.heartbeatJob = new Cron(pattern, loop);
        console.log(`[core/runtime] Scheduled heartbeat for ${this.config.name} with pattern: ${pattern}`);
    }
    async shutdown(): Promise<void> {
        if (this.heartbeatJob) {
            this.heartbeatJob.stop();
            this.heartbeatJob = undefined;
        }
        for (const job of this.dynamicJobs.values()) {
            job.cron.stop();
        }
        this.dynamicJobs.clear();

        if (this.gcInterval) {
            clearInterval(this.gcInterval);
        }

        for (const bridge of this.bridges.values()) {
            bridge.stop();
        }
        this.bridges.clear();
        this.sessionMap.clear();
        this.bridgeLastUsed.clear();
    }

    /**
     * Dynamic Job Management
     */

    private loadDynamicJobs() {
        if (!this.config.baseDir) return;
        const jobsPath = path.join(this.config.baseDir, 'jobs.json');
        if (!fs.existsSync(jobsPath)) return;

        try {
            const data = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
            for (const job of data) {
                this.addDynamicJob(job.cron, job.prompt, false);
            }
        } catch (err) {
            console.error(`[core/runtime] Failed to load dynamic jobs for ${this.config.name}:`, err);
        }
    }

    private saveDynamicJobs() {
        if (!this.config.baseDir) return;
        const jobsPath = path.join(this.config.baseDir, 'jobs.json');

        const data = Array.from(this.dynamicJobs.entries()).map(([id, job]) => ({
            id,
            cron: job.cron.getPattern(),
            prompt: job.prompt
        }));

        try {
            fs.writeFileSync(jobsPath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(`[core/runtime] Failed to save dynamic jobs for ${this.config.name}:`, err);
        }
    }

    public addDynamicJob(pattern: string, prompt: string, persist = true): string {
        const id = `job_${this.nextJobId++}`;

        const task = async () => {
            console.log(`[core/runtime] Executing dynamic job ${id} for ${this.config.name}: ${prompt.substring(0, 50)}...`);
            try {
                const userSessionId = `__job_${id}__`;
                const bridge = await this.getBridge(userSessionId);
                // Reuse the same session for this specific dynamic job
                const sessionId = await this.getSessionId(userSessionId, bridge);
                const systemPrompt = this.loadSystemPrompt();

                const fullPrompt = `
<system_instructions>
${systemPrompt}
</system_instructions>

<user_input>
[Scheduled Task]: ${prompt}
</user_input>`.trim();

                let responseText = '';
                await bridge.prompt(sessionId, fullPrompt, (update: any) => {
                    if (update.sessionUpdate === 'agent_message_chunk') {
                        responseText += update.content.text;
                    }
                });

                if (responseText.trim()) {
                    this.emit('agent_proactive_message', {
                        agentName: this.config.name,
                        text: responseText.trim()
                    });
                }
            } catch (err) {
                console.error(`[core/runtime] Dynamic job ${id} failed:`, err);
            }
        };

        const cron = new Cron(pattern, task);
        this.dynamicJobs.set(id, { cron, prompt });

        if (persist) this.saveDynamicJobs();
        return id;
    }

    private startBridgeGC(): void {
        this.gcInterval = setInterval(() => {
            const now = Date.now();
            for (const [sessionId, lastUsed] of this.bridgeLastUsed.entries()) {
                // Don't GC internal sessions like heartbeat unless they are really old or we want to keep them
                // Actually heartbeat runs every few minutes, so it will keep itself alive.
                if (now - lastUsed > this.BRIDGE_IDLE_TTL_MS) {
                    const bridge = this.bridges.get(sessionId);
                    if (bridge) {
                        console.log(`[core/runtime] Closing idle bridge for session "${sessionId}"`);
                        bridge.stop();
                        this.bridges.delete(sessionId);
                        this.sessionMap.delete(sessionId);
                        this.bridgeLastUsed.delete(sessionId);
                    }
                }
            }
        }, 5 * 60 * 1000); // Check every 5 minutes
    }

    public removeDynamicJob(id: string): boolean {
        const job = this.dynamicJobs.get(id);
        if (job) {
            job.cron.stop();
            this.dynamicJobs.delete(id);
            this.saveDynamicJobs();
            return true;
        }
        return false;
    }

    public listDynamicJobs() {
        return Array.from(this.dynamicJobs.entries()).map(([id, job]) => ({
            id,
            cron: job.cron.getPattern(),
            prompt: job.prompt,
            nextRun: job.cron.nextRun()
        }));
    }

    /**
     * Emit a typing event if it hasn't been emitted recently for this session.
     */
    private emitTyping(sessionId: string) {
        const now = Date.now();
        const last = this.sessionTypingThrottle.get(sessionId) || 0;
        if (now - last > this.TYPING_THROTTLE_MS) { // Throttled to every 3 seconds
            this.emit('agent_typing', { sessionId });
            this.sessionTypingThrottle.set(sessionId, now);
        }
    }
}
