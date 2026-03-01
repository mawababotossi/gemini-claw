/**
 * @license Apache-2.0
 * @geminiclaw/memory — JSON file-based session store (no native compilation)
 * Uses lowdb v7 for atomic JSON persistence.
 */
import { JSONFileSyncPreset } from 'lowdb/node';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Session } from './types.js';

interface DbSchema {
    sessions: Session[];
}

const DEFAULT_DATA: DbSchema = { sessions: [] };

export class SessionStore {
    private db: ReturnType<typeof JSONFileSyncPreset<DbSchema>>;
    private writeTimer?: NodeJS.Timeout;

    constructor(dataDir: string) {
        if (!existsSync(dataDir)) {
            mkdirSync(dataDir, { recursive: true });
        }
        const dbPath = join(dataDir, 'sessions.json');
        this.db = JSONFileSyncPreset<DbSchema>(dbPath, DEFAULT_DATA);
    }

    private scheduleWrite() {
        if (this.writeTimer) return;
        this.writeTimer = setTimeout(() => {
            this.db.write();
            this.writeTimer = undefined;
        }, 1000); // Batch writes every 1 second
    }

    /** Get or create a session for (channel, peerId) */
    getOrCreate(channel: string, peerId: string, agentName: string): Session {
        const existing = this.db.data.sessions.find(
            (s: Session) => s.channel === channel && s.peerId === peerId,
        );
        if (existing) return existing;

        const id = `${channel}_${peerId}_${Date.now()}`;
        const now = Date.now();
        const session: Session = { id, channel, peerId, agentName, createdAt: now, updatedAt: now };
        this.db.data.sessions.push(session);
        this.scheduleWrite();
        return session;
    }

    get(sessionId: string): Session | undefined {
        return this.db.data.sessions.find((s: Session) => s.id === sessionId);
    }

    findByChannelAndPeer(channel: string, peerId: string): Session | undefined {
        return this.db.data.sessions.find(
            (s: Session) => s.channel === channel && s.peerId === peerId,
        );
    }

    listAll(): Session[] {
        return [...this.db.data.sessions].sort(
            (a: Session, b: Session) => b.updatedAt - a.updatedAt,
        );
    }

    touch(sessionId: string): void {
        const s = this.db.data.sessions.find((s: Session) => s.id === sessionId);
        if (s) {
            s.updatedAt = Date.now();
            this.scheduleWrite();
        }
    }

    delete(sessionId: string): void {
        this.db.data.sessions = this.db.data.sessions.filter(
            (s: Session) => s.id !== sessionId,
        );
        this.scheduleWrite();
    }

    /** Force write and clear timer */
    close(): void {
        if (this.writeTimer) {
            clearTimeout(this.writeTimer);
            this.db.write();
            this.writeTimer = undefined;
        }
    }
}
