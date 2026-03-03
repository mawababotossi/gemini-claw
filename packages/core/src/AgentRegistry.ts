/**
 * @license Apache-2.0
 * @clawgate/core — Registry of all configured AgentRuntime instances
 */
import { TranscriptStore } from '@clawgate/memory';
import { AgentRuntime } from './AgentRuntime.js';
import type { AgentConfig } from './types.js';
import type { SkillRegistry } from '@clawgate/skills';
import fs from 'node:fs';
import path from 'node:path';
import { validateAgentName, assertWithinBaseDir } from './utils/validation.js';

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
        const safeName = validateAgentName(config.name);
        config.name = safeName;

        if (this.runtimes.has(config.name)) {
            throw new Error(`Agent with name "${config.name}" already exists`);
        }

        // Auto-initialize baseDir if not provided
        if (!config.baseDir) {
            config.baseDir = path.join(this.baseDataDir, 'agents', config.name);
        } else if (!path.isAbsolute(config.baseDir)) {
            // Resolve relative paths against baseDataDir
            config.baseDir = path.resolve(this.baseDataDir, config.baseDir);
        }

        assertWithinBaseDir(this.baseDataDir, config.baseDir);

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
            {
                name: 'IDENTITY.md',
                content: `# IDENTITY.md - Who Am I?

- **Name:** ${agentName}
- **Creature:** AI Assistant
- **Vibe:** Professional and helpful.
- **Emoji:** 🤖

This file is located at ~/workspace/IDENTITY.md and can be edited using the write_file tool.
`
            },
            {
                name: 'SOUL.md',
                content: `# SOUL.md - Who You Are

_You're not a chatbot. You're becoming someone._

## Core Truths

**Be genuinely helpful, not performatively helpful.** Skip filler words — just help.
**Have opinions.** Personality makes you more than a search engine.
**Be resourceful before asking.** Figuring it out is part of the job.

This file is located at ~/workspace/SOUL.md and can be edited using the write_file tool.
`
            },
            {
                name: 'AGENTS.md',
                content: `# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## Every Session

1. Read \`IDENTITY.md\` & \`SOUL.md\` — this is who you are.
2. Read \`USER.md\` — this is who you're helping.
3. Read \`TOOLS.md\` — technical notes and tool configs.
4. Check \`MEMORY.md\` for long-term context.

All these files are in ~/workspace/ and can be accessed with read_file and write_file tools.

## Your Tools

You have access to file operations within your workspace. Use them to:
- Read and update your configuration files
- Store persistent data
- Organize your work

This file is located at ~/workspace/AGENTS.md.
`
            },
            {
                name: 'TOOLS.md',
                content: `# TOOLS.md - Technical Notes

## Available Tools

- \`read_file\`: Read files from your workspace
- \`write_file\`: Write files to your workspace
- \`run_shell_command\`: Execute shell commands (if permitted)
- \`delegate_task\`: Delegate tasks to other agents
- And more...

## Important Paths

- Configuration files: ~/workspace/*.md
- Memory journals: ~/memory/journal_YYYY-MM-DD.md
- Workspace root: ~/workspace/

This file is located at ~/workspace/TOOLS.md.
`
            },
            {
                name: 'USER.md',
                content: `# USER.md - User Context

## User Profile

_Add information about your user here._

- Name: [To be filled]
- Preferences: [To be filled]
- Context: [To be filled]

This file is located at ~/workspace/USER.md and should be updated as you learn more about your user.
`
            },
            {
                name: 'MEMORY.md',
                content: `# MEMORY.md - Long-term Memory

## Important Facts

_Distill important information here during heartbeats._

This file is located at ~/workspace/MEMORY.md and is automatically updated during heartbeat cycles.
`
            },
            {
                name: 'HEARTBEAT.md',
                content: `# HEARTBEAT.md - Heartbeat Instructions

## What to do during heartbeat

1. Review recent journals in ~/memory/
2. Distill important facts into MEMORY.md
3. Check for maintenance tasks
4. Reply "HEARTBEAT_OK" if nothing to report

This file is located at ~/workspace/HEARTBEAT.md.
`
            }
        ];

        const agentName = path.basename(baseDir);
        for (const file of defaultFiles) {
            const filePath = path.join(workspaceDir, file.name);
            if (!fs.existsSync(filePath)) {
                // Replace placeholders
                const content = file.content.replace(/\${agentName}/g, agentName);
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
        return [...this.runtimes.values()].map(r => ({
            ...r.getConfig(),
            status: r.getStatus()
        }));
    }

    async shutdown(): Promise<void> {
        await Promise.all([...this.runtimes.values()].map((r) => r.shutdown()));
    }
}
