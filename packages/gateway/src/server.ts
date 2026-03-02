/**
 * @license Apache-2.0
 * GeminiClaw — Main server entrypoint
 *
 * Bootstraps gateway + channels from config/geminiclaw.json.
 */
import 'dotenv/config';
import { Gateway, loadConfig } from './index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Response } from 'express';
import { requireApiToken } from './middleware/apiAuth.js';
import { WebSocketServer } from 'ws';

// --- Log Interception ---
const logClients = new Set<Response>();
interface LogEntry { timestamp: string; level: string; text: string; }
const logBuffer: LogEntry[] = [];
const MAX_BUFFER = 200;

const LOG_LEVELS: Record<string, number> = {
    'trace': 0,
    'debug': 1,
    'info': 2,
    'warn': 3,
    'error': 4
};

const MIN_LOG_LEVEL = LOG_LEVELS[(process.env['LOG_LEVEL'] || 'info').toLowerCase()] ?? 2;

const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
    trace: console.trace,
};

function broadcastLog(level: string, ...args: any[]) {
    const currentLevel = LOG_LEVELS[level] ?? 2;

    // Always call original console
    originalConsole[level as keyof typeof originalConsole](...args);

    // Filter broadcast and buffer based on LOG_LEVEL
    if (currentLevel < MIN_LOG_LEVEL) return;

    const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        text: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
    };

    logBuffer.push(entry);
    if (logBuffer.length > MAX_BUFFER) logBuffer.shift();

    if (logClients.size > 0) {
        const msg = `data: ${JSON.stringify(entry)}\n\n`;
        setImmediate(() => {
            for (const client of logClients) {
                client.write(msg);
            }
        });
    }
}

console.log = (...args) => broadcastLog('info', ...args);
console.warn = (...args) => broadcastLog('warn', ...args);
console.error = (...args) => broadcastLog('error', ...args);
console.info = (...args) => broadcastLog('info', ...args);
console.debug = (...args) => broadcastLog('debug', ...args);
console.trace = (...args) => broadcastLog('trace', ...args);
// ------------------------

const CONFIG_PATH = process.env['CONFIG_PATH'] ?? './config/geminiclaw.json';

