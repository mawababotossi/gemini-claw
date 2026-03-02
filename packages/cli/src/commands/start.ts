import { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { getRootDirSync } from '../utils/paths.js';

export const startCommand = new Command('start')
    .description('Start the GeminiClaw Gateway and Dashboard services')
    .action(async () => {
        const rootDir = getRootDirSync();
        const gatewayDir = path.join(rootDir, 'packages', 'gateway');
        const dashboardDir = path.join(rootDir, 'packages', 'dashboard');

        console.log('🚀 Starting GeminiClaw services...');

        // 1. Start Gateway
        const gatewayLog = fs.openSync(path.join(gatewayDir, 'gateway.log'), 'a');
        const gateway = spawn('npx', ['tsx', '--env-file=../../.env', 'src/server.ts'], {
            cwd: gatewayDir,
            detached: true,
            stdio: ['ignore', gatewayLog, gatewayLog],
            env: { ...process.env, CONFIG_PATH: path.join(rootDir, 'config', 'geminiclaw.json') }
        });
        gateway.unref();
        fs.writeFileSync(path.join(gatewayDir, 'gateway.pid'), gateway.pid?.toString() || '');

        // 2. Start Dashboard
        const dashboardLog = fs.openSync(path.join(dashboardDir, 'dashboard.log'), 'a');
        const dashboard = spawn('pnpm', ['run', 'dev', '--host'], {
            cwd: dashboardDir,
            detached: true,
            stdio: ['ignore', dashboardLog, dashboardLog]
        });
        dashboard.unref();
        fs.writeFileSync(path.join(dashboardDir, 'dashboard.pid'), dashboard.pid?.toString() || '');

        console.log('✅ Services started in background.');
        console.log('📈 Gateway: http://localhost:3001');
        console.log('🖥️  Dashboard: http://localhost:5173');
    });
