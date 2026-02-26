import { promises as fs } from 'fs';
import path from 'path';

export async function updateAgentsConfig(primaryModel: string) {
    const configPath = path.resolve(process.cwd(), '../../config/geminiclaw.json');

    let content = '';
    try {
        content = await fs.readFile(configPath, 'utf8');
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            console.warn(`Could not find config/geminiclaw.json at ${configPath}`);
            return;
        }
        throw err;
    }

    const config = JSON.parse(content);

    // Update global default model
    if (config.project) {
        config.project.defaultModel = primaryModel;
    }

    // Update exactly the first agent's primary model
    if (config.agents && config.agents.length > 0) {
        config.agents[0].model = primaryModel;
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}
