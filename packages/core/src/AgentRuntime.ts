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

export class AgentRuntime extends EventEmitter {
    private config: AgentConfig;
    private transcripts: TranscriptStore;
    private skillRegistry?: SkillRegistry;
    private bridge: ACPBridge | null = null;
    private sessionMap: Map<string, string> = new Map();
    private heartbeatTimer?: NodeJS.Timeout;

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
        if (this.config.heartbeat?.enabled && this.config.heartbeat.intervalMinutes > 0) {
            this.startHeartbeat();
        }
    }

    getConfig(): AgentConfig {
        return this.config;
    }

    private async getBridge(): Promise<ACPBridge> {
        if (!this.bridge) {
            this.bridge = new ACPBridge(this.config.model);
            await this.bridge.start();
        }
        return this.bridge;
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

    private loadSystemPrompt(): string {
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
    async process(msg: InboundMessage): Promise<AgentResponse> {
        await this.checkHealth();
        const bridge = await this.getBridge();

        const isNewSession = !this.sessionMap.has(msg.sessionId);
        const acpSessionId = await this.getSessionId(msg.sessionId, bridge);

        let promptText = msg.text;
        const systemPrompt = this.loadSystemPrompt();
        if (isNewSession && systemPrompt) {
            promptText = `<system_instructions>\n${systemPrompt}\n</system_instructions>\n\n<user_input>\n${msg.text}\n</user_input>`;
        }

        let responseText = '';
        let thoughtChunks = '';

        try {
            await bridge.prompt(acpSessionId, promptText, (update) => {

                if (update.sessionUpdate === 'agent_message_chunk') {
                    responseText += update.content.text;
                } else if (update.sessionUpdate === 'agent_thought_chunk') {
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

        return {
            text: cleanedResponse,
            sessionId: msg.sessionId,
            thought: thoughtChunks.trim() || undefined
        };
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
                if (this.bridge) {
                    this.bridge.stop();
                    this.bridge = null;
                }

                // Clear session map to create new sessions for the fallback model
                this.sessionMap.clear();

                const fbBridge = new ACPBridge(fallbackModel);
                await fbBridge.start();
                this.bridge = fbBridge;

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

    async checkHealth(): Promise<boolean> {
        if (!this.bridge) return true;
        const alive = await this.bridge.ping();
        if (!alive) {
            console.warn(`[core/runtime] Agent "${this.config.name}" bridge unresponsive. Restarting...`);
            await this.shutdown();
            this.sessionMap.clear();
        }
        return alive;
    }

    private startHeartbeat() {
        if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
        const interval = this.config.heartbeat!.intervalMinutes * 60000;

        const loop = async () => {
            try {
                const isAlive = await this.checkHealth();
                if (!isAlive) return;

                // Use a fresh heartbeat session every time to ensure context is re-read from scratch
                const bridge = await this.getBridge();
                let cwd = process.cwd();
                if (this.config.baseDir) {
                    cwd = path.resolve(this.config.baseDir, 'workspace');
                    if (!fs.existsSync(cwd)) {
                        fs.mkdirSync(cwd, { recursive: true });
                    }
                }
                const acpSessionId = await bridge.createSession(cwd, this.config.mcpServers || []);

                const systemPrompt = this.loadSystemPrompt();
                const promptText = `<system_instructions>\n${systemPrompt}\n</system_instructions>\n\n<user_input>\n[System]: Execute your heartbeat instructions now. If everything is fine and you don't need to notify the user, reply EXACTLY with "HEARTBEAT_OK".\n</user_input>`;

                let responseText = '';
                await bridge.prompt(acpSessionId, promptText, (update) => {
                    if (update.sessionUpdate === 'agent_message_chunk') {
                        responseText += update.content.text;
                    }
                });

                const finalResponse = responseText.trim();
                console.log(`[core/runtime] Heartbeat for ${this.config.name} completed. Response lengths: ${finalResponse.length}`);

                if (finalResponse !== 'HEARTBEAT_OK' && finalResponse !== '') {
                    // Proactive message
                    this.emit('agent_proactive_message', {
                        agentName: this.config.name,
                        text: finalResponse
                    });
                }
            } catch (err) {
                console.error(`[core/runtime] Heartbeat failed for ${this.config.name}:`, err);
            } finally {
                // Schedule next heartbeat
                this.heartbeatTimer = setTimeout(loop, interval);
            }
        };

        // Start first loop after interval
        this.heartbeatTimer = setTimeout(loop, interval);
        console.log(`[core/runtime] Started heartbeat for ${this.config.name} every ${interval}ms`);
    }

    async shutdown(): Promise<void> {
        if (this.heartbeatTimer) {
            clearTimeout(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
        if (this.bridge) {
            this.bridge.stop();
            this.bridge = null;
        }
    }
}
