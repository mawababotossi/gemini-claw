import { promises as fs } from 'fs';
import path from 'path';

export async function overwriteEnvVariables(envVars: Record<string, string>) {
    const envPath = path.resolve(process.cwd(), '../../.env');
    let envContent = '';

    try {
        envContent = await fs.readFile(envPath, 'utf8');
    } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
    }

    const lines = envContent.split('\n');
    const envMap = new Map<string, string>();

    // Parse existing
    for (const line of lines) {
        if (!line.trim() || line.startsWith('#')) continue;
        const [key, ...rest] = line.split('=');
        if (key) envMap.set(key.trim(), rest.join('=').trim().replace(/^"|"$/g, ''));
    }

    // Overwrite with new
    for (const [key, value] of Object.entries(envVars)) {
        envMap.set(key, value);
    }

    // Stringify and write back
    const newLines = Array.from(envMap.entries())
        .map(([key, value]) => `${key}="${value}"`)
        .join('\n');

    await fs.writeFile(envPath, newLines + '\n', 'utf8');
}
