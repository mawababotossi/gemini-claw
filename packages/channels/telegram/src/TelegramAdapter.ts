/**
 * @license Apache-2.0
 * @geminiclaw/channel-telegram — TelegramAdapter
 *
 * Uses Telegraf to receive messages and dispatch them through the Gateway.
 * Supports private chats, groups (with optional @mention gating), and photos.
 */
import { Telegraf } from 'telegraf';
import type { IGateway } from '@geminiclaw/core';

const CHANNEL = 'telegram';

export interface TelegramAdapterOptions {
    /** If true, only respond when @mentioned in groups */
    mentionOnly?: boolean;
}

export class TelegramAdapter {
    private bot: Telegraf;
    private botUsername: string | null = null;

    constructor(
        token: string,
        private options: TelegramAdapterOptions = {},
    ) {
        this.bot = new Telegraf(token);
    }

    connect(gateway: IGateway): void {
        // Register send callback so gateway can reply to Telegram
        gateway.registerChannel(CHANNEL, async (peerId: string, text: string) => {
            try {
                const chunks = this.splitMessage(text);
                for (const chunk of chunks) {
                    await this.bot.telegram.sendMessage(peerId, chunk, {
                        parse_mode: 'Markdown',
                    });
                }
            } catch {
                // Retry without markdown on parse error
                try { await this.bot.telegram.sendMessage(peerId, text); } catch { /* ignore */ }
            }
        });

        // Resolve bot username for mention detection
        this.bot.telegram.getMe().then((me) => {
            this.botUsername = me.username ?? null;
        }).catch(() => { });

        // Handle text messages
        this.bot.on('text', async (ctx) => {
            const text = ctx.message.text;
            const chatId = String(ctx.chat.id);
            await this.processMessage(ctx.chat.type, chatId, text, gateway);
        });

        // Handle photo messages with captions
        this.bot.on('photo', async (ctx) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const caption: string = (ctx.message as any).caption ?? '';
            if (caption.trim()) {
                const chatId = String(ctx.chat.id);
                await this.processMessage(ctx.chat.type, chatId, caption, gateway);
            }
        });

        // Handle voice messages
        this.bot.on('voice', async (ctx) => {
            await ctx.reply('🎙️ Voice messages are not yet supported. Please send text.');
        });

        this.bot.launch().then(() => {
            console.log('[telegram] Bot polling started.');
        }).catch((err) => {
            console.error('[telegram] Failed to start:', err);
        });

        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }

    private async processMessage(
        chatType: string,
        chatId: string,
        text: string,
        gateway: IGateway,
    ): Promise<void> {
        const isGroup = chatType === 'group' || chatType === 'supergroup';

        // Mention-only mode
        if (this.options.mentionOnly && isGroup && this.botUsername) {
            if (!text.includes(`@${this.botUsername}`)) return;
            text = text.replace(`@${this.botUsername}`, '').trim();
        }

        if (!text.trim()) return;

        await gateway.ingest(CHANNEL, chatId, text);
    }

    private splitMessage(text: string, maxLen = 4000): string[] {
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
