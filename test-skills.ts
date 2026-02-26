import { loadConfig } from './packages/gateway/dist/config.js';
import { TranscriptStore } from './packages/memory/dist/TranscriptStore.js';
import { SkillRegistry } from './packages/skills/dist/SkillRegistry.js';
import { AgentRuntime } from './packages/core/dist/AgentRuntime.js';
import { Type } from '@google/genai';
import { coreEvents } from '@google/gemini-cli-core/dist/src/utils/events.js';

coreEvents.on('user_feedback', (fb) => console.log('\n--- CORE EVENT ---\n' + fb.message));
async function test() {
    process.env.GOOGLE_GENAI_USE_GCA = 'true';
    const config = loadConfig('./config/agents.json');
    const agentConfig = config.agents[0];
    agentConfig.model = 'gemini-2.5-pro';

    const transcripts = new TranscriptStore('/tmp');
    const skillRegistry = new SkillRegistry();

    skillRegistry.register({
        name: 'getCurrentTime',
        description: 'Get the exact current date and time.',
        parameters: { type: Type.OBJECT, properties: { tz: { type: Type.STRING } } },
        execute: () => ({ time: new Date().toISOString() })
    });

    // Patch generateWithTools to log the raw response before processing
    const runtime = new AgentRuntime(agentConfig, transcripts, skillRegistry);
    const ogGenerate = runtime['generateWithTools'].bind(runtime);
    runtime['generateWithTools'] = async function (...args: any[]) {
        const gen = args[0];
        const ogGenerateContent = gen.generateContent.bind(gen);
        gen.generateContent = async function (...gArgs: any[]) {
            const res = await ogGenerateContent(...gArgs);
            console.log("RAW RESPONSE CANDIDATE 0 PARTS:", JSON.stringify(res?.candidates?.[0]?.content?.parts, null, 2));
            // Also log functionCalls getter if it exists natively on the response object
            console.log("HAS FUNCTION CALLS GETTER:", !!res.functionCalls);
            if (res.functionCalls) console.log("FUNCTION CALLS:", JSON.stringify(res.functionCalls, null, 2));
            return res;
        };
        return ogGenerate(...args);
    };

    console.log("Sending prompt to evaluate skills...");

    const res = await runtime.process({
        sessionId: 'test1',
        channel: 'cli',
        peerId: 'user',
        text: 'What time is it right now? Use the getCurrentTime tool to find out.',
        timestamp: Date.now()
    });
    console.log("Result:", res.text);
}
test().catch(console.error);
