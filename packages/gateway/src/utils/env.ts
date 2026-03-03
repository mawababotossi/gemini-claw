/**
 * @license Apache-2.0
 * ClawGate — Robust Environment Loader
 */
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Searches upwards for the project root and loads the .env file.
 * @returns The discovered project root directory.
 */
export function loadEnv(): string {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    let current = __dirname;
    let envPath: string | null = null;

    // Search up to 10 levels deep for the project root
    for (let i = 0; i < 10; i++) {
        const hasPackages = fs.existsSync(path.join(current, 'packages'));
        const hasConfig = fs.existsSync(path.join(current, 'config'));

        if (hasPackages && hasConfig) {
            const potentialEnv = path.join(current, '.env');
            if (fs.existsSync(potentialEnv)) {
                envPath = potentialEnv;
            }
            break; // Found the root!
        }

        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }

    if (envPath) {
        const result = dotenv.config({ path: envPath });
        if (result.error) {
            console.error(`[env] Error loading ${envPath}: ${result.error.message}`);
        } else {
            console.log(`[env] Successfully loaded ${envPath}`);
        }
    } else {
        dotenv.config();
    }

    return current;
}
