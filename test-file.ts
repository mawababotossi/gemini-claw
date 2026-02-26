import { loadConfig } from '@geminiclaw/gateway/dist/config.js';
import { AgentRuntime } from '@geminiclaw/core';
import { TranscriptStore } from '@geminiclaw/memory';
import { SkillRegistry } from '@geminiclaw/skills';
import * as dotenv from 'dotenv';

async function main() {
    dotenv.config();
    process.env.DATA_DIR = './data';
    const config = loadConfig('./config/agents.json');

    const geminiConfig = config.agents.find(a => a.name === 'main');
    if (!geminiConfig) {
        console.error('Agent "main" not found in config/agents.json.');
        process.exit(1);
    }

    const transcripts = new TranscriptStore('./data');
    const skillRegistry = new SkillRegistry();
    const agent = new AgentRuntime(geminiConfig, transcripts, skillRegistry);

    console.log('Sending prompt to agent to create a test file...');

    // Create a random sessionId for this test
    const sessionId = `test-file-creation-${Date.now()}`;

    try {
        const result = await agent.process({
            sessionId,
            text: 'Please create a file at ./geminiclaw-test.txt with the content "Hello from GeminiClaw native tools!". Do not ask for confirmation.',
            timestamp: Date.now(),
            channel: 'cli',
            peerId: 'test-user',
        });

        console.log('\n--- Agent Response ---');
        console.log(result.text);
        console.log('----------------------\n');

        console.log('Test complete. You can verify the file with: cat ./geminiclaw-test.txt');
    } catch (err: any) {
        console.error('Error during agent execution:', err);
    } finally {
        process.exit(0);
    }
}

main().catch(console.error);
