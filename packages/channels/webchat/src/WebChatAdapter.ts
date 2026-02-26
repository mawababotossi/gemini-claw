/**
 * @license Apache-2.0
 * @geminiclaw/channel-webchat — WebSocket chat adapter
 *
 * Exposes a simple WebSocket server. Each browser tab gets its own
 * peerId (based on a generated client ID stored in localStorage).
 */
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Gateway } from '@geminiclaw/gateway';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHANNEL = 'webchat';

interface WsMessage {
    type: 'message' | 'ping';
    clientId: string;
    text?: string;
}

export class WebChatAdapter {
    private wss: WebSocketServer | null = null;
    private clients = new Map<string, WebSocket>();

    constructor(private port: number = 3001) { }

    connect(gateway: Gateway): void {
        // Register our send function with the gateway
        gateway.registerChannel(CHANNEL, async (peerId: string, text: string, thought?: string) => {
            const ws = this.clients.get(peerId);
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'message', from: 'assistant', text, thought }));
            }
        });

        // HTTP server for health check and WebSocket upgrade
        const httpServer = createServer((req, res) => {
            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', clients: this.clients.size }));
            } else {
                res.writeHead(404);
                res.end('Not found');
            }
        });

        this.wss = new WebSocketServer({ server: httpServer });

        this.wss.on('connection', (ws) => {
            let clientId: string | null = null;

            ws.on('message', async (raw) => {
                let parsed: WsMessage;
                try {
                    parsed = JSON.parse(raw.toString()) as WsMessage;
                } catch {
                    return;
                }

                if (!parsed.clientId) return;

                // Register client on first message
                if (!clientId) {
                    clientId = parsed.clientId;
                    this.clients.set(clientId, ws);
                    ws.send(JSON.stringify({ type: 'connected', clientId }));
                }

                if (parsed.type === 'message' && parsed.text?.trim()) {
                    // Acknowledge receipt immediately
                    ws.send(JSON.stringify({ type: 'typing' }));
                    // Let the gateway handle it
                    await gateway.ingest(CHANNEL, clientId, parsed.text.trim());
                }
            });

            ws.on('close', () => {
                if (clientId) this.clients.delete(clientId);
            });
        });

        httpServer.listen(this.port, () => {
            console.log(`[webchat] Listening on http://localhost:${this.port}`);
        });
    }

    get connectedClients(): number {
        return this.clients.size;
    }
}
