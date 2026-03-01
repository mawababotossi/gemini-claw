/**
 * @license Apache-2.0
 * @geminiclaw/memory — JSONL transcript store (OpenClaw-compatible format)
 */
import {
    appendFileSync,
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    readSync,
    statSync,
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
        const path = this.filePath(sessionId);
        if (!existsSync(path)) return [];

        // Lire les derniers octets du fichier (~300 bytes par ligne * limit) pour éviter de tout charger
        const APPROX_LINE_SIZE = 300;
        const bufferSize = limit * APPROX_LINE_SIZE;
        const { size } = statSync(path);

        // Si le fichier est petit, on peut tout charger normalement
        if (size <= bufferSize) {
            return this.load(sessionId).slice(-limit);
        }

        const start = size - bufferSize;
        const fd = openSync(path, 'r');
        const buf = Buffer.allocUnsafe(size - start);

        try {
            readSync(fd, buf, 0, buf.length, start);
        } finally {
            closeSync(fd);
        }

        const lines = buf.toString('utf8').split('\n').filter((l) => l.trim().length > 0);

        // La première ligne est probablement incomplète si on n'a pas commencé au début du fichier
        const safeLines = lines.slice(1);

        const results = safeLines.slice(-limit).map((line) => {
            try {
                return JSON.parse(line) as ChatMessage;
            } catch (err) {
                console.error(`[memory/transcript] JSON parse error in loadRecent:`, err);
                return null;
            }
        }).filter(m => m !== null) as ChatMessage[];

        // Si on n'a pas assez de messages, on retente avec un buffer plus grand ou on charge tout
        if (results.length < limit && size > bufferSize * 2) {
            // fallback simple pour la sécurité if needed, mais 300 octets/ligne est généreux
        }

        return results;
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
