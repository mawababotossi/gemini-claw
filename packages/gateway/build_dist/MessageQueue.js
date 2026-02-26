export class MessageQueue {
    queues = new Map();
    processing = new Set();
    /** Enqueue a message for a session and return a promise of the response */
    enqueue(msg, runtime) {
        return new Promise((resolve, reject) => {
            const sessionId = msg.sessionId;
            if (!this.queues.has(sessionId)) {
                this.queues.set(sessionId, []);
            }
            this.queues.get(sessionId).push({ msg, resolve, reject });
            this.drain(sessionId, runtime);
        });
    }
    /** Process items for a session one at a time */
    async drain(sessionId, runtime) {
        if (this.processing.has(sessionId))
            return;
        this.processing.add(sessionId);
        const queue = this.queues.get(sessionId);
        while (queue.length > 0) {
            const item = queue.shift();
            try {
                const response = await runtime.process(item.msg);
                item.resolve(response);
            }
            catch (err) {
                item.reject(err);
            }
        }
        this.processing.delete(sessionId);
    }
    get size() {
        let total = 0;
        for (const q of this.queues.values())
            total += q.length;
        return total;
    }
}
//# sourceMappingURL=MessageQueue.js.map