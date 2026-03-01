/**
 * @license Apache-2.0
 * @geminiclaw/gateway — MessageQueue
 *
 * Per-session FIFO queue to prevent concurrent processing of messages
 * from the same session (avoids context corruption).
 */
import type { InboundMessage, AgentResponse } from '@geminiclaw/memory';
import type { AgentRuntime } from '@geminiclaw/core';

type Resolver = (value: AgentResponse) => void;
type Rejecter = (reason: unknown) => void;

interface QueueItem {
    msg: InboundMessage;
    peerAgents?: { name: string; model: string }[];
    options?: { onChunk?: (text: string) => Promise<void> };
    resolve: Resolver;
    reject: Rejecter;
}

export class MessageQueue {
    private queues = new Map<string, QueueItem[]>();
    private processing = new Set<string>();
    private static MAX_QUEUE_PER_SESSION = 10;

    /** Enqueue a message for a session and return a promise of the response */
    enqueue(
        msg: InboundMessage,
        runtime: AgentRuntime,
        peerAgents?: { name: string; model: string }[],
        options?: { onChunk?: (text: string) => Promise<void> }
    ): Promise<AgentResponse> {
        return new Promise<AgentResponse>((resolve, reject) => {
            const sessionId = msg.sessionId;
            if (!this.queues.has(sessionId)) {
                this.queues.set(sessionId, []);
            }
            const queue = this.queues.get(sessionId)!;

            if (queue.length >= MessageQueue.MAX_QUEUE_PER_SESSION) {
                console.warn(`[gateway/queue] Queue full for session ${sessionId}. Rejecting message.`);
                return reject(new Error('Queue full. Please wait for the agent to finish its current tasks.'));
            }

            queue.push({ msg, peerAgents, options, resolve, reject });
            this.drain(sessionId, runtime).catch(err => {
                console.error(`[gateway/queue] Unexpected error in drain for ${sessionId}:`, err);
            });
        });
    }

    /** Process items for a session one at a time */
    private async drain(sessionId: string, runtime: AgentRuntime): Promise<void> {
        if (this.processing.has(sessionId)) return;
        this.processing.add(sessionId);

        try {
            const queue = this.queues.get(sessionId);
            if (!queue) return;

            while (queue.length > 0) {
                const item = queue.shift()!;
                try {
                    const response = await runtime.processMessage(item.msg, item.peerAgents, item.options);
                    item.resolve(response);
                } catch (err) {
                    item.reject(err);
                }
            }
            // Cleanup: remove empty queue from map to avoid memory leak
            this.queues.delete(sessionId);
        } finally {
            this.processing.delete(sessionId);
        }
    }

    get size(): number {
        let total = 0;
        for (const q of this.queues.values()) total += q.length;
        return total;
    }
}
