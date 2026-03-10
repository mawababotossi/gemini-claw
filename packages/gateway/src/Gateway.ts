/**
 * @license Apache-2.0
 * @clawgate/gateway — Gateway
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
    OutboundAttachment,
} from '@clawgate/memory';
import { SessionStore, TranscriptStore } from '@clawgate/memory';
import { AgentRegistry } from '@clawgate/core';
import type { AgentConfig, IGateway, ActivityType, ProjectConfig, ProviderConfig } from '@clawgate/core';
import { SkillMcpServer, SkillRegistry, type Skill } from '@clawgate/skills';
import { Type } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MessageQueue } from './MessageQueue.js';
import type { GatewayConfig, ChannelConfig, CronJob } from './types.js';
import { NodeManager } from './NodeManager.js';
import type { WebSocket } from 'ws';

const MIRROR_PEER_ID = 'dashboard_owner';

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
    private sendFileCallbacks = new Map<string, (peerId: string, att: OutboundAttachment) => Promise<void>>();
    private activityCallbacks = new Map<string, ActivityCallback>();
    private channelConfigs: Record<string, ChannelConfig> = {};
    private nodeManager: NodeManager;
    private waConnected = false;

    constructor(private config: GatewayConfig) {
        this.sessions = new SessionStore(config.dataDir);
        this.transcripts = new TranscriptStore(config.dataDir);

        const localSkillsPath = path.join(config.dataDir, 'skills');
        this.skillRegistry = new SkillRegistry([localSkillsPath], config.dataDir);

        this.nodeManager = new NodeManager(this.skillRegistry, process.env['NODE_SECRET']);

        this.mcpServer = new SkillMcpServer(this.skillRegistry);

        // Register a builtin test skill
        this.registerBuiltinSkills();

        const apiPort = config.gatewayPort ?? 3002;
        const localMcpUrl = `http://localhost:${apiPort}/api/mcp/messages`;
        const makeMcpServerEntry = () => ({
            name: 'clawgate-skills',
            type: 'sse',
            url: localMcpUrl,
            headers: [] as { name: string; value: string }[]
        });

        const agents = (config.agents as AgentConfig[]).map(agent => {
            // Start with a clean list, excluding any existing 'clawgate-skills' entries
            // or entries with the same URL, to ensure we only have our correctly formatted one.
            const otherServers = (agent.mcpServers || []).filter(s =>
                s.name !== 'clawgate-skills' && s.url !== localMcpUrl
            );

            // Ensure all remaining servers have a 'headers' field in the correct [{name, value}] format
            const mcpServers = [
                makeMcpServerEntry(),
                ...otherServers.map(s => {
                    const headerMap: Record<string, string> = {};
                    if (Array.isArray(s.headers)) {
                        s.headers.forEach((h: any) => {
                            if (Array.isArray(h) && h.length === 2) {
                                headerMap[h[0]] = h[1];
                            } else if (h && typeof h === 'object' && h.name && h.value) {
                                headerMap[h.name] = h.value;
                            }
                        });
                    } else if (s.headers && typeof s.headers === 'object') {
                        Object.assign(headerMap, s.headers);
                    }
                    return {
                        ...s,
                        headers: Object.entries(headerMap).map(([name, value]) => ({ name, value: String(value) }))
                    };
                })
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
            runtime.on('agent_proactive_message', async (data: { agentName: string, text: string, target?: { channel: string, peerId: string } }) => {
                console.log(`[gateway] Proactive message from ${data.agentName}${data.target ? ` for ${data.target.channel}/${data.target.peerId}` : ''}`);

                let text = data.text;
                let target = data.target;

                // Handle Announce Protocol: "announce (channel -> peerId): message"
                const announceMatch = text.match(/^announce\s*\(([^)]+)\s*->\s*([^)]+)\)\s*:\s*([\s\S]+)$/i);
                if (announceMatch) {
                    target = {
                        channel: announceMatch[1].trim().toLowerCase(),
                        peerId: announceMatch[2].trim()
                    };
                    text = announceMatch[3].trim();
                    console.log(`[gateway] Announce protocol detected: routing to ${target.channel}/${target.peerId}`);
                }

                if (target) {
                    // Targeted delivery
                    this.transcripts.append(`${target.channel}_${target.peerId}_internal`, {
                        role: 'assistant',
                        content: text,
                        timestamp: Date.now()
                    });

                    await this.send(target.channel, target.peerId, text).catch(err => {
                        console.error(`[gateway] Failed to send targeted proactive message to ${target!.channel}/${target!.peerId}:`, err);
                    });
                } else {
                    // Broadcast to active sessions
                    const activeSessions = this.sessions.listAll().filter(s => s.agentName === data.agentName);
                    for (const session of activeSessions) {
                        this.transcripts.append(session.id, {
                            role: 'assistant',
                            content: text,
                            timestamp: Date.now()
                        });

                        await this.send(session.channel, session.peerId, text).catch(err => {
                            console.error(`[gateway] Failed to send proactive message to ${session.channel}/${session.peerId}:`, err);
                        });
                    }
                }
            });

            runtime.on('agent_typing', async (data: { sessionId: string }) => {
                const session = this.sessions.get(data.sessionId);
                console.log(`[gateway-debug] agent_typing event for session ${data.sessionId}, channel=${session?.channel}`);
                if (session && this.activityCallbacks.has(session.channel)) {
                    console.log(`[gateway-debug] Calling activityCallback for peer ${session.peerId}`);
                    await this.activityCallbacks.get(session.channel)!(session.peerId, 'typing');
                }

                // Mirroring: If typing for the owner on any channel, show it on WebChat too
                if (session && this.isOwner(session.channel, session.peerId)) {
                    // Mirror to WebChat
                    if (session.channel !== 'webchat') {
                        console.log(`[gateway-mirror] Agent typing on ${session.channel} -> Mirroring to WebChat`);
                        const webchatHandler = this.activityCallbacks.get('webchat');
                        if (webchatHandler) {
                            await webchatHandler('__BROADCAST__', 'typing');
                        }
                    }
                    // Mirror to WhatsApp
                    else {
                        if (this.waConnected) {
                            const ownerJid = this.getOwnerJid();
                            if (ownerJid) {
                                console.log(`[gateway-mirror] Agent typing on WebChat -> Mirroring to WhatsApp (${ownerJid})`);
                                const whatsappHandler = this.activityCallbacks.get('whatsapp');
                                if (whatsappHandler) {
                                    await whatsappHandler(ownerJid, 'typing').catch(() => { });
                                }
                            }
                        }
                    }
                }
            });
        }

        // Initialize global cron jobs
        this.setupConfigCronJobs();
    }

    private setupConfigCronJobs() {
        if (!this.config.cron || this.config.cron.length === 0) return;

        console.log(`[gateway] Initializing ${this.config.cron.length} global cron jobs...`);
        for (const job of (this.config.cron as CronJob[])) {
            try {
                const runtime = this.registry.get(job.agentName);
                let target;
                if (job.delivery) {
                    const parts = job.delivery.split('->');
                    if (parts.length === 2) {
                        const channel = parts[0].trim().toLowerCase();
                        const peerId = parts[1].trim();
                        target = { channel, peerId };
                    }
                }
                runtime.addDynamicJob(job.cron, job.prompt, false, target);
                console.log(`[gateway] Scheduled global job: ${job.cron} (agent: ${job.agentName}${target ? `, target: ${target.channel}/${target.peerId}` : ''})`);
            } catch (err: any) {
                console.error(`[gateway] Failed to setup global cron job:`, err.message);
            }
        }
    }

    registerChannel(
        channel: string,
        sendCallback: SendCallback,
        activityCallback?: ActivityCallback,
        sendFileCallback?: (peerId: string, att: OutboundAttachment) => Promise<void>
    ): void {
        this.sendCallbacks.set(channel, sendCallback);
        if (activityCallback) {
            this.activityCallbacks.set(channel, activityCallback);
        }
        if (sendFileCallback) {
            this.sendFileCallbacks.set(channel, sendFileCallback);
        }
        console.log(`[gateway] Registered channel: ${channel}`);
    }

    public handleNodeConnection(ws: WebSocket): void {
        this.nodeManager.handleConnection(ws);
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
            },
            kind: 'native'
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
                    const runtime = this.registry.get(agentName)!;
                    const baseDir = runtime.getConfig().baseDir;
                    if (!baseDir) throw new Error('Agent has no base directory configured.');

                    const filePath = path.join(baseDir, 'workspace', filename);
                    if (!fs.existsSync(filePath)) {
                        return { content: '', message: `File ${filename} is empty or does not exist.` };
                    }

                    const content = fs.readFileSync(filePath, 'utf8');
                    return { content };
                } catch (err: any) {
                    throw new Error(`Failed to read ${filename}: ${err.message}`);
                }
            },
            kind: 'native'
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
                    const runtime = this.registry.get(agentName)!;
                    const baseDir = runtime.getConfig().baseDir;
                    if (!baseDir) throw new Error('Agent has no base directory configured.');

                    const filePath = path.join(baseDir, 'workspace', filename);
                    if (mode === 'append') {
                        fs.appendFileSync(filePath, '\n' + content);
                    } else {
                        fs.writeFileSync(filePath, content);
                    }
                    return { success: true, message: `Successfully updated ${filename}` };
                } catch (err: any) {
                    throw new Error(`Failed to update ${filename}: ${err.message}`);
                }
            },
            kind: 'native'
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
            },
            kind: 'native'
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
                    },
                    channel: {
                        type: Type.STRING,
                        description: 'Optional channel to deliver the result to (e.g., "whatsapp").'
                    },
                    peerId: {
                        type: Type.STRING,
                        description: 'Optional peerId to deliver the result to (e.g., your phone number).'
                    }
                },
                required: ['agentName', 'cron', 'prompt']
            },
            execute: async (args) => {
                const agentName = args.agentName as string;
                const cron = args.cron as string;
                const prompt = args.prompt as string;
                const channel = args.channel as string;
                const peerId = args.peerId as string;
                const runtime = this.registry.get(agentName);

                let target;
                if (channel && peerId) {
                    target = { channel, peerId };
                }

                const id = runtime.addDynamicJob(cron, prompt, true, target);
                return { success: true, jobId: id, message: `Task scheduled with pattern: ${cron}${target ? ` for ${channel}/${peerId}` : ''}` };
            },
            kind: 'native'
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
            },
            kind: 'native'
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
            },
            kind: 'native'
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
            },
            kind: 'native'
        };

        const readSkillSkill: Skill = {
            name: 'read_skill',
            description: 'Read the full instructions (SKILL.md) for a specialized skill when its description matches the task.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    name: {
                        type: Type.STRING,
                        description: 'The name of the skill to read (e.g. "github", "food-order").'
                    }
                },
                required: ['name']
            },
            execute: async (args) => {
                const name = args.name as string;
                try {
                    const skill = this.skillRegistry.getAllPromptSkills().find(s => s.name === name);
                    if (!skill) {
                        throw new Error(`Skill not found: ${name}`);
                    }

                    const location = skill.path;
                    const resolvedPath = path.resolve(location);

                    // Security check: must be within one of the authorized skill directories
                    const skillLoader = this.skillRegistry.getSkillMdLoader();
                    const skillDirs = skillLoader?.getSkillDirs() || [];
                    const isAllowed = skillDirs.some(dir => resolvedPath.startsWith(path.resolve(dir) + path.sep));

                    if (!isAllowed) {
                        console.warn(`[gateway/security] read_skill: Unauthorized access attempt to "${resolvedPath}"`);
                        throw new Error(`Access denied: path is outside of authorized skill directories.`);
                    }

                    // Security check: must be a SKILL.md file
                    if (path.basename(resolvedPath) !== 'SKILL.md') {
                        throw new Error(`Only SKILL.md files can be read via read_skill.`);
                    }

                    if (!fs.existsSync(resolvedPath)) {
                        throw new Error(`Skill file not found at: ${resolvedPath}`);
                    }

                    const content = fs.readFileSync(resolvedPath, 'utf8');
                    return { content };
                } catch (err: any) {
                    throw new Error(`Failed to read skill: ${err.message}`);
                }
            }
        };

        const readHostFileSkill: Skill = {
            name: 'read_host_file',
            description: 'Read any file on the host system, following symbolic links. Use this ONLY if the standard read_file fails due to workspace restrictions.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    path: { type: Type.STRING, description: 'The absolute path to the file.' }
                },
                required: ['path']
            },
            execute: async (args) => {
                const filePath = args.path as string;
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    return { content };
                } catch (err: any) {
                    throw new Error(`Failed to read file: ${err.message}`);
                }
            },
            kind: 'native'
        };

        const writeHostFileSkill: Skill = {
            name: 'write_host_file',
            description: 'Write to any file on the host system, following symbolic links. Use this ONLY when write_file fails due to workspace restrictions (e.g., when writing to a shared chat.md symlink).',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    path: {
                        type: Type.STRING,
                        description: 'The absolute path to the file to write.'
                    },
                    content: {
                        type: Type.STRING,
                        description: 'The content to write to the file.'
                    },
                    mode: {
                        type: Type.STRING,
                        description: '"overwrite" (default) or "append".',
                        enum: ['overwrite', 'append']
                    }
                },
                required: ['path', 'content']
            },
            execute: async (args) => {
                const filePath = args.path as string;
                const content = args.content as string;
                const mode = (args.mode as string) || 'overwrite';
                try {
                    if (mode === 'append') {
                        fs.appendFileSync(filePath, content, 'utf8');
                    } else {
                        fs.writeFileSync(filePath, content, 'utf8');
                    }
                    return { success: true, path: filePath };
                } catch (err: any) {
                    throw new Error(`Failed to write file: ${err.message}`);
                }
            },
            kind: 'native'
        };

        this.skillRegistry.register(readMemoryFileSkill);
        this.skillRegistry.register(updateMemoryFileSkill);
        this.skillRegistry.register(readHostFileSkill);
        this.skillRegistry.register(writeHostFileSkill);
        this.skillRegistry.register(delegateTaskSkill);
        this.skillRegistry.register(scheduleTaskSkill);
        this.skillRegistry.register(listTasksSkill);
        this.skillRegistry.register(removeTaskSkill);
        this.skillRegistry.register(listAgentsSkill);
        this.skillRegistry.register(readSkillSkill);
        const declarations = this.skillRegistry.getDeclarations() || [];
        console.log(`[gateway] Registered builtin skills: ${declarations.map(d => d.name).join(', ')}`);
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
        const isOwner = this.isOwner(channel, peerId, metadata);
        console.log(`[gateway-mirror] Checking owner status: channel=${channel}, peerId=${peerId}, isOwner=${isOwner}`);

        if (isOwner) {
            if (channel === 'webchat') {
                // User spoke on WebChat -> Mirror to WhatsApp as a "Note to self"
                if (this.waConnected) {
                    const ownerJid = this.getOwnerJid();
                    if (ownerJid) {
                        console.log(`[gateway-mirror] WebChat activity -> Mirroring to WhatsApp (${ownerJid})`);
                        await this.send('whatsapp', ownerJid, text).catch(() => { });
                    }
                } else {
                    console.log(`[gateway-mirror] Skipping WebChat -> WhatsApp mirror: WhatsApp not connected`);
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
            const isWhatsApp = channel === 'whatsapp';
            const isWhatsAppMirror = channel === 'webchat' && this.waConnected && isOwner;
            const skipStreamingForThisChannel = isWhatsApp || isWhatsAppMirror;

            let streamChunkFn: ((text: string) => Promise<void>) | undefined;

            if (!skipStreamingForThisChannel) {
                streamChunkFn = async (text: string) => {
                    await this.send(channel, peerId, text);

                    // Mirroring if owner
                    if (isOwner) {
                        if (channel === 'whatsapp') {
                            await this.broadcastToWebChat({ type: 'message', from: 'assistant', text });
                        } else if (channel === 'webchat' && this.waConnected) {
                            const ownerJid = this.getOwnerJid();
                            if (ownerJid) await this.send('whatsapp', ownerJid, text).catch(() => { });
                        }
                    }
                };
            }

            response = await this.queue.enqueue(msg, runtime, peerAgents, {
                onChunk: streamChunkFn,
                silentBuffer: skipStreamingForThisChannel
            } as any);
        } catch (err) {
            console.error(`[gateway] Runtime error for session ${session.id}:`, err);
            await this.send(channel, peerId, '⚠️ An error occurred. Please try again.');
            return;
        }

        // Final response (if not streamed)
        if (!response.streamed) {
            await this.send(channel, peerId, response.text, response.thought);
        }

        // Finalize mirrored thought for owners if streamed
        if (response.streamed && response.thought && this.isOwner(channel, peerId, metadata)) {
            if (channel === 'whatsapp') {
                await this.broadcastToWebChat({ type: 'message', from: 'assistant', text: '', thought: response.thought });
            }
        }

        // Send generated files (for BOTH streamed and non-streamed responses)
        if (response.outboundAttachments?.length) {
            await this.sendFiles(channel, peerId, response.outboundAttachments);

            // Mirroring if owner
            if (this.isOwner(channel, peerId, metadata)) {
                for (const att of response.outboundAttachments) {
                    if (channel === 'whatsapp') {
                        // Mirror WhatsApp files to WebChat
                        await this.sendFile('webchat', '__BROADCAST__', att);
                    } else if (channel === 'webchat' && this.waConnected) {
                        // Mirror WebChat files to WhatsApp
                        const ownerJid = this.getOwnerJid();
                        if (ownerJid) await this.sendFile('whatsapp', ownerJid, att).catch(() => { });
                    }
                }
            }
        }

        // Mirroring Agent Response: If we replied to the owner, notify the other channel too
        if (this.isOwner(channel, peerId, metadata) && !response.streamed) {
            if (channel === 'webchat' && this.waConnected) {
                const ownerJid = this.getOwnerJid();
                if (ownerJid) {
                    console.log(`[gateway-mirror] Agent replied to WebChat -> Syncing to WhatsApp`);
                    await this.send('whatsapp', ownerJid, response.text).catch(() => { });
                }
            } else if (channel === 'whatsapp') {
                console.log(`[gateway-mirror] Agent replied to WhatsApp -> Syncing to WebChat`);
                await this.broadcastToWebChat({ type: 'message', from: 'assistant', text: response.text, thought: response.thought });
            }
        }
    }

    /** Send a message out via a registered channel send callback */
    async send(channel: string, peerId: string, text: string, thought?: string): Promise<void> {
        if (!text || !text.trim()) {
            if (!thought) {
                console.log(`[gateway-debug] Skipping empty message/thought for channel=${channel}`);
                return;
            }
        }
        console.log(`[gateway-debug] Attempting to send message to channel=${channel}, peerId=${peerId}`);
        const sendFn = this.sendCallbacks.get(channel);
        if (!sendFn) {
            console.warn(`[gateway] No send callback for channel: ${channel}`);
            return;
        }
        await sendFn(peerId, text, thought);
    }

    /** Send a single file via a registered channel send callback */
    private async sendFile(
        channel: string,
        peerId: string,
        att: OutboundAttachment
    ): Promise<void> {
        const sendFileFn = this.sendFileCallbacks.get(channel);
        if (!sendFileFn) {
            console.warn(`[gateway] No file send callback for channel: ${channel}`);
            return;
        }
        try {
            await sendFileFn(peerId, att);
            console.log(`[gateway] File sent: ${att.filename} → ${channel}/${peerId}`);
        } catch (err) {
            console.error(`[gateway] Failed to send file ${att.filename} to ${channel}/${peerId}:`, err);
        }
    }

    /** Send files via a registered channel send callback */
    async sendFiles(
        channel: string,
        peerId: string,
        attachments: OutboundAttachment[]
    ): Promise<void> {
        for (const att of attachments) {
            await this.sendFile(channel, peerId, att);
        }
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

    /** Called by server.ts when WhatsApp connection state changes */
    setWhatsAppConnected(connected: boolean): void {
        this.waConnected = connected;
        console.log(`[gateway] WhatsApp mirror: ${connected ? 'ENABLED' : 'DISABLED'}`);
    }

    // ── Agent Management ───────────────────────────────────────────────────────

    listAgents(): AgentConfig[] {
        return this.registry.listConfigs();
    }

    listAvailableModels(providerName?: string): string[] {
        const models = new Set<string>();
        for (const provider of this.config.providers) {
            if (providerName && provider.name !== providerName) continue;
            if (provider.models) {
                provider.models.forEach(m => models.add(m));
            }
        }
        return Array.from(models);
    }

    getProviderById(id: string): ProviderConfig | undefined {
        return this.config.providers.find(p => p.name === id);
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
        const configPath = process.env['CONFIG_PATH'] ?? './config/clawgate.json';
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

    /**
     * List all available skills, categorized by native, project, and prompt-driven.
     */
    listAvailableSkills(): { native: any[], project: any[], prompt: any[] } {
        // "project" = registered tool-based skills (MCP or local)
        const project = (this.skillRegistry.getDeclarations() || []).map(d => ({
            name: d.name,
            description: d.description,
            type: 'project'
        }));

        // "native" = built-in tools from gemini-cli (non-extensible)
        const native = [
            { name: 'google_web_search', description: 'Search the web using Google Search.', type: 'native' },
            { name: 'run_code', description: 'Execute code in a sandboxed environment.', type: 'native' }
        ];

        // "prompt" = prompt-driven skills (OpenClaw style)
        const prompt = this.skillRegistry.getAllPromptSkills().map(s => ({
            name: s.name,
            description: s.description,
            type: 'prompt',
            status: s.status,
            reason: s.reason,
            install: s.install
            // Path excluded for security (Major 3)
        }));

        return { native, project, prompt };
    }

    /**
     * Install dependencies for a prompt-driven skill (Asynchronous, secure).
     */
    async installSkill(name: string): Promise<{ success: boolean, output: string }> {
        const { promisify } = await import('node:util');
        const { execFile } = await import('node:child_process');
        const execFileAsync = promisify(execFile);
        const skills = this.skillRegistry.getAllPromptSkills();
        const skill = skills.find(s => s.name === name);

        if (!skill) throw new Error(`Skill ${name} not found`);
        if (!skill.install || !Array.isArray(skill.install)) {
            throw new Error(`Skill ${name} has no installation instructions`);
        }

        let output = `[install] Starting installation for ${name}...\n`;

        for (const step of skill.install) {
            const label = step.label || step.id || step.kind;
            output += `[install] Step: ${label} (${step.kind})\n`;
            try {
                let file = '';
                let args: string[] = [];

                switch (step.kind) {
                    case 'go':
                        if (!step.module) throw new Error('go: missing module');
                        file = 'go'; args = ['install', step.module];
                        break;
                    case 'npm':
                        const pkg = step.module || step.id;
                        if (!pkg) throw new Error('npm: missing module/id');
                        file = 'npm'; args = ['install', '-g', pkg];
                        break;
                    case 'brew':
                        if (!step.id) throw new Error('brew: missing id');
                        file = 'brew'; args = ['install', step.id];
                        break;
                    case 'pip':
                        if (!step.id) throw new Error('pip: missing id');
                        file = 'pip3'; args = ['install', step.id];
                        break;
                    case 'shell':
                        if (!step.command) throw new Error('shell: missing command');
                        console.warn(`[install/security] Executing shell command for ${name}: ${step.command}`);
                        file = '/bin/sh'; args = ['-c', step.command];
                        break;
                    default:
                        output += `[install] SKIP: unknown kind "${step.kind}"\n`;
                        continue;
                }

                if (file) {
                    const { stdout, stderr } = await execFileAsync(file, args, {
                        timeout: 120_000,
                        env: { ...process.env }
                    });
                    if (stdout) output += stdout;
                    if (stderr) output += `[stderr] ${stderr}`;
                }
            } catch (err: any) {
                output += `[install] ERROR: ${err.message}\n`;
                if (err.stdout) output += err.stdout;
                if (err.stderr) output += err.stderr;
                return { success: false, output };
            }
        }

        // Refresh registry after installation
        this.skillRegistry.refreshPromptSkills();

        output += `[install] ✅ Successfully installed ${name}.\n`;
        return { success: true, output };
    }

    /**
     * Configure environment variables for a prompt-driven skill.
     */
    async configureSkill(name: string, envVars: Record<string, string>): Promise<{ success: boolean, status: string }> {
        const skills = this.skillRegistry.getAllPromptSkills();
        const skill = skills.find(s => s.name === name);
        if (!skill) throw new Error(`Skill ${name} not found`);

        // Validation: only allowed keys
        const allowedKeys = skill.requiredEnv.map(e => e.key);
        const invalidKeys = Object.keys(envVars || {}).filter(k => !allowedKeys.includes(k));
        if (invalidKeys.length > 0) {
            throw new Error(`Invalid env keys: ${invalidKeys.join(', ')}`);
        }

        // Apply to process.env immediately
        for (const [key, value] of Object.entries(envVars || {})) {
            process.env[key] = value;
        }

        // Persist to .env
        const { overwriteEnvVariables } = await import('@clawgate/core');
        await overwriteEnvVariables(envVars || {});

        // Refresh cache
        this.skillRegistry.refreshPromptSkills();

        const updatedSkill = this.skillRegistry.getAllPromptSkills().find(s => s.name === name);
        return {
            success: true,
            status: updatedSkill?.status ?? 'enabled'
        };
    }

    getOverviewStats(): { instances: number, sessions: number, cronJobs: number, tickInterval: number } {
        const sessions = this.sessions.listAll().length;

        let cronJobs = 0;
        let tickInterval = 60; // Default fallback
        for (const runtime of this.registry.getAll()) {
            if (runtime.getConfig().heartbeat?.enabled) {
                cronJobs++;
                tickInterval = runtime.getConfig().heartbeat?.intervalMinutes || tickInterval;
            }
        }

        return {
            instances: 1, // Gateway itself for now, will be expanded in Instances page
            sessions,
            cronJobs,
            tickInterval
        };
    }

    listSessionsDetailed(): any[] {
        const activeSessions = this.sessions.listAll();
        return activeSessions.map(session => {
            const transcript = this.transcripts.load(session.id);
            let tokens = 0;
            let actions = 0;

            transcript.forEach(msg => {
                if (msg.role === 'assistant' && (msg as any).actionCalls) {
                    actions += (msg as any).actionCalls.length;
                }
                tokens += this.estimateTokens(msg.content);
            });

            return {
                key: session.id,
                label: session.peerId,
                kind: session.channel,
                updated: session.updatedAt,
                tokens: Math.round(tokens),
                thinking: false,
                verbose: 0,
                reasoning: 0,
                actions
            };
        });
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
        // If the channel adapter explicitly identifies the owner (e.g. via secret)
        if (metadata?.isOwner === true) return true;

        if (channel === 'webchat') {
            const configuredOwnerId = this.config.ownerWebChatClientId;
            return peerId === MIRROR_PEER_ID || (!!configuredOwnerId && peerId === configuredOwnerId);
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
        // 1. Broadcast to all active WebSocket clients
        await this.send('webchat', '__BROADCAST__', JSON.stringify(msg));

        // 2. Persist to mirroring transcript for later retrieval (even if WebChat was closed)
        const session = this.sessions.getOrCreate('webchat', MIRROR_PEER_ID, 'main');
        this.transcripts.append(session.id, {
            role: msg.from === 'assistant' ? 'assistant' : 'user',
            content: msg.text,
            thought: msg.thought,
            timestamp: Date.now()
        });
    }

    // --- Skill Management API ---

    public getAllSkillManifests(agentName?: string): any[] {
        const manifests = this.skillRegistry.getAllManifests();

        if (agentName) {
            const agent = this.registry.get(agentName);
            const whitelist = agent.getConfig().skills || [];
            if (whitelist.length > 0) {
                return manifests.map(m => ({
                    ...m,
                    isAuthorized: whitelist.includes(m.name)
                }));
            }
        }

        return manifests;
    }

    public disableSkill(name: string): void {
        this.skillRegistry.disableSkill(name);
    }

    public enableSkill(name: string): void {
        this.skillRegistry.enableSkill(name);
    }

    public async updateAgentSkills(agentName: string, skills: string[]): Promise<void> {
        const agent = this.registry.get(agentName);
        const config = agent.getConfig();
        config.skills = skills;
        // Logic to persist config change depends on implementation (git, json write, etc)
        // Here we assume registry.update or similar exists, or we just modify in-memory
        await this.updateAgent(agentName, config);
    }

    private estimateTokens(text?: string): number {
        if (!text) return 0;
        // Rough heuristic: mix of word count and char count for multi-language support
        const words = text.trim().split(/\s+/).length;
        const chars = text.length;
        return Math.max(Math.ceil(words * 1.35), Math.ceil(chars / 3));
    }
}
