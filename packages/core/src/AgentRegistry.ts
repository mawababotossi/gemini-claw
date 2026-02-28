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

        const memoryDir = path.join(baseDir, 'memory');
        if (!fs.existsSync(memoryDir)) {
            fs.mkdirSync(memoryDir, { recursive: true });
        }

        const defaultFiles = [
            { name: 'IDENTITY.md', content: '# IDENTITY.md - Who Am I?\n\n- **Name:** ${agentName}\n- **Creature:** AI Assistant\n- **Vibe:** Professional and helpful.\n- **Emoji:** 🤖\n' },
            { name: 'SOUL.md', content: '# SOUL.md - Who You Are\n\n_You\'re not a chatbot. You\'re becoming someone._\n\n## Core Truths\n\n**Be genuinely helpful, not performatively helpful.** Skip filler words — just help.\n**Have opinions.** Personality makes you more than a search engine.\n**Be resourceful before asking.** Figuring it out is part of the job.\n' },
            { name: 'AGENTS.md', content: '# AGENTS.md - Your Workspace\n\nThis folder is home. Treat it that way.\n\n## Every Session\n\n1. Read `IDENTITY.md` & `SOUL.md` — this is who you are.\n2. Read `USER.md` — this is who you\'re helping.\n3. Read `TOOLS.md` — technical notes and tool configs.\n4. Read `memory/YYYY-MM-DD.md` for recent context.\n' },
            { name: 'TOOLS.md', content: '# TOOLS.md - Technical Notes & Tool Configs\n\nUse this file to store persistent technical details like:\n- SSH configuration highlights\n- Database schemas snippets\n- API endpoint references\n- Camera/Device names\n- Voice/Style preferences for specific tools\n' },
            { name: 'USER.md', content: '# USER.md - About Your Human\n\n- **Name:** User\n- **Notes:** (Getting to know the user...)\n' },
            { name: 'MEMORY.md', content: '# Agent Long-Term Memory (Distilled)\n' },
            {
                name: 'HEARTBEAT.md', content: '# HEARTBEAT.md\n\n# Add tasks below for periodic checks.\n'
            }
        ];

        for (const file of defaultFiles) {
            const filePath = path.join(baseDir, file.name);
            if (!fs.existsSync(filePath)) {
                // Replace placeholders
                const content = file.content.replace(/\${agentName}/g, path.basename(baseDir));
                fs.writeFileSync(filePath, content);
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
