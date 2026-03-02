import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { getRootDirSync } from '../utils/paths.js';

export const stopCommand = new Command('stop')
    .description('Stop the GeminiClaw Gateway and Dashboard services')
    .action(async () => {
        const rootDir = getRootDirSync();
        const gatewayDir = path.join(rootDir, 'packages', 'gateway');
        const dashboardDir = path.join(rootDir, 'packages', 'dashboard');

        console.log('🛑 Stopping GeminiClaw services...');

        const killProcess = (pid: number, name: string) => {
            try {
                // Kill the entire process group since it was started detached
                console.log(`Attempting to stop ${name} group (PID ${pid})...`);
                process.kill(-pid, 'SIGTERM');
                return true;
            } catch (e) {
                try {
                    process.kill(pid, 'SIGTERM');
                    return true;
                } catch (e2) {
                    return false;
                }
            }
        };

        // 1. Stop Gateway
        const gatewayPidFile = path.join(gatewayDir, 'gateway.pid');
        if (fs.existsSync(gatewayPidFile)) {
            const pidString = fs.readFileSync(gatewayPidFile, 'utf8').trim();
            const pid = parseInt(pidString);
            if (!isNaN(pid)) {
                if (killProcess(pid, 'Gateway')) {
                    console.log(`✅ Gateway stop signal sent.`);
                }
            }
            fs.unlinkSync(gatewayPidFile);
        }

        // 2. Stop Dashboard
        const dashboardPidFile = path.join(dashboardDir, 'dashboard.pid');
        if (fs.existsSync(dashboardPidFile)) {
            const pidString = fs.readFileSync(dashboardPidFile, 'utf8').trim();
            const pid = parseInt(pidString);
            if (!isNaN(pid)) {
                if (killProcess(pid, 'Dashboard')) {
                    console.log(`✅ Dashboard stop signal sent.`);
                }
            }
            fs.unlinkSync(dashboardPidFile);
        }

        // 3. Final cleanup (only on Linux/Unix systems with fuser)
        try {
            const { execSync } = await import('node:child_process');
            console.log('🔍 Performing final port cleanup...');
            const ports = [3001, 3002, 5173];
            for (const port of ports) {
                try {
                    execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
                } catch (e) {
                    // Port already free or fuser not available
                }
            }
        } catch (e) {
            // execSync failed or not supported
        }

        console.log('Done.');
    });
