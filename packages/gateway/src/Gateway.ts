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
import type { AgentConfig, IGateway, ActivityType, ProjectConfig, ProviderConfig } from '@geminiclaw/core';
import { SkillMcpServer, SkillRegistry, type Skill } from '@geminiclaw/skills';
import { Type } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import { resolve } from 'node:path';
import { MessageQueue } from './MessageQueue.js';
import type { GatewayConfig, ChannelConfig } from './types.js';

/** Channel adapters register a send callback so the gateway can reply */
export type SendCallback = (peerId: string, text: string, thought?: string) => Promise<void>;
export type ActivityCallback = (peerId: string, type: ActivityType) => Promise<void>;

export class Gateway implements IGateway {
    private sessions: SessionStore;
    private transcripts: TranscriptStore;
    public registry: AgentRegistry;
    private skillRegistry: SkillRegistry;
    public mcpServer: SkillMcpServer;
    private queue: MessageQueue;
    private sendCallbacks = new Map<string, SendCallback>();
    private activityCallbacks = new Map<string, ActivityCallback>();
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

            runtime.on('agent_typing', async (data: { sessionId: string }) => {
                const session = this.sessions.get(data.sessionId);
                console.log(`[gateway-debug] agent_typing event for session ${data.sessionId}, channel=${session?.channel}`);
                if (session && this.activityCallbacks.has(session.channel)) {
                    console.log(`[gateway-debug] Calling activityCallback for peer ${session.peerId}`);
                    await this.activityCallbacks.get(session.channel)!(session.peerId, 'typing');
                }
            });
        }
    }

    registerChannel(
        channel: string,
        sendCallback: SendCallback,
        activityCallback?: ActivityCallback
    ): void {
        this.sendCallbacks.set(channel, sendCallback);
        if (activityCallback) {
            this.activityCallbacks.set(channel, activityCallback);
        }
        console.log(`[gateway] Registered channel: ${channel}`);
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

        const delegateTaskSkill: Skill = {
            name: 'delegate_task',
            description: 'Delegate a complex task to another AI agent. Use this to leverage specialized agents.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    agentName: {
                        type: Type.STRING,
                        description: 'The name of the agent to delegate to (e.g., "main", "researcher").',
                    },
                    task: {
                        type: Type.STRING,
                        description: 'The prompt or task description to send to the other agent.',
                    },
                },
                required: ['agentName', 'task'],
            },
            execute: async (args) => {
                const targetAgent = args.agentName as string;
                const task = args.task as string;

                try {
                    const runtime = this.registry.get(targetAgent);
                    // We create a "virtual" message for the delegation
                    const response = await runtime.processMessage({
                        sessionId: `delegation_${Date.now()}`,
                        channel: 'gateway-internal',
                        peerId: 'supervisor',
                        text: task,
                        timestamp: Date.now()
                    });

                    return {
                        success: true,
                        agent: targetAgent,
                        response: response.text,
                        thought: response.thought
                    };
                } catch (err: any) {
                    throw new Error(`Delegation to ${targetAgent} failed: ${err.message}`);
                }
            }
        };

        const scheduleTaskSkill: Skill = {
            name: 'schedule_task',
            description: 'Schedule a recurring task for yourself using a cron expression.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    agentName: {
                        type: Type.STRING,
                        description: 'The name of your agent (usually "main").'
                    },
                    cron: {
                        type: Type.STRING,
                        description: 'A standard cron expression (e.g., "0 8 * * *" for every morning at 8am).'
                    },
                    prompt: {
                        type: Type.STRING,
                        description: 'The prompt to execute at the scheduled time.'
                    }
                },
                required: ['agentName', 'cron', 'prompt']
            },
            execute: async (args) => {
                const agentName = args.agentName as string;
                const cron = args.cron as string;
                const prompt = args.prompt as string;
                const runtime = this.registry.get(agentName);
                const id = runtime.addDynamicJob(cron, prompt);
                return { success: true, jobId: id, message: `Task scheduled with pattern: ${cron}` };
            }
        };

        const listTasksSkill: Skill = {
            name: 'list_tasks',
            description: 'List all your active scheduled recurring tasks.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    agentName: { type: Type.STRING, description: 'The name of your agent.' }
                },
                required: ['agentName']
            },
            execute: async (args) => {
                const agentName = args.agentName as string;
                const runtime = this.registry.get(agentName);
                return { tasks: runtime.listDynamicJobs() };
            }
        };

        const removeTaskSkill: Skill = {
            name: 'remove_task',
            description: 'Remove a scheduled recurring task by its ID.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    agentName: { type: Type.STRING, description: 'The name of your agent.' },
                    jobId: { type: Type.STRING, description: 'The ID of the job to remove (e.g., "job_1").' }
                },
                required: ['agentName', 'jobId']
            },
            execute: async (args) => {
                const agentName = args.agentName as string;
                const jobId = args.jobId as string;
                const runtime = this.registry.get(agentName);
                const success = runtime.removeDynamicJob(jobId);
                return { success, message: success ? `Job ${jobId} removed.` : `Job ${jobId} not found.` };
            }
        };

        const listAgentsSkill: Skill = {
            name: 'list_agents',
            description: 'List all other available agents in the system you can delegate tasks to.',
            parameters: {
                type: Type.OBJECT,
                properties: {},
                required: []
            },
            execute: async () => {
                const agents = this.registry.listConfigs().map(a => ({
                    name: a.name,
                    model: a.model,
                    description: `Agent ${a.name} running ${a.model}`
                }));
                return { agents };
            }
        };

        this.skillRegistry.register(readMemoryFileSkill);
        this.skillRegistry.register(updateMemoryFileSkill);
        this.skillRegistry.register(delegateTaskSkill);
        this.skillRegistry.register(scheduleTaskSkill);
        this.skillRegistry.register(listTasksSkill);
        this.skillRegistry.register(removeTaskSkill);
        this.skillRegistry.register(listAgentsSkill);
        console.log(`[gateway] Registered scheduler & discovery skills: schedule_task, list_tasks, remove_task, list_agents`);
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
        metadata?: Record<string, any>
    ): Promise<void> {
        // ACL check
        if (!this.isAuthorized(channel, peerId, metadata)) {
            console.warn(`[gateway] Unauthorized: channel=${channel} peer=${peerId}`);
            return;
        }

        // Mirroring: If the owner speaks on one channel, show it on the other
        if (this.isOwner(channel, peerId, metadata)) {
            if (channel === 'webchat') {
                // User spoke on WebChat -> Mirror to WhatsApp as a "Note to self"
                const ownerJid = this.getOwnerJid();
                if (ownerJid) {
                    console.log(`[gateway-mirror] WebChat activity -> Mirroring to WhatsApp (${ownerJid})`);
                    await this.send('whatsapp', ownerJid, text);
                }
            } else if (channel === 'whatsapp') {
                // User spoke on WhatsApp (Note to self) -> Mirror to all WebChat clients
                console.log(`[gateway-mirror] WhatsApp activity -> Mirroring to WebChat`);
                await this.broadcastToWebChat({ type: 'message', from: 'user', text });
            }
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

        // Prepare peer context (discovery)
        const peerAgents = this.registry.listConfigs()
            .filter(a => a.name !== agentName)
            .map(a => ({ name: a.name, model: a.model }));

        // Dispatch through per-session queue (FIFO)
        let response: AgentResponse;
        try {
            response = await this.queue.enqueue(msg, runtime, peerAgents);
        } catch (err) {
            console.error(`[gateway] Runtime error for session ${session.id}:`, err);
            await this.send(channel, peerId, '⚠️ An error occurred. Please try again.');
            return;
        }

        // Send the response back via the channel adapter
        await this.send(channel, peerId, response.text, response.thought);

        // Mirroring Agent Response: If we replied to the owner, notify the other channel too
        if (this.isOwner(channel, peerId, metadata)) {
            if (channel === 'webchat') {
                const ownerJid = this.getOwnerJid();
                if (ownerJid) {
                    console.log(`[gateway-mirror] Agent replied to WebChat -> Syncing to WhatsApp`);
                    await this.send('whatsapp', ownerJid, response.text);
                }
            } else if (channel === 'whatsapp') {
                console.log(`[gateway-mirror] Agent replied to WhatsApp -> Syncing to WebChat`);
                await this.broadcastToWebChat({ type: 'message', from: 'assistant', text: response.text, thought: response.thought });
            }
        }
    }

    /** Send a message out via a registered channel send callback */
    async send(channel: string, peerId: string, text: string, thought?: string): Promise<void> {
        console.log(`[gateway-debug] Attempting to send message to channel=${channel}, peerId=${peerId}`);
        const sendFn = this.sendCallbacks.get(channel);
        if (!sendFn) {
            console.warn(`[gateway] No send callback for channel: ${channel}`);
            return;
        }
        console.log(`[gateway-debug] Found send callback for channel=${channel}. Calling it...`);
        await sendFn(peerId, text, thought);
        console.log(`[gateway-debug] Send Fn for ${channel} returned.`);
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
        parsed.channels = this.channelConfigs;

        const tmpPath = absPath + '.tmp';
        try {
            fs.writeFileSync(tmpPath, JSON.stringify(parsed, null, 4), 'utf8');
            fs.renameSync(tmpPath, absPath);
            console.log(`[gateway] Configuration persisted atomically to ${configPath}`);
        } catch (err) {
            console.error(`[gateway] Failed to save configuration:`, err);
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            throw err;
        }
    }

    // ── Channel Management ───────────────────────────────────────────────────────

    getChannelConfig(name: string): ChannelConfig | undefined {
        return this.channelConfigs[name];
    }

    async updateChannelConfig(name: string, config: Partial<ChannelConfig>): Promise<void> {
        const current = this.channelConfigs[name];
        if (!current) throw new Error(`Channel ${name} not found`);

        this.channelConfigs[name] = { ...current, ...config };
        this.config.channels[name] = this.channelConfigs[name];
        await this.saveConfig();
        console.log(`[gateway] Channel ${name} updated.`);
    }

    getProjectConfig(): ProjectConfig {
        return this.config.project;
    }

    async updateProjectConfig(project: Partial<ProjectConfig>): Promise<void> {
        this.config.project = { ...this.config.project, ...project };
        await this.saveConfig();
        console.log(`[gateway] Project config updated: ${this.config.project.name}`);
    }

    getProviders(): ProviderConfig[] {
        return this.config.providers;
    }

    async updateProviders(providers: ProviderConfig[]): Promise<void> {
        this.config.providers = providers;
        await this.saveConfig();
        console.log(`[gateway] Providers updated. Count: ${providers.length}`);
    }

    getGlobalConfig(): GatewayConfig {
        return this.config;
    }

    async shutdown(): Promise<void> {
        await this.registry.shutdown();
        this.sessions.close();
    }

    // ── ACL ────────────────────────────────────────────────────────────────────

    private isAuthorized(channel: string, peerId: string, metadata?: Record<string, any>): boolean {
        // Always authorize messages sent from the bot owner/self
        if (metadata?.fromMe === true) return true;

        const cfg = this.channelConfigs[channel];
        if (!cfg) {
            if (process.env['NODE_ENV'] === 'development') {
                console.warn(`[gateway/acl] DEV MODE: allowing unconfigured channel="${channel}"`);
                return true;
            }
            console.warn(`[gateway/acl] DENIED: channel="${channel}" has no config. Set NODE_ENV=development to allow.`);
            return false;
        }

        // Telegram: check allowedUserIds
        if ('allowedUserIds' in cfg && Array.isArray(cfg.allowedUserIds)) {
            if (cfg.allowedUserIds.length === 0) return true; // empty = allow all
            return cfg.allowedUserIds.map(String).includes(peerId);
        }

        // WhatsApp: check allowList, default to phoneNumber, reject all others
        if (channel === 'whatsapp') {
            const hasAllowList = 'allowList' in cfg && Array.isArray(cfg.allowList) && cfg.allowList.length > 0;
            const normalizedPeer = peerId.split('@')[0].split(':')[0];

            if (hasAllowList) {
                return cfg.allowList!.includes(normalizedPeer);
            }

            // Fallback to strict host number
            if ('phoneNumber' in cfg && cfg.phoneNumber) {
                return normalizedPeer === cfg.phoneNumber;
            }

            // Default deny if WhatsApp is enabled but no auth config exists
            return false;
        }

        return true;
    }

    private getOwnerJid(): string | undefined {
        const waCfg = this.channelConfigs['whatsapp'];
        if (waCfg?.phoneNumber) {
            const num = waCfg.phoneNumber;
            return num.includes('@') ? num : `${num}@s.whatsapp.net`;
        }
        return undefined;
    }

    private isOwner(channel: string, peerId: string, metadata?: Record<string, any>): boolean {
        if (channel === 'webchat') {
            const configuredOwnerId = this.config.ownerWebChatClientId;
            return !!configuredOwnerId && peerId === configuredOwnerId;
        }
        if (channel === 'whatsapp') {
            const ownerJid = this.getOwnerJid();
            if (!ownerJid) return false;
            const normOwner = ownerJid.split('@')[0];
            const normPeer = peerId.split('@')[0].split(':')[0];
            return normOwner === normPeer;
        }
        return false;
    }

    private async broadcastToWebChat(msg: any): Promise<void> {
        // Special peerId convention or just bypass the map if the adapter supports it
        // For now, let's use a special peerId "__BROADCAST__"
        await this.send('webchat', '__BROADCAST__', JSON.stringify(msg));
    }
}
