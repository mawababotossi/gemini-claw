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

// --- Log Interception ---
const logClients = new Set<Response>();
const logBuffer: string[] = [];
const MAX_BUFFER = 50;

const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
};

function broadcastLog(level: string, ...args: any[]) {
    const timestamp = new Date().toISOString();
    // Use util.format-like simple formatting, or just basic string joining
    const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');

    originalConsole[level as keyof typeof originalConsole](...args);

    const msg = JSON.stringify({ timestamp, level, text });
    logBuffer.push(msg);
    if (logBuffer.length > MAX_BUFFER) logBuffer.shift();

    for (const client of logClients) {
        client.write(`data: ${msg}\n\n`);
    }
}

console.log = (...args) => broadcastLog('log', ...args);
console.warn = (...args) => broadcastLog('warn', ...args);
console.error = (...args) => broadcastLog('error', ...args);
console.info = (...args) => broadcastLog('info', ...args);
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
        const { WebChatAdapter } = await import('@geminiclaw/channel-webchat');
        const wcConfig = config.channels['webchat'] ?? {};
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

    // ── Express API for Dashboard ─────────────────────────────────────────
    const express = (await import('express')).default;
    const cors = (await import('cors')).default;
    const app = express();

    app.use(cors({
        origin: process.env['DASHBOARD_ORIGIN'] ?? 'http://localhost:5173',
        credentials: true,
    }));

    // Explicitly skip parsing for MCP POST route so SSEServerTransport can read the raw stream
    app.use((req, res, next) => {
        if (req.method === 'POST' && req.path === '/api/mcp/messages') {
            return next();
        }
        express.json()(req, res, next);
    });

    // Protect all /api routes except MCP (which manages its own auth via gemini-cli)
    // and status (optional, but good for health checks)
    app.use('/api/agents', requireApiToken);
    app.use('/api/config', requireApiToken);
    app.use('/api/channels', requireApiToken);
    app.use('/api/transcripts', requireApiToken);
    app.use('/api/sessions', requireApiToken);
    app.use('/api/logs', requireApiToken);

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

        res.json({
            status: 'Healthy',
            authType,
            accountHint
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

    // API: Get transcript
    app.get('/api/transcripts/:channel/:peerId', (req, res) => {
        const { channel, peerId } = req.params;
        const transcript = gateway.getTranscript(channel, peerId);
        res.json(transcript);
    });

    // API: List agents
    app.get('/api/agents', (req, res) => {
        const agents = gateway.listAgents();
        res.json(agents);
    });

    // API: List available models
    app.get('/api/models', (req, res) => {
        const models = gateway.listAvailableModels();
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

    // API: List agent memory journals
    app.get('/api/agents/:name/memory', (req, res) => {
        try {
            const runtime = gateway.registry.get(req.params.name);
            const baseDir = runtime.getConfig().baseDir;
            if (!baseDir) return res.json([]);

            const memoryDir = path.join(baseDir, 'memory');
            if (!fs.existsSync(memoryDir)) return res.json([]);

            const files = fs.readdirSync(memoryDir)
                .filter(f => f.endsWith('.md'))
                .sort()
                .reverse()
                .map(f => ({
                    name: f,
                    size: fs.statSync(path.join(memoryDir, f)).size,
                    mtime: fs.statSync(path.join(memoryDir, f)).mtime
                }));
            res.json(files);
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

            const filePath = path.join(baseDir, 'memory', req.params.filename);
            if (!fs.existsSync(filePath)) throw new Error('File not found');

            const content = fs.readFileSync(filePath, 'utf8');
            res.json({ content });
        } catch (err: any) {
            res.status(404).json({ error: err.message });
        }
    });

    // API: Live Logs SSE
    app.get('/api/logs/stream', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Send history
        for (const msg of logBuffer) {
            res.write(`data: ${msg}\n\n`);
        }

        logClients.add(res);
        console.log('[gateway] Dashboard log client connected.');

        req.on('close', () => {
            logClients.delete(res);
        });
    });

    const apiPort = config.gatewayPort ?? 3002;
    app.listen(apiPort, () => {
        console.log(`[geminiclaw] Admin API ready on port ${apiPort}`);
    });

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