async function main(): Promise<void> {
    console.log('[geminiclaw] Starting...');

    const config = loadConfig(CONFIG_PATH);
    console.log(`[geminiclaw] Configuration loaded from: ${path.resolve(CONFIG_PATH)}`);
    console.log(`[geminiclaw] Enabled channels: ${Object.keys(config.channels).filter(c => config.channels[c]?.enabled).join(', ')}`);
    const gateway = new Gateway(config);

    // ── Load channel adapters ─────────────────────────────────────────────

    // WebChat (always loaded — used as default dev channel)
    if (config.channels['webchat']?.enabled !== false) {
        const WEBCHAT_MODULE = '@geminiclaw/channel-webchat';
        const { WebChatAdapter } = await (import(WEBCHAT_MODULE) as any);
        const wcConfig = (config.channels['webchat'] ?? {}) as any;
        const wc = new WebChatAdapter(wcConfig.port ?? 3001);
        wc.connect(gateway as any);
        console.log(`[geminiclaw] WebChat ready on port ${wcConfig.port ?? 3001}`);
    }

    // Telegram
    if (config.channels['telegram']?.enabled) {
        const { TelegramAdapter } = await import('@geminiclaw/channel-telegram');
        const tgConfig = config.channels['telegram'];
        if (tgConfig?.token) {
            const tg = new TelegramAdapter(tgConfig.token, {
                mentionOnly: tgConfig.mentionOnly ?? false,
            });
            tg.connect(gateway as any);
            console.log('[geminiclaw] Telegram adapter connected.');
        } else {
            console.warn('[geminiclaw] Telegram enabled but TELEGRAM_BOT_TOKEN is missing.');
        }
    }

    // WhatsApp
    let waAdapter: any = null;
    if (config.channels['whatsapp']?.enabled) {
        const { WhatsAppAdapter } = await import('@geminiclaw/channel-whatsapp');
        const waCfg = config.channels['whatsapp'];
        const wa = new WhatsAppAdapter({
            mentionOnly: waCfg?.mentionOnly ?? false,
            phoneNumber: waCfg?.phoneNumber,
        });
        waAdapter = wa;
        wa.connect(gateway as any);
        console.log('[geminiclaw] WhatsApp adapter connecting (scan QR if needed)...');
    }

    // Discord
    if (config.channels['discord']?.enabled) {
        const { DiscordAdapter } = await import('@geminiclaw/channel-discord');
        const discordConfig = config.channels['discord'];
        const discordToken = process.env['DISCORD_TOKEN'];
        if (discordToken) {
            const discord = new DiscordAdapter(discordToken, {
                channels: discordConfig.channels,
            });
            discord.connect(gateway as any);
            console.log('[geminiclaw] Discord adapter connected.');
        } else {
            console.warn('[geminiclaw] Discord enabled but DISCORD_TOKEN is missing.');
        }
    }

    // Slack
    if (config.channels['slack']?.enabled) {
        const { SlackAdapter } = await import('@geminiclaw/channel-slack');
        const slackConfig = config.channels['slack'] as any;
        const slackToken = process.env['SLACK_BOT_TOKEN'];
        const slackSecret = process.env['SLACK_SIGNING_SECRET'];
        if (slackToken && slackSecret) {
            const slack = new SlackAdapter({
                token: slackToken,
                signingSecret: slackSecret,
                appToken: process.env['SLACK_APP_TOKEN'],
            });
            slack.connect(gateway as any);
            console.log('[geminiclaw] Slack adapter connected.');
        } else {
            console.warn('[geminiclaw] Slack enabled but tokens (SLACK_BOT_TOKEN/SLACK_SIGNING_SECRET) are missing.');
        }
    }

    // ── Express API for Dashboard ─────────────────────────────────────────
    const express = (await import('express')).default;
    const cors = (await import('cors')).default;
    const cookieParser = (await import('cookie-parser')).default;
    const { rateLimit } = await import('express-rate-limit');

    const app = express();

    // Rate Limiting
    const apiLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 300, // Limit each IP to 300 requests per window
        message: { error: 'Too many requests, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    const strictLimiter = rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 20, // Limit each IP to 20 auth requests per hour
        message: { error: 'Strict rate limit exceeded. Try again in an hour.' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    app.use(cookieParser());
    app.use(cors({
        origin: process.env['DASHBOARD_ORIGIN'] || 'http://localhost:5173',
        credentials: true,
    }));

    // Explicitly skip parsing for MCP POST route so SSEServerTransport can read the raw stream
    app.use((req, res, next) => {
        if (req.method === 'POST' && req.path === '/api/mcp/messages') {
            return next();
        }
        express.json()(req, res, next);
    });

    // Public Auth Routes
    app.post('/api/auth/login', strictLimiter, (req, res) => {
        const { token } = req.body;
        const expectedToken = process.env['GEMINICLAW_API_TOKEN'];

        if (!expectedToken) {
            return res.status(503).json({ error: 'Auth not configured on server' });
        }

        if (token === expectedToken) {
            // Set HttpOnly cookie
            res.cookie('gc_session', token, {
                httpOnly: true,
                secure: process.env['NODE_ENV'] === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            });
            return res.json({ success: true });
        }

        res.status(401).json({ error: 'Invalid token' });
    });

    app.post('/api/auth/logout', (req, res) => {
        res.clearCookie('gc_session');
        res.json({ success: true });
    });

    // Protect all /api routes including skills, agents, config, etc.
    app.use('/api', apiLimiter, (req, res, next) => {
        // Skip auth for login/logout
        if (req.path === '/auth/login' || req.path === '/auth/logout') {
            return next();
        }
        requireApiToken(req, res, next);
    });

    // Enable MCP SSE transport

    app.get('/api/mcp/messages', async (req, res) => {
        await gateway.mcpServer.handleSse(req, res);
    });

    app.post('/api/mcp/messages', async (req, res) => {
        await gateway.mcpServer.handleMessage(req, res);
    });

    // API: System Status & Auth
    app.get('/api/status', (req, res) => {
        let authType = 'None';
        let accountHint = 'Not configured';

        if (process.env['GOOGLE_GENAI_USE_GCA'] === 'true') {
            authType = 'Google OAuth';
            accountHint = 'GCA Session';

            // Try to read the exact email from the gemini-cli configuration
            try {
                const credsPath = path.join(os.homedir(), '.gemini', 'google_accounts.json');

                if (fs.existsSync(credsPath)) {
                    const credsData = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                    if (credsData.active) {
                        accountHint = credsData.active;
                    }
                }
            } catch (err) {
                console.warn('[gateway] Could not read GCA email address:', err);
            }
        } else if (process.env['GEMINI_API_KEY']) {
            authType = 'API Key';
            const key = process.env['GEMINI_API_KEY'];
            accountHint = key.substring(0, 4) + '...' + key.substring(key.length - 4);
        }

        const stats = gateway.getOverviewStats();

        res.json({
            status: 'Healthy',
            authType,
            accountHint,
            uptime: process.uptime(),
            tickInterval: stats.tickInterval,
            lastChannelsRefresh: Date.now(), // Placeholder for now
            instances: stats.instances,
            sessions: stats.sessions,
            cron: stats.cronJobs
        });
    });

    // API: WhatsApp Status & Actions
    app.get('/api/channels/whatsapp/status', (req, res) => {
        if (!waAdapter) {
            return res.json({ status: 'disabled' });
        }
        res.json(waAdapter.getStatus());
    });

    app.post('/api/channels/whatsapp/logout', async (req, res) => {
        if (!waAdapter) {
            return res.status(400).json({ error: 'WhatsApp channel disabled' });
        }
        await waAdapter.logout();
        res.json({ success: true });
    });

    // API: Get Channel Config
    app.get('/api/channels/:name', (req, res) => {
        const config = gateway.getChannelConfig(req.params.name);
        if (!config) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        res.json(config);
    });

    // API: Update Channel Config
    app.put('/api/channels/:name', async (req, res) => {
        try {
            await gateway.updateChannelConfig(req.params.name, req.body);
            res.json({ success: true });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // API: Global Config
    app.get('/api/config/global', (req, res) => {
        res.json(gateway.getGlobalConfig());
    });

    // API: Project Config
    app.get('/api/config/project', (req, res) => {
        res.json(gateway.getProjectConfig());
    });

    app.put('/api/config/project', async (req, res) => {
        try {
            await gateway.updateProjectConfig(req.body);
            res.json({ success: true });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // API: Providers Config
    app.get('/api/config/providers', (req, res) => {
        res.json(gateway.getProviders());
    });

    app.put('/api/config/providers', async (req, res) => {
        try {
            await gateway.updateProviders(req.body);
            res.json({ success: true });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // API: List available providers (metadata for dashboard)
    app.get('/api/providers', (req, res) => {
        const providers = gateway.getProviders().map(p => ({
            id: p.name,
            name: p.name,
            type: p.type,
            models: p.models || [],
            authType: p.type === 'google' ? ['gemini-api-key', 'oauth-personal'] :
                p.type === 'anthropic' ? ['claude-api-key'] :
                    p.type === 'openai' ? ['openai-api-key'] : []
        }));
        res.json(providers);
    });

    // API: Get transcript
    app.get('/api/transcripts/:channel/:peerId', (req, res) => {
        const { channel, peerId } = req.params;
        const transcript = gateway.getTranscript(channel, peerId);
        res.json(transcript);
    });

    // API: List Sessions
    app.get('/api/sessions', (req, res) => {
        const sessions = gateway.listSessionsDetailed();
        res.json(sessions);
    });

    // API: List agents
    app.get('/api/agents', (req, res) => {
        const agents = gateway.listAgents();
        res.json(agents);
    });


    // API: Install skill dependencies
    app.post('/api/skills/:name/install', async (req, res) => {
        try {
            const result = await gateway.installSkill(req.params.name);
            res.json(result);
        } catch (err: any) {
            res.status(400).json({ status: 'error', message: err.message });
        }
    });

    // API: Configure skill environment variables
    app.post('/api/skills/:name/configure', async (req, res) => {
        try {
            const { name } = req.params;
            const { envVars } = req.body as { envVars: Record<string, string> };
            const result = await gateway.configureSkill(name, envVars);
            res.json(result);
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // API: List available models
    app.get('/api/models', (req, res) => {
        const provider = req.query.provider as string | undefined;
        const models = gateway.listAvailableModels(provider);
        res.json(models);
    });

    // API: Create agent
    app.post('/api/agents', async (req, res) => {
        try {
            await gateway.addAgent(req.body);
            res.status(201).json({ success: true });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // API: Update agent
    app.put('/api/agents/:name', async (req, res) => {
        try {
            await gateway.updateAgent(req.params.name, req.body);
            res.json({ success: true });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // API: Delete agent
    app.delete('/api/agents/:name', async (req, res) => {
        try {
            await gateway.removeAgent(req.params.name);
            res.json({ success: true });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // API: List agent dynamic jobs
    app.get('/api/agents/:name/jobs', (req, res) => {
        try {
            const runtime = gateway.registry.get(req.params.name);
            res.json(runtime.listDynamicJobs());
        } catch (err: any) {
            res.status(404).json({ error: err.message });
        }
    });

    // API: Delete agent dynamic job
    app.delete('/api/agents/:name/jobs/:jobId', (req, res) => {
        try {
            const runtime = gateway.registry.get(req.params.name);
            const success = runtime.removeDynamicJob(req.params.jobId);
            res.json({ success });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // API: List all dynamic jobs across agents
    app.get('/api/jobs', (req, res) => {
        try {
            const allJobs: any[] = [];
            for (const runtime of gateway.registry.getAll()) {
                const jobs = runtime.listDynamicJobs().map(j => ({
                    ...j,
                    agentName: runtime.getConfig().name
                }));
                allJobs.push(...jobs);
            }
            res.json(allJobs);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // API: List agent memory journals
    app.get('/api/agents/:name/memory', (req, res) => {
        try {
            const runtime = gateway.registry.get(req.params.name);
            const baseDir = runtime.getConfig().baseDir;
            if (!baseDir) return res.json([]);

            const allFiles: any[] = [];

            // 1. Files in baseDir (SOUL.md, etc.)
            const rootFiles = fs.readdirSync(baseDir)
                .filter(f => f.endsWith('.md'))
                .map(f => {
                    const stats = fs.statSync(path.join(baseDir, f));
                    return { name: f, size: stats.size, mtime: stats.mtime, isRoot: true };
                });
            allFiles.push(...rootFiles);

            // 2. Files in memoryDir (Journal, etc.)
            const memoryDir = path.join(baseDir, 'memory');
            if (fs.existsSync(memoryDir)) {
                const memFiles = fs.readdirSync(memoryDir)
                    .filter(f => f.endsWith('.md'))
                    .map(f => {
                        const stats = fs.statSync(path.join(memoryDir, f));
                        return { name: f, size: stats.size, mtime: stats.mtime, isRoot: false };
                    });
                allFiles.push(...memFiles);
            }

            // Sort: Root files first, then memory files descending by mtime
            allFiles.sort((a, b) => {
                if (a.isRoot !== b.isRoot) return a.isRoot ? -1 : 1;
                return b.mtime.getTime() - a.mtime.getTime();
            });

            res.json(allFiles);
        } catch (err: any) {
            res.status(404).json({ error: err.message });
        }
    });

    // API: Read agent memory journal content
    app.get('/api/agents/:name/memory/:filename', (req, res) => {
        try {
            const runtime = gateway.registry.get(req.params.name);
            const baseDir = runtime.getConfig().baseDir;
            if (!baseDir) throw new Error('No base directory');

            let filePath = path.join(baseDir, 'memory', req.params.filename);
            if (!fs.existsSync(filePath)) {
                filePath = path.join(baseDir, req.params.filename);
            }

            if (!fs.existsSync(filePath)) throw new Error('File not found');

            const content = fs.readFileSync(filePath, 'utf8');
            res.json({ content });
        } catch (err: any) {
            res.status(404).json({ error: err.message });
        }
    });

    // API: Write agent memory journal content
    app.put('/api/agents/:name/memory/:filename', (req, res) => {
        try {
            const runtime = gateway.registry.get(req.params.name);
            const baseDir = runtime.getConfig().baseDir;
            if (!baseDir) throw new Error('No base directory');

            let filePath = path.join(baseDir, 'memory', req.params.filename);
            if (!fs.existsSync(filePath)) {
                filePath = path.join(baseDir, req.params.filename);
            }

            if (!fs.existsSync(filePath)) throw new Error('File not found');

            if (typeof req.body.content !== 'string') throw new Error('Missing content body');

            fs.writeFileSync(filePath, req.body.content, 'utf8');
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // API: Live Logs SSE
    app.get('/api/logs/stream', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Send history
        for (const entry of logBuffer) {
            res.write(`data: ${JSON.stringify(entry)}\n\n`);
        }

        logClients.add(res);
        console.log('[gateway] Dashboard log client connected.');

        req.on('close', () => {
            logClients.delete(res);
        });
    });

    // --- Unified Skill Management API ---

    // Lister tous les skills avec leur statut unifié
    app.get('/api/skills', (req, res) => {
        try {
            const agentName = req.query.agent as string | undefined;
            const manifests = gateway.getAllSkillManifests(agentName);
            res.json(manifests);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // Désactiver manuellement un skill
    app.post('/api/skills/:name/disable', (req, res) => {
        try {
            gateway.disableSkill(req.params.name);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // Réactiver un skill désactivé
    app.post('/api/skills/:name/enable', (req, res) => {
        try {
            gateway.enableSkill(req.params.name);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // Assigner/retirer un skill d'un agent spécifique
    app.patch('/api/agents/:name/skills', async (req, res) => {
        try {
            const { skills }: { skills: string[] } = req.body;
            await gateway.updateAgentSkills(req.params.name, skills);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    const apiPort = config.gatewayPort ?? 3002;
    const server = app.listen(apiPort, () => {
        console.log(`[geminiclaw] Admin API ready on port ${apiPort}`);
    });

    // --- WebSocket Server for Nodes ---
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws) => {
        gateway.handleNodeConnection(ws);
    });
    console.log('[geminiclaw] WebSocket Node server attached.');

    // ── Graceful shutdown ─────────────────────────────────────────────────
    const shutdown = async (): Promise<void> => {
        console.log('\n[geminiclaw] Shutting down...');
        await gateway.shutdown();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('[geminiclaw] 🚀 Ready. Ctrl+C to stop.');
}

main().catch((err) => {
    console.error('[geminiclaw] Fatal error:', err);
    process.exit(1);
});
