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
    phoneNumber?: string;
}

export class WhatsAppAdapter {
    private sock: BaileysModule | null = null;
    private authDir: string;
    private gatewayRef: IGateway | null = null;
    private status: 'connecting' | 'qr' | 'connected' | 'disconnected' = 'disconnected';
    private qrStr: string | null = null;

    constructor(private options: WhatsAppAdapterOptions = {}) {
        this.authDir = options.authDir ?? AUTH_DIR;
    }

    getStatus() {
        const connectedStatus = this.sock?.authState?.creds?.me ? 'connected' : this.status;
        return {
            status: connectedStatus === 'connected' ? 'connected' : this.status,
            qr: this.qrStr
        };
    }

    async logout() {
        try {
            if (this.sock) {
                await this.sock.logout();
            }
        } catch (err) {
            console.error('[whatsapp] logout error', err);
        }
        this.sock = null;
        this.status = 'disconnected';
        this.qrStr = null;

        const { rmSync } = await import('node:fs');
        if (existsSync(this.authDir)) {
            rmSync(this.authDir, { recursive: true, force: true });
        }

        if (this.gatewayRef) {
            setTimeout(() => this.startSocket(this.gatewayRef!), 2000);
        }
    }

    async connect(gateway: IGateway): Promise<void> {
        this.gatewayRef = gateway;
        gateway.registerChannel(CHANNEL, async (peerId: string, text: string) => {
            if (!this.sock) return;
            try {
                console.log(`[whatsapp-debug] Sending message to ${peerId}: ${text.slice(0, 50)}...`);
                // Add a zero-width space to identify bot-generated messages
                // and prevent infinite loops when the bot replies to itself.
                const botReplyText = text + '\u200B';
                await this.sock.sendMessage(peerId, { text: botReplyText });
                console.log(`[whatsapp-debug] Message sent to ${peerId} successfully.`);
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

        this.status = 'connecting';
        this.qrStr = null;

        this.sock.ev.on('connection.update', (update: BaileysModule) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                this.status = 'qr';
                this.qrStr = qr;
                console.log('\n[whatsapp] 📱 Scan the QR code above with WhatsApp > Linked Devices\n');
            }

            if (connection === 'close') {
                this.status = 'disconnected';
                this.qrStr = null;
                const code = lastDisconnect?.error?.output?.statusCode;
                const loggedOut = code === DisconnectReason?.loggedOut;
                console.log('[whatsapp] Disconnected.', loggedOut ? 'Logged out.' : 'Reconnecting in 5s...');
                if (!loggedOut) setTimeout(() => this.startSocket(gateway), 5000);
            } else if (connection === 'open') {
                this.status = 'connected';
                this.qrStr = null;
                console.log('[whatsapp] ✅ Connected!');
            }
        });

        this.sock.ev.on('messages.upsert', async (event: BaileysModule) => {
            const { messages, type } = event;
            console.log(`\n[whatsapp-raw] event.type=${type}, messages.length=${messages.length}`);

            const extractText = (m: any) => {
                const msg = m.message;
                if (!msg) return '';

                // Direct conversation
                if (msg.conversation) return msg.conversation;

                // Extended text (replies, links etc)
                if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;

                // Wrapped messages (deviceSent, ephemeral, viewOnce)
                const wrapped = msg.deviceSentMessage?.message ||
                    msg.ephemeralMessage?.message ||
                    msg.viewOnceMessage?.message ||
                    msg.viewOnceMessageV2?.message;

                if (wrapped) {
                    if (wrapped.conversation) return wrapped.conversation;
                    if (wrapped.extendedTextMessage?.text) return wrapped.extendedTextMessage.text;
                }

                return msg.imageMessage?.caption || msg.videoMessage?.caption || '';
            };

            // Raw logging for self-messages or all messages
            for (const m of messages) {
                const text = extractText(m);
                const jid = m.key?.remoteJid ?? '';
                const fromMe = m.key?.fromMe;
                console.log(`[whatsapp-raw] msg -> remoteJid=${jid}, fromMe=${fromMe}, text="${text}"`);
                if (fromMe) {
                    console.log(`[whatsapp-raw] FULL SELF-MESSAGE PAYLOAD:`, JSON.stringify(m, null, 2));
                }
            }

            if (type !== 'notify') return;

            for (const msg of messages) {
                if (!msg.message) continue;

                const jid: string = msg.key?.remoteJid ?? '';
                if (!jid) continue;

                const text = extractText(msg);

                if (!text.trim()) {
                    console.log(`[whatsapp-debug] Ignoring empty message from ${jid}`);
                    continue;
                }

                // Anti-loop: ignore bot's own responses
                if (text.endsWith('\u200B')) {
                    continue;
                }

                const normalizeJid = (id: string) => {
                    if (!id) return '';
                    return `${id.split('@')[0].split(':')[0]}@s.whatsapp.net`;
                };

                const myJid = this.sock?.user?.id ? normalizeJid(this.sock.user.id) : '';
                const baseRemoteJid = normalizeJid(jid);

                console.log(`\n[whatsapp-debug] --- MSG ---`);
                console.log(`[whatsapp-debug] text:`, text.trim());
                console.log(`[whatsapp-debug] jid (remoteJid):`, jid);
                console.log(`[whatsapp-debug] fromMe:`, msg.key?.fromMe);
                console.log(`[whatsapp-debug] myJid:`, myJid);
                console.log(`[whatsapp-debug] baseRemoteJid:`, baseRemoteJid);
                console.log(`[whatsapp-debug] ------------------\n`);

                // Allow fromMe only if chatting with oneself (Note to self)
                // Note: Self-messages often arrive with @lid instead of @s.whatsapp.net
                const isSelfLid = jid.endsWith('@lid');
                if (msg.key?.fromMe && baseRemoteJid !== myJid && !isSelfLid) {
                    console.log(`[whatsapp-debug] Dropped (fromMe && baseRemoteJid !== myJid && !isSelfLid)`);
                    continue;
                }

                const isGroup = isJidGroup ? isJidGroup(jid) : jid.endsWith('@g.us');

                if (this.options.mentionOnly && isGroup) {
                    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
                    const myJid = this.sock?.user?.id ?? '';
                    if (!mentioned.includes(myJid)) {
                        console.log(`[whatsapp] Ignoring group message from ${jid} (not mentioned)`);
                        continue;
                    }
                }

                try {
                    await this.sock?.sendPresenceUpdate('composing', jid);
                } catch { /* ignore */ }

                console.log(`[whatsapp] Ingesting message to gateway: ${text.trim()} (fromMe=${msg.key?.fromMe})`);

                // For self-messages, we MUST use our own canonical JID as peerId 
                // to ensure the reply goes to the "Note to self" chat thread.
                const targetJid = msg.key?.fromMe ? myJid : jid;
                await gateway.ingest(CHANNEL, targetJid, text.trim(), undefined, { fromMe: !!msg.key?.fromMe });


                try {
                    await this.sock?.sendPresenceUpdate('paused', jid);
                } catch { /* ignore */ }
            }
        });
    }
}
