/**
 * @license Apache-2.0
 * GeminiClaw — Onboarding Wizard
 */
import { Command } from 'commander';
import inquirer from 'inquirer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

export const onboardCommand = new Command('onboard')
    .description('Configure GeminiClaw interactively')
    .option('--install-daemon', 'Install a systemd service')
    .action(async (opts) => {
        console.log('🤖 Bienvenue dans GeminiClaw Onboarding\n');

        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'projectName',
                message: 'Nom du projet :',
                default: 'My GeminiClaw'
            },
            {
                type: 'input',
                name: 'geminiKey',
                message: 'Clé API Google Gemini (GEMINI_API_KEY) :',
                validate: (v: string) => v.length > 10 || 'Clé invalide'
            },
            {
                type: 'input',
                name: 'anthropicKey',
                message: 'Clé API Anthropic (pour Claude Code) [Optionnel] :',
            },
            {
                type: 'input',
                name: 'openaiKey',
                message: 'Clé API OpenAI (pour Codex CLI) [Optionnel] :',
            },
            {
                type: 'input',
                name: 'telegramToken',
                message: 'Token Telegram Bot (laisser vide pour ignorer) :'
            },
            {
                type: 'input',
                name: 'gatewayToken',
                message: 'Token API Gateway (GEMINICLAW_API_TOKEN) :',
                default: crypto.randomUUID().replace(/-/g, '')
            },
            {
                type: 'confirm',
                name: 'enableWhatsapp',
                message: 'Activer WhatsApp ?',
                default: false
            },
        ]);

        const home = process.env['GEMINICLAW_HOME'] || path.join(process.env['HOME']!, '.geminiclaw');

        if (!fs.existsSync(home)) {
            fs.mkdirSync(home, { recursive: true });
        }

        const envPath = path.join(home, '.env');
        const envContent = [
            `GEMINI_API_KEY=${answers.geminiKey}`,
            answers.anthropicKey ? `ANTHROPIC_API_KEY=${answers.anthropicKey}` : '',
            answers.openaiKey ? `OPENAI_API_KEY=${answers.openaiKey}` : '',
            `GEMINICLAW_API_TOKEN=${answers.gatewayToken}`,
            `NODE_ENV=production`,
            answers.telegramToken ? `TELEGRAM_BOT_TOKEN=${answers.telegramToken}` : '',
        ].filter(Boolean).join('\n');

        fs.writeFileSync(envPath, envContent + '\n');
        console.log(`✅ .env écrit dans ${envPath}`);

        const configDir = path.join(home, 'config');
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        const configPath = path.join(configDir, 'geminiclaw.json');
        if (!fs.existsSync(configPath)) {
            const defaultConfig = {
                project: {
                    name: answers.projectName || 'My GeminiClaw',
                    defaultModel: "gemini-2.0-flash"
                },
                providers: [
                    {
                        name: "google",
                        type: "google",
                        apiKey: "${GEMINI_API_KEY}",
                        models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"]
                    },
                    ...(answers.anthropicKey ? [{
                        name: "claude",
                        type: "anthropic",
                        apiKey: "${ANTHROPIC_API_KEY}",
                        models: ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"]
                    }] : []),
                    ...(answers.openaiKey ? [{
                        name: "openai",
                        type: "openai",
                        apiKey: "${OPENAI_API_KEY}",
                        models: ["gpt-4o", "gpt-4o-mini", "o1-mini"]
                    }] : [])
                ],
                channels: {
                    webchat: { enabled: true, port: 3001 },
                    telegram: { enabled: !!answers.telegramToken, token: "${TELEGRAM_BOT_TOKEN}" },
                    whatsapp: { enabled: answers.enableWhatsapp }
                },
                agents: [
                    {
                        name: "main",
                        provider: "google",
                        model: "gemini-2.0-flash",
                        baseDir: "./data/agents/main"
                    }
                ]
            };
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
            console.log(`✅ Config initiale créée dans ${configPath}`);
        }

        if (opts.installDaemon) {
            installSystemdDaemon(home);
        } else {
            console.log('\n💡 Lance le gateway avec : geminiclaw start');
        }
    });

function installSystemdDaemon(home: string) {
    const user = process.env['USER'] || 'root';
    const service = `[Unit]
Description=GeminiClaw AI Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${home}
ExecStart=/usr/bin/node ${home}/packages/gateway/dist/server.js
Restart=on-failure
RestartSec=10
EnvironmentFile=-${home}/.env
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target`;

    const svcPath = `/etc/systemd/system/geminiclaw@${user}.service`;
    try {
        fs.writeFileSync('/tmp/geminiclaw.service', service);
        execSync(`sudo mv /tmp/geminiclaw.service ${svcPath}`);
        execSync('sudo systemctl daemon-reload');
        execSync(`sudo systemctl enable --now geminiclaw@${user}.service`);
        console.log('✅ Daemon systemd installé et démarré');
        console.log(`📋 Commandes utiles :`);
        console.log(`   sudo systemctl status geminiclaw@${user}`);
        console.log(`   journalctl -u geminiclaw@${user} -f`);
    } catch (err: any) {
        console.error('❌ Échec de l\'installation du daemon (sudo requis) :', err.message);
    }
}
