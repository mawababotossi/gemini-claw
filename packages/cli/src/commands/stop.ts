import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';

export const stopCommand = new Command('stop')
    .description('Stop the GeminiClaw Gateway and Dashboard services')
    .action(async () => {
        const rootDir = path.resolve(process.cwd());
        const gatewayDir = path.join(rootDir, 'packages', 'gateway');
        const dashboardDir = path.join(rootDir, 'packages', 'dashboard');

        console.log('🛑 Stopping GeminiClaw services...');

        // 1. Stop Gateway
        const gatewayPidFile = path.join(gatewayDir, 'gateway.pid');
        if (fs.existsSync(gatewayPidFile)) {
            const pid = parseInt(fs.readFileSync(gatewayPidFile, 'utf8'));
            if (!isNaN(pid)) {
                try {
                    process.kill(pid);
                    console.log(`✅ Gateway (PID ${pid}) stopped.`);
                } catch (e) {
                    console.warn(`⚠️ Could not kill Gateway (PID ${pid}). It may already be stopped.`);
                }
            }
            fs.unlinkSync(gatewayPidFile);
        }

        // 2. Stop Dashboard
        const dashboardPidFile = path.join(dashboardDir, 'dashboard.pid');
        if (fs.existsSync(dashboardPidFile)) {
            const pid = parseInt(fs.readFileSync(dashboardPidFile, 'utf8'));
            if (!isNaN(pid)) {
                try {
                    process.kill(pid);
                    console.log(`✅ Dashboard (PID ${pid}) stopped.`);
                } catch (e) {
                    console.warn(`⚠️ Could not kill Dashboard (PID ${pid}). It may already be stopped.`);
                }
            }
            fs.unlinkSync(dashboardPidFile);
        }

        console.log('Done.');
    });
