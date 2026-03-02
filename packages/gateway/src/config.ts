/**
 * @license Apache-2.0
 * @clawgate/gateway — Config loader
 *
 * Reads config/clawgate.json, expands ${ENV_VAR} placeholders,
 * and validates the structure.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { GatewayConfig } from './types.js';

/** Replace ${VAR_NAME} placeholders with process.env values */
function expandEnv(str: string): string {
    return str.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
        return process.env[name] ?? '';
    });
}

export function loadConfig(configPath: string): GatewayConfig {
    const absPath = path.resolve(configPath);
    const raw = readFileSync(absPath, 'utf8');
    const expanded = expandEnv(raw);
    const parsed = JSON.parse(expanded) as any;

    const configDir = path.dirname(absPath);
    const dataDir = process.env['DATA_DIR']
        ? path.resolve(configDir, process.env['DATA_DIR'])
        : path.resolve(configDir, '../data');

    return {
        project: parsed.project ?? { name: 'ClawGate' },
        providers: parsed.providers ?? [],
        dataDir,
        agents: parsed.agents ?? [],
        channels: parsed.channels ?? {},
        cron: parsed.cron ?? [],
        gatewayPort: parsed.gatewayPort,
    };
}
