/**
 * @license Apache-2.0
 * @geminiclaw/channel-whatsapp — WhatsAppAdapter (Baileys v6)
 *
 * QR code based pairing. After first login, auth is cached in data/whatsapp_auth.
 * Reconnects automatically if disconnected.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BaileysModule = any;

import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type { IGateway } from '@geminiclaw/core';

const CHANNEL = 'whatsapp';
const AUTH_DIR = join(process.cwd(), 'data', 'whatsapp_auth');

export interface WhatsAppAdapterOptions {
    mentionOnly?: boolean;
    authDir?: string;
}

export class WhatsAppAdapter {
    private sock: BaileysModule | null = null;
    private authDir: string;

    constructor(private options: WhatsAppAdapterOptions = {}) {
        this.authDir = options.authDir ?? AUTH_DIR;
    }

    async connect(gateway: IGateway): Promise<void> {
        gateway.registerChannel(CHANNEL, async (peerId: string, text: string) => {
            if (!this.sock) return;
            try {
                await this.sock.sendMessage(peerId, { text });
            } catch (err) {
                console.error('[whatsapp] Send failed:', err);
            }
        });

        await this.startSocket(gateway);
    }

    private async startSocket(gateway: IGateway): Promise<void> {
        if (!existsSync(this.authDir)) {
            mkdirSync(this.authDir, { recursive: true });
        }

        // Dynamic import of Baileys (avoids TypeScript issues with CJS/ESM interop)
        const baileys = await import('@whiskeysockets/baileys') as BaileysModule;
        const {
            default: makeWASocket,
            useMultiFileAuthState,
            fetchLatestBaileysVersion,
            DisconnectReason,
            isJidGroup,
        } = baileys;

        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
        const { version } = await fetchLatestBaileysVersion();

        this.sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: true,
            logger: { level: 'silent', trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { }, fatal: () => { }, child: () => ({ level: 'silent', trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { }, fatal: () => { }, child: () => ({}) }) },
            browser: ['GeminiClaw', 'Chrome', '1.0.0'],
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', (update: BaileysModule) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('\n[whatsapp] 📱 Scan the QR code above with WhatsApp > Linked Devices\n');
            }

            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                const loggedOut = code === DisconnectReason?.loggedOut;
                console.log('[whatsapp] Disconnected.', loggedOut ? 'Logged out.' : 'Reconnecting in 5s...');
                if (!loggedOut) setTimeout(() => this.startSocket(gateway), 5000);
            } else if (connection === 'open') {
                console.log('[whatsapp] ✅ Connected!');
            }
        });

        this.sock.ev.on('messages.upsert', async (event: BaileysModule) => {
            const { messages, type } = event;
            if (type !== 'notify') return;

            for (const msg of messages) {
                if (msg.key?.fromMe) continue;
                if (!msg.message) continue;

                const jid: string = msg.key?.remoteJid ?? '';
                if (!jid) continue;

                const text: string =
                    msg.message.conversation ??
                    msg.message.extendedTextMessage?.text ??
                    msg.message.imageMessage?.caption ??
                    msg.message.videoMessage?.caption ??
                    '';

                if (!text.trim()) continue;

                const isGroup = isJidGroup ? isJidGroup(jid) : jid.endsWith('@g.us');

                if (this.options.mentionOnly && isGroup) {
                    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
                    const myJid = this.sock?.user?.id ?? '';
                    if (!mentioned.includes(myJid)) continue;
                }

                try {
                    await this.sock?.sendPresenceUpdate('composing', jid);
                } catch { /* ignore */ }

                await gateway.ingest(CHANNEL, jid, text.trim());

                try {
                    await this.sock?.sendPresenceUpdate('paused', jid);
                } catch { /* ignore */ }
            }
        });
    }
}
