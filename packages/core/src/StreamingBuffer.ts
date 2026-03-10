/**
 * @license Apache-2.0
 * @clawgate/core — StreamingBuffer
 * 
 * Regroupe les chunks de texte et les envoie par rafales pour éviter
 * le rate limiting des services de messagerie (WhatsApp).
 */

type SendFn = (text: string) => Promise<void>;

export class StreamingBuffer {
    private buffer = '';
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly sendFn: SendFn,
        private readonly flushDelayMs = 300,
        private readonly silent = false
    ) { }

    /**
     * Ajoute du texte au buffer et réinitialise le délai de flush.
     */
    append(text: string): void {
        this.buffer += text;
        if (this.silent) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), this.flushDelayMs);
    }

    /**
     * Force l'envoi immédiat du contenu actuel.
     */
    async flushNow(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        await this.flush();
    }

    private async flush(): Promise<void> {
        const text = this.buffer.trim();
        this.buffer = '';
        this.timer = null;

        if (text.length > 0) {
            try {
                await this.sendFn(text);
            } catch (err) {
                console.error('[core/streaming] Failed to send chunk:', err);
            }
        }
    }

    /**
     * Nettoie le buffer et annule les timers en cours.
     */
    destroy(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.buffer = '';
    }
}
