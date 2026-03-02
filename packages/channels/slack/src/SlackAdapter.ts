/**
 * @license Apache-2.0
 * @geminiclaw/channel-slack — SlackAdapter
 */
import { App } from '@slack/bolt';
import type { IGateway } from '@geminiclaw/core';
import type { Attachment, OutboundAttachment } from '@geminiclaw/memory';

const CHANNEL = 'slack';

export interface SlackAdapterOptions {
    /** Bot Token (xoxb-...) */
    token: string;
    /** Signing Secret */
    signingSecret: string;
    /** App Token (xapp-...) for Socket Mode */
    appToken?: string;
}

export class SlackAdapter {
    private app: App;

    constructor(options: SlackAdapterOptions) {
        this.app = new App({
            token: options.token,
            signingSecret: options.signingSecret,
            appToken: options.appToken,
            socketMode: !!options.appToken,
        });
    }

    connect(gateway: IGateway): void {
        gateway.registerChannel(
            CHANNEL,
            // Send callback
            async (peerId: string, text: string) => {
                try {
                    await this.app.client.chat.postMessage({
                        channel: peerId,
                        text: text,
                    });
                } catch (err) {
                    console.error('[slack] Failed to send message:', err);
                }
            },
            // Activity callback
            async (peerId, type) => {
                // Slack doesn't have a simple typing API for bots unless using RTM or specific events
                // Bolt doesn't expose it easily in Socket Mode for a specific channel without a trigger
            },
            // File callback
            async (peerId, att: OutboundAttachment) => {
                try {
                    await this.app.client.files.uploadV2({
                        channel_id: peerId,
                        initial_comment: att.caption,
                        file: att.data,
                        filename: att.filename,
                    });
                } catch (err) {
                    console.error('[slack] Failed to send file:', err);
                }
            }
        );

        this.app.message(async ({ message, say }) => {
            // Ignore bot messages and sub-messages
            if ((message as any).bot_id) return;
            if (message.type !== 'message') return;

            const m = message as any;
            const attachments: Attachment[] = [];

            if (m.files) {
                for (const file of m.files) {
                    try {
                        const { default: fetch } = await import('node-fetch');
                        const res = await (fetch as any)(file.url_private_download, {
                            headers: { Authorization: `Bearer ${process.env['SLACK_BOT_TOKEN']}` }
                        });
                        const buffer = Buffer.from(await res.arrayBuffer());
                        attachments.push({
                            type: file.mimetype.startsWith('image/') ? 'image' : 'document',
                            mimeType: file.mimetype,
                            data: buffer,
                            filename: file.name
                        });
                    } catch (err) {
                        console.error('[slack] File download failed:', err);
                    }
                }
            }

            await gateway.ingest(CHANNEL, m.channel, m.text || '', attachments);
        });

        this.app.start().then(() => {
            console.log('[slack] Slack adapter started.');
        }).catch(err => {
            console.error('[slack] Failed to start:', err);
        });
    }
}
