/**
 * @license Apache-2.0
 * @clawgate/channel-discord — DiscordAdapter
 */
import { Client, GatewayIntentBits, Partials, TextChannel, Message } from 'discord.js';
import type { IGateway } from '@clawgate/core';
import type { Attachment, OutboundAttachment } from '@clawgate/memory';

const CHANNEL = 'discord';

export interface DiscordAdapterOptions {
    /** Channels to monitor (id or name) */
    channels?: string[];
}

export class DiscordAdapter {
    private client: Client;

    constructor(
        token: string,
        private options: DiscordAdapterOptions = {},
    ) {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages,
            ],
            partials: [Partials.Channel],
        });
    }

    connect(gateway: IGateway): void {
        gateway.registerChannel(
            CHANNEL,
            // Send callback
            async (peerId: string, text: string) => {
                try {
                    const channel = await this.client.channels.fetch(peerId);
                    if (channel instanceof TextChannel || channel?.isDMBased()) {
                        const chunks = this.splitMessage(text);
                        for (const chunk of chunks) {
                            await (channel as any).send(chunk);
                        }
                    }
                } catch (err) {
                    console.error('[discord] Failed to send message:', err);
                }
            },
            // Activity callback
            async (peerId, type) => {
                try {
                    const channel = await this.client.channels.fetch(peerId);
                    if (channel instanceof TextChannel || channel?.isDMBased()) {
                        if (type === 'typing') await (channel as any).sendTyping();
                    }
                } catch { /* ignore */ }
            },
            // File callback
            async (peerId, att: OutboundAttachment) => {
                try {
                    const channel = await this.client.channels.fetch(peerId);
                    if (channel instanceof TextChannel || channel?.isDMBased()) {
                        await (channel as any).send({
                            files: [{
                                attachment: att.data,
                                name: att.filename,
                            }],
                            content: att.caption
                        });
                    }
                } catch (err) {
                    console.error('[discord] Failed to send file:', err);
                }
            }
        );

        this.client.on('messageCreate', async (message: Message) => {
            if (message.author.bot) return;

            // Optional channel filtering
            if (this.options.channels && this.options.channels.length > 0) {
                const isAllowed = this.options.channels.some(c =>
                    c === message.channel.id || (message.channel as any).name === c
                );
                if (!isAllowed && !message.channel.isDMBased()) return;
            }

            const attachments: Attachment[] = [];
            for (const att of message.attachments.values()) {
                try {
                    const { default: fetch } = await import('node-fetch');
                    const res = await (fetch as any)(att.url);
                    const buffer = Buffer.from(await res.arrayBuffer());
                    attachments.push({
                        type: att.contentType?.startsWith('image/') ? 'image' : 'document',
                        mimeType: att.contentType || 'application/octet-stream',
                        data: buffer,
                        filename: att.name
                    });
                } catch (err) {
                    console.error('[discord] Attachment download failed:', err);
                }
            }

            await gateway.ingest(CHANNEL, message.channel.id, message.content, attachments);
        });

        this.client.login(process.env['DISCORD_TOKEN']).then(() => {
            console.log(`[discord] Logged in as ${this.client.user?.tag}`);
        }).catch((err: any) => {
            console.error('[discord] Login failed:', err);
        });
    }

    private splitMessage(text: string, maxLen = 1900): string[] {
        if (text.length <= maxLen) return [text];
        const chunks: string[] = [];
        let start = 0;
        while (start < text.length) {
            let end = Math.min(start + maxLen, text.length);
            const lastNewline = text.lastIndexOf('\n', end);
            if (lastNewline > start) end = lastNewline + 1;
            chunks.push(text.slice(start, end));
            start = end;
        }
        return chunks;
    }
}
