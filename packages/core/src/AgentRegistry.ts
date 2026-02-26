/**
 * @license Apache-2.0
 * @geminiclaw/core — Registry of all configured AgentRuntime instances
 */
import { TranscriptStore } from '@geminiclaw/memory';
import { AgentRuntime } from './AgentRuntime.js';
import type { AgentConfig } from './types.js';
import type { SkillRegistry } from '@geminiclaw/skills';
import fs from 'node:fs';
import path from 'node:path';

export class AgentRegistry {
    private runtimes = new Map<string, AgentRuntime>();

    constructor(
        configs: AgentConfig[],
        private transcripts: TranscriptStore,
        private skillRegistry?: SkillRegistry,
        private baseDataDir: string = path.resolve(process.cwd(), 'data')
    ) {
        for (const config of configs) {
            this.add(config);
        }
    }

    add(config: AgentConfig): void {
        if (this.runtimes.has(config.name)) {
            throw new Error(`Agent with name "${config.name}" already exists`);
        }

        // Auto-initialize baseDir if not provided
        if (!config.baseDir) {
            config.baseDir = path.join(this.baseDataDir, 'agents', config.name);
        }

        this.ensureAgentFiles(config.baseDir);

        this.runtimes.set(config.name, new AgentRuntime(config, this.transcripts, this.skillRegistry));
    }

    private ensureAgentFiles(baseDir: string): void {
        const workspaceDir = path.join(baseDir, 'workspace');
        if (!fs.existsSync(workspaceDir)) {
            fs.mkdirSync(workspaceDir, { recursive: true });
        }

        const defaultFiles = [
            { name: 'AGENTS.md', content: '# Agent personality and instructions\n' },
            { name: 'USER.md', content: '# Instructions on user interaction\n' },
            { name: 'SOUL.md', content: '# The core essence of the agent\n' },
            { name: 'MEMORY.md', content: '# Agent Long-Term Memory\n' },
            { name: 'HEARTBEAT.md', content: '# Heartbeat Instructions\nDescribe here what the agent should check autonomously.\nIf everything is fine and there is no need to disturb the user, reply EXACTLY with: HEARTBEAT_OK\n' }
        ];

        for (const file of defaultFiles) {
            const filePath = path.join(baseDir, file.name);
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, file.content);
            }
        }
    }

    async update(name: string, config: AgentConfig): Promise<void> {
        const existing = this.runtimes.get(name);
        if (!existing) {
            throw new Error(`No agent configured with name "${name}"`);
        }

        // If name changes, we need to handle the map key change
        if (name !== config.name) {
            await this.remove(name);
            this.add(config);
        } else {
            await existing.shutdown();
            this.runtimes.set(name, new AgentRuntime(config, this.transcripts, this.skillRegistry));
        }
    }

    async remove(name: string): Promise<void> {
        const runtime = this.runtimes.get(name);
        if (runtime) {
            await runtime.shutdown();
            this.runtimes.delete(name);
        }
    }

    get(name: string): AgentRuntime {
        const runtime = this.runtimes.get(name);
        if (!runtime) {
            throw new Error(`No agent configured with name "${name}"`);
        }
        return runtime;
    }

    getAll(): IterableIterator<AgentRuntime> {
        return this.runtimes.values();
    }

    list(): string[] {
        return [...this.runtimes.keys()];
    }

    listConfigs(): AgentConfig[] {
        return [...this.runtimes.values()].map(r => r.getConfig());
    }

    async shutdown(): Promise<void> {
        await Promise.all([...this.runtimes.values()].map((r) => r.shutdown()));
    }
}
