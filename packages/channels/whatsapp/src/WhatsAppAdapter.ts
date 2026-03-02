/**
 * @license Apache-2.0
 * @clawgate/channel-whatsapp — WhatsAppAdapter (Baileys v6)
 *
 * QR code based pairing. After first login, auth is cached in data/whatsapp_auth.
 * Reconnects automatically if disconnected.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BaileysModule = any;

import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type { IGateway } from '@clawgate/core';
import type { Attachment, OutboundAttachment } from '@clawgate/memory';

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
            },
            async (peerId, att: OutboundAttachment) => {
                if (!this.sock) return;
                try {
                    const formatJid = (id: string) => {
                        if (id.includes('@')) return id;
                        const clean = id.replace(/\+/g, '').trim();
                        return `${clean}@s.whatsapp.net`;
                    };
                    const realJid = this.peerToLastJid.get(peerId) || formatJid(peerId);

                    if (att.type === 'image' || att.mimeType.startsWith('image/')) {
                        await this.sock.sendMessage(realJid, {
                            image: att.data,
                            caption: att.caption || att.filename,
                            mimetype: att.mimeType,
                        });
                    } else {
                        await this.sock.sendMessage(realJid, {
                            document: att.data,
                            fileName: att.filename,
                            caption: att.caption,
                            mimetype: att.mimeType,
                        });
                    }
                    console.log(`[whatsapp-debug] File ${att.filename} sent successful to ${realJid}`);
                } catch (err) {
                    console.error('[whatsapp] File send failed:', err);
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
        const downloadContentFromMessage = b.downloadContentFromMessage || baileysModule.downloadContentFromMessage;
        const toBuffer = b.toBuffer || baileysModule.toBuffer;

        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
        const { version } = await fetchLatestBaileysVersion();

        this.sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: true,
            syncFullHistory: false,
            logger: { level: 'silent', trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { }, fatal: () => { }, child: () => ({ level: 'silent', trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { }, fatal: () => { }, child: () => ({}) }) },
            browser: ['ClawGate', 'Chrome', '1.0.0'],
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
                (gateway as any).setWhatsAppConnected?.(false);
                if (!loggedOut) setTimeout(() => this.startSocket(gateway), 5000);
            } else if (connection === 'open') {
                this.status = 'connected';
                this.qrStr = null;
                console.log('[whatsapp] ✅ Connected!');
                (gateway as any).setWhatsAppConnected?.(true);

                // Declare initial presence to enable sendPresenceUpdate
                try {
                    this.sock.sendPresenceUpdate('available');
                } catch { /* ignore */ }
            }
        });

        this.sock.ev.on('messages.upsert', async (event: BaileysModule) => {
            const { messages, type } = event;
            if (type !== 'notify') return;

            for (const msg of messages) {
                if (!msg.message) continue;
                if (msg.key?.fromMe && !msg.key?.remoteJid?.endsWith('@lid')) continue; // Ignore my own non-self messages

                const msgId = msg.key?.id;
                if (!msgId) continue;
                if (this.processedMessages.has(msgId)) continue;
                this.processedMessages.add(msgId);

                const jid: string = msg.key?.remoteJid ?? '';
                if (!jid) continue;

                // Extract basic info
                const content = msg.message;
                const textBody = content.conversation
                    || content.extendedTextMessage?.text
                    || content.imageMessage?.caption
                    || content.documentMessage?.caption
                    || '';

                if (textBody.endsWith('\u200B')) continue; // Anti-loop

                const normalizeJid = (id: string) => {
                    if (!id) return '';
                    if (id.includes('@g.us') || id.includes('@lid')) return id;
                    return `${id.split('@')[0].split(':')[0]}@s.whatsapp.net`;
                };

                const myJid = this.sock?.user?.id ? normalizeJid(this.sock.user.id) : '';
                const baseRemoteJid = normalizeJid(jid);
                const isSelf = baseRemoteJid === myJid || (msg.key?.fromMe && jid.endsWith('@lid'));
                const targetJid = isSelf ? myJid : jid;

                if (isSelf) {
                    this.peerToPresenceJid.set(targetJid, jid);
                } else {
                    this.peerToLastJid.set(targetJid, jid);
                }

                // Handle media
                let attachments: Attachment[] | undefined;
                if (content.imageMessage || content.documentMessage) {
                    try {
                        const downloadMedia = async (messageContent: any, mediaType: string): Promise<Buffer> => {
                            const stream = await downloadContentFromMessage(messageContent, mediaType);
                            return toBuffer(stream);
                        };

                        if (content.imageMessage) {
                            const buffer = await downloadMedia(content.imageMessage, 'image');
                            attachments = [{
                                type: 'image',
                                mimeType: content.imageMessage.mimetype || 'image/jpeg',
                                data: buffer,
                                filename: `whatsapp_image_${Date.now()}.jpg`,
                            }];
                        } else if (content.documentMessage) {
                            const buffer = await downloadMedia(content.documentMessage, 'document');
                            attachments = [{
                                type: 'document',
                                mimeType: content.documentMessage.mimetype || 'application/octet-stream',
                                data: buffer,
                                filename: content.documentMessage.fileName || 'document',
                            }];
                        }
                    } catch (err) {
                        console.error('[whatsapp] Failed to download media:', err);
                    }
                }

                if (!textBody.trim() && !attachments) continue;

                try {
                    await this.sock?.presenceSubscribe(jid);
                    await this.sock?.sendPresenceUpdate('composing', jid);
                } catch { /* ignore */ }

                await gateway.ingest(CHANNEL, targetJid, textBody.trim() || '[Média]', attachments, { fromMe: !!msg.key?.fromMe });

                try {
                    await this.sock?.sendPresenceUpdate('paused', jid);
                } catch { /* ignore */ }
            }
        });
    }
}
