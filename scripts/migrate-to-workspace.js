import fs from 'node:fs';
import path from 'node:path';

/**
 * Migration script for ClawGate agents
 * Moves configuration files (*.md) from the agent root to agent/workspace/
 */

const AGENTS_DIR = path.resolve(process.cwd(), 'data/agents');

if (!fs.existsSync(AGENTS_DIR)) {
    console.error(`Agents directory not found at: ${AGENTS_DIR}`);
    process.exit(1);
}

const agents = fs.readdirSync(AGENTS_DIR).filter(f => {
    return fs.statSync(path.join(AGENTS_DIR, f)).isDirectory();
});

console.log(`Found ${agents.length} agents to process.`);

const configFiles = [
    'IDENTITY.md',
    'SOUL.md',
    'AGENTS.md',
    'TOOLS.md',
    'USER.md',
    'MEMORY.md',
    'HEARTBEAT.md',
    'INSTRUCTIONS.md'
];

for (const agent of agents) {
    const agentDir = path.join(AGENTS_DIR, agent);
    const workspaceDir = path.join(agentDir, 'workspace');

    console.log(`\nProcessing agent: ${agent}`);

    if (!fs.existsSync(workspaceDir)) {
        fs.mkdirSync(workspaceDir, { recursive: true });
        console.log(`  - Created workspace directory`);
    }

    let movedCount = 0;
    for (const file of configFiles) {
        const oldPath = path.join(agentDir, file);
        const newPath = path.join(workspaceDir, file);

        if (fs.existsSync(oldPath)) {
            // Ne pas écraser si le fichier existe déjà dans workspace
            if (!fs.existsSync(newPath)) {
                fs.renameSync(oldPath, newPath);
                console.log(`  - Moved ${file} to workspace/`);
                movedCount++;
            } else {
                console.log(`  - ${file} already exists in workspace/, skipping.`);
            }
        }
    }

    if (movedCount === 0) {
        // Fallback: move any .md file that is not in memory/ or workspace/
        const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.md') && f !== 'workspace' && f !== 'memory');
        for (const file of files) {
            const oldPath = path.join(agentDir, file);
            const newPath = path.join(workspaceDir, file);
            if (!fs.existsSync(newPath)) {
                fs.renameSync(oldPath, newPath);
                console.log(`  - Moved custom file ${file} to workspace/`);
                movedCount++;
            }
        }
    }

    console.log(`  Done. Moved ${movedCount} files.`);
}

console.log('\nMigration complete!');
