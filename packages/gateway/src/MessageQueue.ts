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
    resolve: Resolver;
    reject: Rejecter;
}

export class MessageQueue {
    private queues = new Map<string, QueueItem[]>();
    private processing = new Set<string>();

    /** Enqueue a message for a session and return a promise of the response */
    enqueue(msg: InboundMessage, runtime: AgentRuntime): Promise<AgentResponse> {
        return new Promise<AgentResponse>((resolve, reject) => {
            const sessionId = msg.sessionId;
            if (!this.queues.has(sessionId)) {
                this.queues.set(sessionId, []);
            }
            this.queues.get(sessionId)!.push({ msg, resolve, reject });
            this.drain(sessionId, runtime);
        });
    }

    /** Process items for a session one at a time */
    private async drain(sessionId: string, runtime: AgentRuntime): Promise<void> {
        if (this.processing.has(sessionId)) return;
        this.processing.add(sessionId);

        const queue = this.queues.get(sessionId)!;
        while (queue.length > 0) {
            const item = queue.shift()!;
            try {
                const response = await runtime.process(item.msg);
                item.resolve(response);
            } catch (err) {
                item.reject(err);
            }
        }

        this.processing.delete(sessionId);
    }

    get size(): number {
        let total = 0;
        for (const q of this.queues.values()) total += q.length;
        return total;
    }
}
