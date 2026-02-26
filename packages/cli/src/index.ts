#!/usr/bin/env node
import { Command } from 'commander';
import { configureCommand } from './commands/configure.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';

const program = new Command();

program
    .name('geminiclaw')
    .description('CLI to manage the GeminiClaw server and configuration')
    .version('0.1.0');

program.addCommand(configureCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);

// Fallback to help
if (process.argv.length === 2) {
    process.argv.push('-h');
}

program.parse(process.argv);
