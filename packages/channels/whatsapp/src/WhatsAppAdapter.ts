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
    private processedMessages = new Set<string>();
    private peerToLastJid = new Map<string, string>();
    /** Separate map for presence updates (typing indicators). 
     *  In self-chat (@lid), we must use the LID for presence to work. */
    private peerToPresenceJid = new Map<string, string>();
    private subscribedJids = new Set<string>();
    /** 
     * CRITICAL: Stores recently sent messages. 
     * Baileys needs these to handle encryption retries (getMessage).
     * Without this, self-chat and cross-device syncing show "Waiting for this message".
     */
    private messageStore = new Map<string, any>();

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
        gateway.registerChannel(
            CHANNEL,
            async (peerId, text) => {
                if (!this.sock) return;
                try {
                    // Helper to convert phone numbers (e.g. +228...) to JIDs
                    const formatJid = (id: string) => {
                        if (id.includes('@')) return id; // Already a JID
                        const clean = id.replace(/\+/g, '').trim();
                        return `${clean}@s.whatsapp.net`;
                    };

                    const realJid = this.peerToLastJid.get(peerId) || formatJid(peerId);

                    console.log(`[whatsapp-debug] Sending message to ${realJid} (from peerId ${peerId}): ${text.slice(0, 50)}...`);
                    // Add a zero-width space to identify bot-generated messages
                    const botReplyText = text + '\u200B';
                    const sentMsg = await this.sock.sendMessage(realJid, { text: botReplyText });
                    // Store the sent message for retry/decryption handling
                    if (sentMsg?.key?.id && sentMsg?.message) {
                        this.messageStore.set(sentMsg.key.id, sentMsg.message);
                        // Limit store size
                        if (this.messageStore.size > 500) {
                            const firstKey = this.messageStore.keys().next().value;
                            if (firstKey) this.messageStore.delete(firstKey);
                        }
                    }
                    console.log(`[whatsapp-debug] Message sent successful.`);
                } catch (err) {
                    console.error('[whatsapp] Send failed:', err);
                }
            },
            async (peerId, type) => {
                if (!this.sock) return;
                try {
                    const myJid = this.sock?.user?.id ? this.sock.user.id.split('@')[0].split(':')[0] + '@s.whatsapp.net' : '';
                    // For presence updates, prefer the LID (device-specific) if available.
                    const realJid = this.peerToPresenceJid.get(peerId) || this.peerToLastJid.get(peerId) || peerId;

                    console.log(`[whatsapp-debug] activityCallback: type=${type} peerId=${realJid} (mapped from ${peerId})`);

                    if (!this.subscribedJids.has(realJid)) {
                        await this.sock.presenceSubscribe(realJid);
                        this.subscribedJids.add(realJid);
                        console.log(`[whatsapp-debug] Subscribed to presence for ${realJid}`);
                    }

                    const presence = type === 'typing' ? 'composing' : 'paused';
                    await this.sock.sendPresenceUpdate(presence, realJid);
                    console.log(`[whatsapp-debug] sendPresenceUpdate(${presence}) successful`);
                } catch (err) {
                    console.error('[whatsapp-debug] activityCallback error:', err);
                }
            }
        );

        await this.startSocket(gateway);
    }

    private async startSocket(gateway: IGateway): Promise<void> {
        this.subscribedJids.clear();
        if (!existsSync(this.authDir)) {
            mkdirSync(this.authDir, { recursive: true });
        }

        // Dynamic import of Baileys (avoids TypeScript issues with CJS/ESM interop)
        const baileysModule = (await import('@whiskeysockets/baileys')) as any;
        const b = baileysModule.default || baileysModule;
        const makeWASocket = typeof b === 'function' ? b : (b.default || b);
        const useMultiFileAuthState = b.useMultiFileAuthState || baileysModule.useMultiFileAuthState;
        const fetchLatestBaileysVersion = b.fetchLatestBaileysVersion || baileysModule.fetchLatestBaileysVersion;
        const DisconnectReason = b.DisconnectReason || baileysModule.DisconnectReason;
        const isJidGroup = b.isJidGroup || baileysModule.isJidGroup;

        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
        const { version } = await fetchLatestBaileysVersion();

        this.sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: true,
            logger: { level: 'silent', trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { }, fatal: () => { }, child: () => ({ level: 'silent', trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { }, fatal: () => { }, child: () => ({}) }) },
            browser: ['GeminiClaw', 'Chrome', '1.0.0'],
            markOnlineOnConnect: true,
            shouldIgnoreJid: () => false,
            // getMessage is CRITICAL for message retry/decryption.
            // When a client (especially self-phone) receives a message and can't decrypt it,
            // it sends a "retry" request. Baileys then calls this function to get the 
            // original message content to re-encrypt it with new session keys.
            // Without this, the recipient sees "Waiting for this message".
            getMessage: async (key: any) => {
                const stored = this.messageStore.get(key.id);
                if (stored) {
                    return stored;
                }
                return undefined;
            },
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
                this.processedMessages.clear(); // Clear processed messages on disconnect
                const code = lastDisconnect?.error?.output?.statusCode;
                const loggedOut = code === DisconnectReason?.loggedOut;
                console.log('[whatsapp] Disconnected.', loggedOut ? 'Logged out.' : 'Reconnecting in 5s...');
                if (!loggedOut) setTimeout(() => this.startSocket(gateway), 5000);
            } else if (connection === 'open') {
                this.status = 'connected';
                this.qrStr = null;
                console.log('[whatsapp] ✅ Connected!');

                // Declare initial presence to enable sendPresenceUpdate
                try {
                    this.sock.sendPresenceUpdate('available');
                } catch { /* ignore */ }
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

                const msgId = msg.key?.id;
                if (!msgId) continue;

                // Deduplication cache check
                if (this.processedMessages.has(msgId)) {
                    console.log(`[whatsapp-debug] Skipping already processed message ID: ${msgId}`);
                    continue;
                }

                // Add to cache & maintain bounded size
                this.processedMessages.add(msgId);
                if (this.processedMessages.size > 1000) {
                    const firstItem = this.processedMessages.values().next().value;
                    if (firstItem) this.processedMessages.delete(firstItem);
                }

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
                    if (id.includes('@g.us') || id.includes('@lid')) return id;
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
                // We consider it self if the normalized base remote JID is my JID
                const isSelf = baseRemoteJid === myJid || (msg.key?.fromMe && jid.endsWith('@lid'));
                // Wait: (msg.key?.fromMe && jid.endsWith('@lid')) is still a bit broad but safer than before
                // if we check if there's an alternative to detect my own LID.

                if (msg.key?.fromMe && !isSelf) {
                    console.log(`[whatsapp-debug] Dropped secondary fromMe message to ${jid}`);
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
                    console.log(`[whatsapp-debug] Initial sendPresenceUpdate(composing) for ${jid}`);
                    await this.sock?.presenceSubscribe(jid);
                    await this.sock?.sendPresenceUpdate('composing', jid);
                    console.log(`[whatsapp-debug] Initial sendPresenceUpdate(composing) successful`);
                } catch { /* ignore */ }

                console.log(`[whatsapp] Ingesting message to gateway: ${text.trim()} (fromMe=${msg.key?.fromMe})`);

                // For self-messages, we MUST use our own canonical JID as peerId 
                // to ensure the gateway treats it as a single "Me" session.
                const targetJid = msg.key?.fromMe ? myJid : jid;

                // ROUTING LOGIC (Anti-Regression):
                // 1. For non-self messages, we map the peerId to the incoming JID.
                // 2. For self-messages (Notes to self), we do NOT map to the LID for sending.
                //    Sending to a LID from the bot account often fails to render on the phone.
                //    Replies to self-chat must target the canonical @s.whatsapp.net JID.
                // 3. However, typing indicators (presence) ONLY work if sent to the LID.
                if (msg.key?.fromMe) {
                    this.peerToPresenceJid.set(targetJid, jid);
                    // Don't set peerToLastJid -> falls through to formatJid() -> @s.whatsapp.net
                } else {
                    this.peerToLastJid.set(targetJid, jid);
                }

                await gateway.ingest(CHANNEL, targetJid, text.trim(), undefined, { fromMe: !!msg.key?.fromMe });


                try {
                    console.log(`[whatsapp-debug] Final sendPresenceUpdate(paused) for ${jid}`);
                    await this.sock?.sendPresenceUpdate('paused', jid);
                } catch { /* ignore */ }
            }
        });
    }
}
