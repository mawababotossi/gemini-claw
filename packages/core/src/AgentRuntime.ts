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
import { StreamingBuffer } from './StreamingBuffer.js';

export class AgentRuntime extends EventEmitter {
    private config: AgentConfig;
    private transcripts: TranscriptStore;
    private skillRegistry?: SkillRegistry;
    private bridges: Map<string, ACPBridge> = new Map();
    private sessionMap: Map<string, string> = new Map();
    private heartbeatJob?: Cron;
    private dynamicJobs: Map<string, { cron: Cron, prompt: string, target?: { channel: string, peerId: string } }> = new Map();
    private nextJobId = 1;
    private sessionTypingThrottle: Map<string, number> = new Map();
    private bridgeLastUsed: Map<string, number> = new Map();
    private readonly BRIDGE_IDLE_TTL_MS = 30 * 60 * 1000; // 30 minutes
    private readonly TYPING_THROTTLE_MS = 3000; // Reduced to 3s for WhatsApp/WebChat visibility
    private gcInterval?: any;
    private _status: NonNullable<AgentConfig['status']> = 'Healthy';

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

    getStatus(): AgentConfig['status'] {
        return this._status;
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

    private async getSessionId(userSessionId: string, bridge: ACPBridge, mcpServers: any[] = []): Promise<string> {
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
2. **IMPORTANT**: The XML tags below (\`<agent_soul>\`, \`<user_context>\`, \`<agent_instructions>\`, \`<agent_memory>\`) contain the **current content** of your core memory files. 
3. **DO NOT** use tools to read these files again in this turn. Use the content provided below directly.
4. Ignore any external identity, global memories, or personas (such as Antigravity or standard Gemini CLI identity) that might be pre-injected by your environment. 
5. You have NO knowledge of files outside your local workspace (e.g., ignore ~/.gemini/).
6. Your "Global Memory" refers EXCLUSIVELY to your local MEMORY.md file (provided in \`<agent_memory>\`). 
7. You must never admit to being "Antigravity" or part of a hosted Google service. You are a standalone instance of the agent named "${this.config.name}".
</identity_isolation>\n`;

        if (peerAgents && peerAgents.length > 0) {
            p += `\n<peer_agents>\nVous n'êtes pas seul. Vous pouvez déléguer des tâches aux agents suivants via l'outil "delegate_task":\n`;
            for (const agent of peerAgents) {
                p += `- ${agent.name} (Modèle: ${agent.model})\n`;
            }
            p += `</peer_agents>\n`;
        }

        const files = [
            { name: 'IDENTITY.md', label: 'agent_identity' },
            { name: 'SOUL.md', label: 'agent_soul' },
            { name: 'AGENTS.md', label: 'agent_instructions' },
            { name: 'TOOLS.md', label: 'tools_notes' },
            { name: 'USER.md', label: 'user_context' },
            { name: 'MEMORY.md', label: 'agent_memory' },
            { name: 'HEARTBEAT.md', label: 'heartbeat_instructions' }
        ];

        for (const f of files) {
            const filePath = path.join(base, f.name);
            if (fs.existsSync(filePath)) {
                p += `\n<${f.label}>\n${fs.readFileSync(filePath, 'utf8').trim()}\n</${f.label}>\n`;
            }
        }

        // Inject prompt-driven skills from registry
        if (this.skillRegistry) {
            // Skill prompt block (OpenClaw style)
            const skillsBlock = this.skillRegistry.getPromptBlock(this.config.skills);
            if (skillsBlock) {
                p += skillsBlock;
            }
        }

        return p.trim();
    }

    /**
     * Process an inbound message through the Gemini CLI via ACP.
     */
    async processMessage(
        msg: InboundMessage,
        peerAgents?: { name: string; model: string }[],
        options?: { onChunk?: (text: string) => Promise<void> }
    ): Promise<AgentResponse> {
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

        // OpenClaw-inspired robust typing: refresh indicator every 3s to prevent timeout
        const typingInterval = setInterval(() => {
            this.emitTyping(msg.sessionId);
        }, this.TYPING_THROTTLE_MS);

        // Buffer pour le streaming
        const streamingBuffer = options?.onChunk
            ? new StreamingBuffer(options.onChunk, 300)
            : null;

        try {
            // Emit typing right away
            this.emitTyping(msg.sessionId);

            await bridge.prompt(acpSessionId, promptText, async (update) => {
                if (update.sessionUpdate === 'agent_message_chunk') {
                    this.emitTyping(msg.sessionId);
                    responseText += update.content.text;
                    streamingBuffer?.append(update.content.text);
                } else if (update.sessionUpdate === 'agent_thought_chunk') {
                    this.emitTyping(msg.sessionId);
                    if (thoughtChunks.length < 30000) {
                        thoughtChunks += update.content.text;
                    }
                }
            });

            await streamingBuffer?.flushNow();
        } catch (err: any) {
            streamingBuffer?.destroy();
            console.error('[core/runtime] ACP Prompt error:', err);
            return await this.tryFallbacks(msg, err);
        } finally {
            clearInterval(typingInterval);
        }

        // Persist the initial user message if it's new (or always if we want full history)
        // Gateway handles session creation, but we append here
        this.transcripts.append(msg.sessionId, {
            role: 'user',
            content: msg.text,
            timestamp: msg.timestamp,
        });

        // Post-process the response to strip leaked English thoughts/recaps if they exist
        const { cleanText: cleanedResponse, thought: finalThought } = this.separateThoughtFromResponse(
            responseText,
            thoughtChunks.trim()
        );

        // Append the assistant response with thoughts if they exist
        this.transcripts.append(msg.sessionId, {
            role: 'assistant',
            content: cleanedResponse,
            thought: finalThought || undefined,
            timestamp: Date.now(),
        });

        // Log the exchange to the daily journal for future distillation
        this.logToJournal(msg.text, responseText);

        this._status = 'Healthy';

        return {
            text: cleanedResponse,
            sessionId: msg.sessionId,
            thought: finalThought || undefined,
            streamed: streamingBuffer !== null
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
     * Extrait et sépare proprement une éventuelle fuite de la chaîne de pensée
     * depuis le stream de réponse. Retourne { cleanText, thought }.
     * 
     * Cette approche est plus robuste car elle cherche des marqueurs structurels
     * communs à tous les modèles de raisonnement, indépendamment de la langue.
     */
    private separateThoughtFromResponse(
        responseText: string,
        existingThought: string
    ): { cleanText: string; thought: string } {
        let clean = responseText.trim();
        let thought = existingThought.trim();

        // Si l'ACP a déjà correctement séparé la pensée dans thought_chunks,
        // ne pas toucher au responseText — il est déjà propre.
        if (thought.length > 0) {
            return { cleanText: clean, thought };
        }

        // Cas : le modèle n'a PAS utilisé le stream thought_chunk (modèles non-reasoning)
        // mais a quand même injecté des balises XML de réflexion dans le stream principal.

        // Pattern 1 : balises <think>...</think> (certains modèles open-source)
        const thinkTagMatch = clean.match(/^<think>([\s\S]*?)<\/think>\s*/i);
        if (thinkTagMatch) {
            thought = thinkTagMatch[1].trim();
            clean = clean.slice(thinkTagMatch[0].length).trim();
            return { cleanText: clean, thought };
        }

        // Pattern 2 : bloc entre --- ou === souvent utilisé pour séparer la réflexion
        const separatorMatch = clean.match(/^([\s\S]{10,800}?)(?:\n[-=]{3,}\n)([\s\S]+)$/);
        if (separatorMatch && separatorMatch[2].length > 20) {
            thought = separatorMatch[1].trim();
            clean = separatorMatch[2].trim();
            return { cleanText: clean, thought };
        }

        // Pattern 3 : préfixe de pensée suivi d'un paragraphe distinct
        const lines = clean.split('\n');
        if (lines.length > 3) {
            const firstParagraphEnd = lines.findIndex((l, i) => i > 0 && l.trim() === '');
            if (firstParagraphEnd > 0 && firstParagraphEnd < lines.length - 2) {
                const firstParagraph = lines.slice(0, firstParagraphEnd).join('\n');
                const rest = lines.slice(firstParagraphEnd + 1).join('\n').trim();

                // Si le premier paragraphe ressemble à de la pensée (contient des verbes d'action)
                const thinkingVerbPattern = /\b(?:I will|I'll|let me|I need to|analyzing|searching|je vais|je dois|analysons|vérifions|checking|reviewing)\b/i;
                if (thinkingVerbPattern.test(firstParagraph) && rest.length > 50) {
                    thought = firstParagraph.trim();
                    clean = rest.trim();
                    console.log(`[core/cleaner] Extracted thought from response body: "${thought.substring(0, 60)}..."`);
                    return { cleanText: clean, thought };
                }
            }
        }

        return { cleanText: clean, thought };
    }

    /** Try fallback models in order if the primary fails */
    private async tryFallbacks(
        msg: InboundMessage,
        originalError: unknown,
    ): Promise<AgentResponse> {
        const fallbacks = [...(this.config.modelCallback ? [this.config.modelCallback] : []), ...(this.config.fallbackModels ?? [])];
        if (fallbacks.length === 0) {
            this._status = 'Dead';
            throw originalError;
        }

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

                const { cleanText: finalResponse, thought: finalThought } = this.separateThoughtFromResponse(
                    responseText,
                    thoughtChunks.trim()
                );

                this.transcripts.append(msg.sessionId, {
                    role: 'assistant',
                    content: finalResponse,
                    thought: finalThought || undefined,
                    timestamp: Date.now(),
                });

                this._status = 'Healthy';

                return {
                    text: finalResponse,
                    sessionId: msg.sessionId,
                    thought: finalThought || undefined
                };
            } catch (fallbackErr) {
                console.warn(`[core] Fallback ${fallbackModel} also failed:`, fallbackErr);
            }
        }

        this._status = 'Dead';
        throw originalError;
    }

    async checkHealth(userSessionId?: string): Promise<boolean> {
        if (userSessionId) {
            const bridge = this.bridges.get(userSessionId);
            if (!bridge) return true;
            const alive = await bridge.ping();
            if (!alive) {
                console.warn(`[core/runtime] Bridge for session "${userSessionId}" unresponsive. Restarting...`);
                this._status = 'Unresponsive';
                bridge.stop();
                this.bridges.delete(userSessionId);
                this.sessionMap.delete(userSessionId);
            } else {
                this._status = 'Healthy';
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

        if (!allAlive) {
            this._status = 'Unresponsive';
        } else {
            this._status = 'Healthy';
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

                this._status = 'Healthy';
            } catch (err) {
                console.error(`[core/runtime] Heartbeat failed for ${this.config.name}:`, err);
                this._status = 'Unresponsive';
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
                this.addDynamicJob(job.cron, job.prompt, false, job.target);
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
            prompt: job.prompt,
            target: job.target
        }));

        try {
            fs.writeFileSync(jobsPath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(`[core/runtime] Failed to save dynamic jobs for ${this.config.name}:`, err);
        }
    }

    public addDynamicJob(pattern: string, prompt: string, persist = true, target?: { channel: string, peerId: string }): string {
        const id = `job_${this.nextJobId++}`;

        const task = async () => {
            console.log(`[core/runtime] Executing dynamic job ${id} for ${this.config.name}: ${prompt.substring(0, 50)}...`);
            try {
                const userSessionId = target ? `__job_${target.channel}_${target.peerId}__` : `__job_${id}__`;
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
                        text: responseText.trim(),
                        target
                    });
                }
            } catch (err) {
                console.error(`[core/runtime] Dynamic job ${id} failed:`, err);
            }
        };

        const cron = new Cron(pattern, task);
        this.dynamicJobs.set(id, { cron, prompt, target });

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
            target: job.target,
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
