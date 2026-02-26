/**
 * @license Apache-2.0
 * @geminiclaw/gateway — MessageQueue
 *
 * Per-session FIFO queue to prevent concurrent processing of messages
 * from the same session (avoids context corruption).
 */
import type { InboundMessage, AgentResponse } from '@geminiclaw/memory';
import type { AgentRuntime } from '@geminiclaw/core';
export declare class MessageQueue {
    private queues;
    private processing;
    /** Enqueue a message for a session and return a promise of the response */
    enqueue(msg: InboundMessage, runtime: AgentRuntime): Promise<AgentResponse>;
    /** Process items for a session one at a time */
    private drain;
    get size(): number;
}
//# sourceMappingURL=MessageQueue.d.ts.map