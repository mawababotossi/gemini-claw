/**
 * @license Apache-2.0
 * @geminiclaw/memory — JSONL transcript store (OpenClaw-compatible format)
 */
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage } from './types.js';

export class TranscriptStore {
    private transcriptsDir: string;

    constructor(dataDir: string) {
        this.transcriptsDir = join(dataDir, 'transcripts');
        if (!existsSync(this.transcriptsDir)) {
            mkdirSync(this.transcriptsDir, { recursive: true });
        }
    }

    private filePath(sessionId: string): string {
        return join(this.transcriptsDir, `${sessionId}.jsonl`);
    }

    /** Append a single message to the session transcript */
    append(sessionId: string, message: ChatMessage): void {
        appendFileSync(
            this.filePath(sessionId),
            JSON.stringify(message) + '\n',
            'utf8',
        );
    }

    /** Load all messages for a session */
    load(sessionId: string): ChatMessage[] {
        const path = this.filePath(sessionId);
        if (!existsSync(path)) return [];

        const lines = readFileSync(path, 'utf8')
            .split('\n')
            .filter((l) => l.trim().length > 0);

        return lines.map((line) => JSON.parse(line) as ChatMessage);
    }

    /**
     * Load the last N messages (for context window management).
     * Returns at most `limit` messages.
     */
    loadRecent(sessionId: string, limit: number = 50): ChatMessage[] {
        const all = this.load(sessionId);
        return all.slice(-limit);
    }

    /** Overwrite the transcript (used for compaction/summarization) */
    compact(sessionId: string, messages: ChatMessage[]): void {
        writeFileSync(
            this.filePath(sessionId),
            messages.map((m) => JSON.stringify(m)).join('\n') + '\n',
            'utf8',
        );
    }

    /** Delete the transcript file */
    delete(sessionId: string): void {
        const path = this.filePath(sessionId);
        if (existsSync(path)) {
            import('node:fs').then(({ unlinkSync }) => unlinkSync(path));
        }
    }
}
