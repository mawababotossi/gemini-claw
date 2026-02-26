/**
 * @license Apache-2.0
 * @geminiclaw/gateway — Gateway
 *
 * Central hub. Channel adapters call `ingest()` to submit messages.
 * The Gateway resolves the session, checks ACL, queues the message,
 * calls the appropriate AgentRuntime and dispatches the response.
 */
import type {
    InboundMessage,
    AgentResponse,
    Session,
    ChatMessage,
} from '@geminiclaw/memory';
import { SessionStore, TranscriptStore } from '@geminiclaw/memory';
import { AgentRegistry } from '@geminiclaw/core';
import type { AgentConfig, IGateway } from '@geminiclaw/core';
import { SkillMcpServer, SkillRegistry, type Skill } from '@geminiclaw/skills';
import { Type } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import { resolve } from 'node:path';
import { MessageQueue } from './MessageQueue.js';
import type { GatewayConfig, ChannelConfig } from './types.js';

/** Channel adapters register a send callback so the gateway can reply */
export type SendCallback = (peerId: string, text: string, thought?: string) => Promise<void>;

export class Gateway implements IGateway {
    private sessions: SessionStore;
    private transcripts: TranscriptStore;
    private registry: AgentRegistry;
    private skillRegistry: SkillRegistry;
    public mcpServer: SkillMcpServer;
    private queue: MessageQueue;
    private sendCallbacks = new Map<string, SendCallback>();
    private channelConfigs: Record<string, ChannelConfig> = {};

    constructor(private config: GatewayConfig) {
        this.sessions = new SessionStore(config.dataDir);
        this.transcripts = new TranscriptStore(config.dataDir);
        this.skillRegistry = new SkillRegistry();
        this.mcpServer = new SkillMcpServer(this.skillRegistry);

        // Register a builtin test skill
        this.registerBuiltinSkills();

        const apiPort = config.gatewayPort ?? 3002;
        const localMcpUrl = `http://localhost:${apiPort}/api/mcp/messages`;
        const localMcpServerPrototype = {
            name: 'geminiclaw-skills',
            type: 'sse',
            url: localMcpUrl,
            headers: []
        };

        const agents = (config.agents as AgentConfig[]).map(agent => {
            // Start with a clean list, excluding any existing 'geminiclaw-skills' entries
            // or entries with the same URL, to ensure we only have our correctly formatted one.
            const otherServers = (agent.mcpServers || []).filter(s =>
                s.name !== 'geminiclaw-skills' && s.url !== localMcpUrl
            );

            // Ensure all remaining servers have a 'headers' field (required by recent gemini-cli)
            const mcpServers = [
                localMcpServerPrototype,
                ...otherServers.map(s => ({ ...s, headers: s.headers || [] }))
            ];

            return {
                ...agent,
                mcpServers
            };
        });

        this.registry = new AgentRegistry(
            agents,
            this.transcripts,
            this.skillRegistry,
            config.dataDir
        );
        this.queue = new MessageQueue();
        this.channelConfigs = config.channels ?? {};

        // Bind proactive heartbeat events
        for (const runtime of this.registry.getAll()) {
            runtime.on('agent_proactive_message', async (data: { agentName: string, text: string }) => {
                console.log(`[gateway] Proactive message from ${data.agentName}`);

                const activeSessions = this.sessions.listAll().filter(s => s.agentName === data.agentName);

                for (const session of activeSessions) {
                    this.transcripts.append(session.id, {
                        role: 'assistant',
                        content: data.text,
                        timestamp: Date.now()
                    });

                    await this.send(session.channel, session.peerId, data.text).catch(err => {
                        console.error(`[gateway] Failed to send proactive message to ${session.channel}/${session.peerId}:`, err);
                    });
                }
            });
        }
    }

