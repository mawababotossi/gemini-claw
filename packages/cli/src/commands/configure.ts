import { Command } from 'commander';
import inquirer from 'inquirer';
import { overwriteEnvVariables } from '../utils/env.js';
import { updateAgentsConfig } from '../utils/config.js';

export const configureCommand = new Command('configure')
    .description('Interactive configuration guide for GeminiClaw providers, models, and API keys')
    .action(async () => {
        console.log('🤖 Welcome to the GeminiClaw Configuration Wizard! 🤖\n');

        const configQuestions = [
            {
                type: 'list',
                name: 'primaryProvider',
                message: 'Which AI Provider would you like to use for your primary model?',
                choices: ['Google Gemini', 'OpenClaw (OpenRouter/Ollama/Together)'],
                default: 'Google Gemini',
            },
            {
                type: 'input',
                name: 'geminiApiKey',
                message: 'Enter your Google Gemini API Key (leave empty to skip):',
                when: (answers: any) => answers.primaryProvider === 'Google Gemini',
            },
            {
                type: 'list',
                name: 'geminiModel',
                message: 'Which Gemini model should be the default?',
                choices: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
                when: (answers: any) => answers.primaryProvider === 'Google Gemini',
                default: 'gemini-2.5-pro',
            },
            {
                type: 'input',
                name: 'openClawUrl',
                message: 'Enter your OpenClaw API Base URL (leave empty to skip):',
                when: (answers: any) => answers.primaryProvider === 'OpenClaw (OpenRouter/Ollama/Together)',
                default: 'http://localhost:3000/v1'
            },
            {
                type: 'input',
                name: 'openClawModel',
                message: 'Which model should be the primary fallback?',
                when: (answers: any) => answers.primaryProvider === 'OpenClaw (OpenRouter/Ollama/Together)',
                default: 'together/moonshotai/Kimi-K2.5'
            },
            {
                type: 'input',
                name: 'telegramToken',
                message: 'Enter your Telegram Bot Token (leave empty to skip):',
            },
            {
                type: 'input',
                name: 'whatsappPhone',
                message: 'Enter your WhatsApp Phone Number (leave empty to skip):',
            },
        ];

        const answers = await inquirer.prompt(configQuestions as any);

        console.log('\n📝 Saving your configuration...\n');

        // 1. Update Environment Variables (.env)
        const newEnv: Record<string, string> = {};
        if (answers.geminiApiKey) newEnv.GEMINI_API_KEY = answers.geminiApiKey;
        if (answers.openClawUrl) newEnv.OPENCLAW_API_BASE = answers.openClawUrl;
        if (answers.telegramToken) newEnv.TELEGRAM_BOT_TOKEN = answers.telegramToken;
        if (answers.whatsappPhone) newEnv.WHATSAPP_PHONE_NUMBER = answers.whatsappPhone;

        if (Object.keys(newEnv).length > 0) {
            await overwriteEnvVariables(newEnv);
            console.log('✅ Environment variables updated (.env)');
        }

        // 2. Update config/geminiclaw.json
        let primaryModel = answers.geminiModel;
        if (answers.primaryProvider === 'OpenClaw (OpenRouter/Ollama/Together)') {
            primaryModel = answers.openClawModel;
        }

        if (primaryModel) {
            await updateAgentsConfig(primaryModel);
            console.log(`✅ Default agent model set to ${primaryModel} in config/geminiclaw.json`);
        }

        console.log('\n🎉 Configuration complete! Run `geminiclaw start` to boot your agents.');
    });
