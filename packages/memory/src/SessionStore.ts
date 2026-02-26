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

    constructor(dataDir: string) {
        if (!existsSync(dataDir)) {
            mkdirSync(dataDir, { recursive: true });
        }
        const dbPath = join(dataDir, 'sessions.json');
        this.db = JSONFileSyncPreset<DbSchema>(dbPath, DEFAULT_DATA);
    }

    /** Get or create a session for (channel, peerId) */
    getOrCreate(channel: string, peerId: string, agentName: string): Session {
        this.db.read();
        const existing = this.db.data.sessions.find(
            (s: Session) => s.channel === channel && s.peerId === peerId,
        );
        if (existing) return existing;

        const id = `${channel}_${peerId}_${Date.now()}`;
        const now = Date.now();
        const session: Session = { id, channel, peerId, agentName, createdAt: now, updatedAt: now };
        this.db.data.sessions.push(session);
        this.db.write();
        return session;
    }

    get(sessionId: string): Session | undefined {
        this.db.read();
        return this.db.data.sessions.find((s: Session) => s.id === sessionId);
    }

    findByChannelAndPeer(channel: string, peerId: string): Session | undefined {
        this.db.read();
        return this.db.data.sessions.find(
            (s: Session) => s.channel === channel && s.peerId === peerId,
        );
    }

    listAll(): Session[] {
        this.db.read();
        return [...this.db.data.sessions].sort(
            (a: Session, b: Session) => b.updatedAt - a.updatedAt,
        );
    }

    touch(sessionId: string): void {
        this.db.read();
        const s = this.db.data.sessions.find((s: Session) => s.id === sessionId);
        if (s) { s.updatedAt = Date.now(); this.db.write(); }
    }

    delete(sessionId: string): void {
        this.db.read();
        this.db.data.sessions = this.db.data.sessions.filter(
            (s: Session) => s.id !== sessionId,
        );
        this.db.write();
    }

    // Compatibility stub (no-op for lowdb)
    close(): void { }
}
