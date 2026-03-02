/**
 * @license Apache-2.0
 * ClawGate — Doctor Command
 */
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export const doctorCommand = new Command('doctor')
    .description('Check system health and environment configuration')
    .action(async () => {
        console.log('🩺 ClawGate Doctor — Diagnostic system\n');

        const checks = [
            { name: 'Node.js version', fn: checkNode },
            { name: 'Dependencies (pnpm)', fn: checkPnpm },
            { name: 'gemini-cli', fn: checkGeminiCli },
            { name: 'Environment File (.env)', fn: checkEnv },
            { name: 'Configuration File', fn: checkConfig },
            { name: 'Workspace Permissions', fn: checkPerms },
        ];

        let errors = 0;
        for (const check of checks) {
            process.stdout.write(`🔍 Checking ${check.name}... `);
            try {
                const result = await check.fn();
                if (result === true) {
                    console.log('✅ PASS');
                } else {
                    console.log(`❌ FAIL\n   ↳ ${result}`);
                    errors++;
                }
            } catch (err: any) {
                console.log(`❌ ERROR\n   ↳ ${err.message}`);
                errors++;
            }
        }

        if (errors === 0) {
            console.log('\n✨ Everything looks great! Your ClawGate instance is healthy.');
        } else {
            console.log(`\n⚠️  Found ${errors} issue(s). Please fix them before running ClawGate.`);
        }
    });

async function checkNode() {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0]);
    return major >= 20 ? true : `Node.js ${version} detected. v20+ recommended.`;
}

async function checkPnpm() {
    try {
        execSync('pnpm -v', { stdio: 'ignore' });
        return true;
    } catch {
        return 'pnpm not found. Install with: npm i -g pnpm';
    }
}

async function checkGeminiCli() {
    try {
        // Look for gemini in common paths or PATH
        execSync('gemini --version', { stdio: 'ignore' });
        return true;
    } catch {
        return 'gemini-cli not found. Install with: npm i -g @google/gemini-cli';
    }
}

async function checkEnv() {
    const envPath = path.resolve(process.cwd(), '../../.env');
    if (!fs.existsSync(envPath)) return '.env file missing at project root.';

    const content = fs.readFileSync(envPath, 'utf8');
    if (!content.includes('GEMINI_API_KEY=')) return 'GEMINI_API_KEY missing in .env';
    if (!content.includes('CLAWGATE_API_TOKEN=')) return 'CLAWGATE_API_TOKEN missing in .env (Security P1)';

    return true;
}

async function checkConfig() {
    const configPath = path.resolve(process.cwd(), '../../config/clawgate.json');
    if (!fs.existsSync(configPath)) return 'config/clawgate.json missing.';
    try {
        JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return true;
    } catch {
        return 'config/clawgate.json is not valid JSON.';
    }
}

async function checkPerms() {
    try {
        const testFile = path.resolve(process.cwd(), 'test-perms.tmp');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        return true;
    } catch {
        return 'Cannot write to current directory. Check permissions.';
    }
}