    private registerBuiltinSkills() {
        const timeSkill: Skill = {
            name: 'getCurrentTime',
            description: 'Get the current time and date. Use this whenever the user asks about the time or date.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    timezone: {
                        type: Type.STRING,
                        description: 'Optional timezone (e.g., "Europe/Paris"). Defaults to local time.',
                    },
                },
            },
            execute: (args) => {
                const tz = (args.timezone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone;
                return {
                    time: new Date().toLocaleString('en-US', { timeZone: tz }),
                    timezone: tz,
                };
            }
        };
        this.skillRegistry.register(timeSkill);
        console.log(`[gateway] Registered builtin skill: getCurrentTime`);

        // Memory File Skills
        const readMemoryFileSkill: Skill = {
            name: 'readMemoryFile',
            description: 'Read the contents of a context or memory file (USER.md, MEMORY.md, SOUL.md, AGENTS.md, or HEARTBEAT.md).',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    filename: {
                        type: Type.STRING,
                        description: 'The name of the file to read.',
                        enum: ['USER.md', 'MEMORY.md', 'SOUL.md', 'AGENTS.md', 'HEARTBEAT.md']
                    },
                    agentName: {
                        type: Type.STRING,
                        description: 'The name of your agent instance (usually "main").'
                    }
                },
                required: ['filename', 'agentName']
            },
            execute: async (args) => {
                const filename = args.filename as string;
                const agentName = args.agentName as string;

                const allowedFiles = ['USER.md', 'MEMORY.md', 'SOUL.md', 'AGENTS.md', 'HEARTBEAT.md'];
                if (!allowedFiles.includes(filename)) {
                    throw new Error(`Can only read: ${allowedFiles.join(', ')}`);
                }

                try {
                    const runtime = this.registry.get(agentName);
                    const baseDir = runtime.getConfig().baseDir;
                    if (!baseDir) throw new Error('Agent has no base directory configured.');

                    const filePath = path.join(baseDir, filename);
                    if (!fs.existsSync(filePath)) {
                        return { content: '', message: `File ${filename} is empty or does not exist.` };
                    }

                    const content = fs.readFileSync(filePath, 'utf8');
                    return { content };
                } catch (err: any) {
                    throw new Error(`Failed to read ${filename}: ${err.message}`);
                }
            }
        };

        const updateMemoryFileSkill: Skill = {
            name: 'updateMemoryFile',
            description: 'Update the contents of a context or memory file (USER.md, MEMORY.md, SOUL.md, AGENTS.md, or HEARTBEAT.md). Use this to evolve your persona or instructions.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    filename: {
                        type: Type.STRING,
                        description: 'The name of the file to update.',
                        enum: ['USER.md', 'MEMORY.md', 'SOUL.md', 'AGENTS.md', 'HEARTBEAT.md']
                    },
                    content: {
                        type: Type.STRING,
                        description: 'The content to write to the file.'
                    },
                    agentName: {
                        type: Type.STRING,
                        description: 'The name of your agent instance (usually "main").'
                    },
                    mode: {
                        type: Type.STRING,
                        description: 'Whether to "overwrite" the entire file or "append" to it. Defaults to "overwrite".',
                        enum: ['overwrite', 'append']
                    }
                },
                required: ['filename', 'content', 'agentName']
            },
            execute: async (args) => {
                const filename = args.filename as string;
                const content = args.content as string;
                const agentName = args.agentName as string;
                const mode = (args.mode as string) || 'overwrite';

                const allowedFiles = ['USER.md', 'MEMORY.md', 'SOUL.md', 'AGENTS.md', 'HEARTBEAT.md'];
                if (!allowedFiles.includes(filename)) {
                    throw new Error(`Can only update: ${allowedFiles.join(', ')}`);
                }

                try {
                    const runtime = this.registry.get(agentName);
                    const baseDir = runtime.getConfig().baseDir;
                    if (!baseDir) throw new Error('Agent has no base directory configured.');

                    const filePath = path.join(baseDir, filename);
                    if (mode === 'append') {
                        fs.appendFileSync(filePath, '\n' + content);
                    } else {
                        fs.writeFileSync(filePath, content);
                    }
                    return { success: true, message: `Successfully updated ${filename}` };
                } catch (err: any) {
                    throw new Error(`Failed to update ${filename}: ${err.message}`);
                }
            }
        };

        this.skillRegistry.register(readMemoryFileSkill);
        this.skillRegistry.register(updateMemoryFileSkill);
        console.log(`[gateway] Registered builtin memory skills: readMemoryFile, updateMemoryFile`);
    }

    /**
     * Channel adapters register themselves here so the gateway can
     * route responses back to the correct channel.
     */
    registerChannel(channelName: string, sendFn: SendCallback): void {
        this.sendCallbacks.set(channelName, sendFn);
        console.log(`[gateway] Channel registered: ${channelName}`);
    }

    /**
     * Main entry point for all channel adapters.
     * Ingest a message → resolve session → ACL check → queue → reply.
     */
    async ingest(
        channel: string,
        peerId: string,
        text: string,
        attachments?: InboundMessage['attachments'],
    ): Promise<void> {
        // ACL check
        if (!this.isAuthorized(channel, peerId)) {
            console.warn(`[gateway] Unauthorized: channel=${channel} peer=${peerId}`);
            return;
        }

        // Resolve agent for this channel
        const channelConfig = this.channelConfigs[channel];
        const agentName = channelConfig?.agent ?? 'main';

        // Get or create session
        const session: Session = this.sessions.getOrCreate(
            channel,
            peerId,
            agentName,
        );
        this.sessions.touch(session.id);

        const msg: InboundMessage = {
            sessionId: session.id,
            channel,
            peerId,
            text,
            attachments,
            timestamp: Date.now(),
        };

        const runtime = this.registry.get(agentName);

        // Dispatch through per-session queue (FIFO)
        let response: AgentResponse;
        try {
            response = await this.queue.enqueue(msg, runtime);
        } catch (err) {
            console.error(`[gateway] Runtime error for session ${session.id}:`, err);
            await this.send(channel, peerId, '⚠️ An error occurred. Please try again.');
            return;
        }

        // Send the response back via the channel adapter
        await this.send(channel, peerId, response.text, response.thought);
    }

    /** Send a message out via a registered channel send callback */
    async send(channel: string, peerId: string, text: string, thought?: string): Promise<void> {
        const sendFn = this.sendCallbacks.get(channel);
        if (!sendFn) {
            console.warn(`[gateway] No send callback for channel: ${channel}`);
            return;
        }
        await sendFn(peerId, text, thought);
    }

    /** Get all active sessions */
    listSessions(): Session[] {
        return this.sessions.listAll();
    }

    /** Load historical messages for a specific peer on a channel */
    getTranscript(channel: string, peerId: string): ChatMessage[] {
        const session = this.sessions.findByChannelAndPeer(channel, peerId);
        if (!session) return [];
        return this.transcripts.load(session.id);
    }

    // ── Agent Management ───────────────────────────────────────────────────────

    listAgents(): AgentConfig[] {
        return this.registry.listConfigs();
    }

    listAvailableModels(): string[] {
        const models = new Set<string>();
        for (const provider of this.config.providers) {
            if (provider.models) {
                provider.models.forEach(m => models.add(m));
            }
        }
        return Array.from(models);
    }

    async addAgent(config: AgentConfig): Promise<void> {
        this.registry.add(config);
        await this.saveConfig();
    }

    async updateAgent(name: string, config: AgentConfig): Promise<void> {
        await this.registry.update(name, config);
        await this.saveConfig();
    }

    async removeAgent(name: string): Promise<void> {
        await this.registry.remove(name);
        await this.saveConfig();
    }

    private async saveConfig(): Promise<void> {
        // We need to rebuild the full config to save it
        // This is a bit simplified, we assume the original config path is available
        const configPath = process.env['CONFIG_PATH'] ?? './config/geminiclaw.json';
        const absPath = resolve(configPath);

        const newConfigs = this.registry.listConfigs();

        // Load original file to preserve channels/cron
        const { readFileSync } = await import('node:fs');
        const raw = readFileSync(absPath, 'utf8');
        const parsed = JSON.parse(raw);

        parsed.agents = newConfigs;

        fs.writeFileSync(absPath, JSON.stringify(parsed, null, 4), 'utf8');
        console.log(`[gateway] Configuration persisted to ${configPath}`);
    }

    async shutdown(): Promise<void> {
        await this.registry.shutdown();
        this.sessions.close();
    }

    // ── ACL ────────────────────────────────────────────────────────────────────

    private isAuthorized(channel: string, peerId: string): boolean {
        const cfg = this.channelConfigs[channel];
        if (!cfg) return true; // No config = open (dev mode)

        // Telegram: check allowedUserIds
        if ('allowedUserIds' in cfg && Array.isArray(cfg.allowedUserIds)) {
            if (cfg.allowedUserIds.length === 0) return true; // empty = allow all
            return cfg.allowedUserIds.map(String).includes(peerId);
        }

        // WhatsApp: check allowedJids
        if ('allowedJids' in cfg && Array.isArray(cfg.allowedJids)) {
            if (cfg.allowedJids.length === 0) return true;
            return cfg.allowedJids.includes(peerId);
        }

        return true;
    }
}
