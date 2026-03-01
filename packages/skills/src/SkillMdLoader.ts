/**
 * @license Apache-2.0
 * @geminiclaw/skills — SkillMdLoader
 * 
 * Ported from OpenClaw's logic to handle prompt-driven skills (SKILL.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { execFileSync } from 'node:child_process';

export interface SkillMdEnvVar {
    key: string;           // Name of the variable: "OPENAI_API_KEY"
    description?: string;  // Simple description
    secret?: boolean;      // true if it's a secret (displayed as password)
    url?: string;          // Link to documentation
}

export interface SkillMd {
    name: string;
    description: string;
    path: string;
    dir: string;
    metadata: any;
    body: string;
    status: 'enabled' | 'disabled' | 'needs-config' | 'needs-install';
    reason?: string;
    install?: any[];
    requiredEnv: SkillMdEnvVar[];
    missingEnv: string[];
    missingBins: string[];
}

export class SkillMdLoader {
    private skillDirs: string[];

    constructor(dirs: string[]) {
        this.skillDirs = dirs;
    }

    /**
     * Load all SKILL.md files from the configured directories.
     */
    public loadAll(): SkillMd[] {
        const skills: SkillMd[] = [];

        for (const baseDir of this.skillDirs) {
            if (!fs.existsSync(baseDir)) {
                console.warn(`[skills/loader] Directory not found: ${baseDir}`);
                continue;
            }

            const entries = fs.readdirSync(baseDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const skillPath = path.join(baseDir, entry.name, 'SKILL.md');
                    if (fs.existsSync(skillPath)) {
                        try {
                            const content = fs.readFileSync(skillPath, 'utf8');
                            const { data, content: body } = matter(content);

                            if (data.name && data.description) {
                                const envDescriptions = data.metadata?.openclaw?.envDescriptions ?? {};
                                const requiredEnvKeys: string[] = data.metadata?.openclaw?.requires?.env ?? [];

                                skills.push({
                                    name: data.name,
                                    description: data.description,
                                    path: skillPath,
                                    dir: path.dirname(skillPath),
                                    metadata: data.metadata || {},
                                    body: body.trim(),
                                    status: 'enabled', // Default, will be recalculated in filter()
                                    install: data.metadata?.openclaw?.install,
                                    requiredEnv: requiredEnvKeys.map((key: string) => ({
                                        key,
                                        description: envDescriptions[key]?.description,
                                        secret: envDescriptions[key]?.secret !== false, // secret by default
                                        url: envDescriptions[key]?.url,
                                    })),
                                    missingEnv: [],
                                    missingBins: [],
                                });
                            }
                        } catch (err) {
                            console.error(`[skills/loader] Failed to parse skill at ${skillPath}:`, err);
                        }
                    } else {
                        // Minor 2: scan depth warning
                        console.debug(`[skills/loader] Folder "${entry.name}" in ${baseDir} has no SKILL.md, skipping.`);
                    }
                }
            }
        }

        return skills;
    }

    /**
     * Filter skills based on available environment.
     * Returns a new array of ENABLED skills.
     * Updates the status/reason for original objects for dashboard display.
     */
    public filter(skills: SkillMd[]): SkillMd[] {
        const active: SkillMd[] = [];

        for (const skill of skills) {
            const requires = skill.metadata?.openclaw?.requires;

            // Reset diagnostic fields
            skill.missingBins = [];
            skill.missingEnv = [];

            if (!requires) {
                skill.status = 'enabled';
                active.push({ ...skill, status: 'enabled' });
                continue;
            }

            // --- Check binaries ---
            if (requires.bins && Array.isArray(requires.bins)) {
                skill.missingBins = requires.bins.filter((bin: string) => !this.isBinAvailable(bin));
            }
            if (requires.anyBins && Array.isArray(requires.anyBins)) {
                const available = requires.anyBins.some((bin: string) => this.isBinAvailable(bin));
                if (!available) {
                    skill.missingBins.push(...requires.anyBins.map((b: string) => `${b} (any)`));
                }
            }

            // --- Check environment variables ---
            if (requires.env && Array.isArray(requires.env)) {
                skill.missingEnv = requires.env.filter((envVar: string) => !process.env[envVar]);
            }

            // --- Status Classification ---
            if (skill.missingBins.length > 0) {
                // Missing binaries -> needs installation
                skill.status = 'needs-install';
                skill.reason = `Missing binaries: ${skill.missingBins.join(', ')}`;
            } else if (skill.missingEnv.length > 0) {
                // Binaries OK but env missing -> needs config
                skill.status = 'needs-config';
                skill.reason = `Configuration required: ${skill.missingEnv.join(', ')}`;
            } else {
                // Everything OK
                skill.status = 'enabled';
                skill.reason = undefined;
                active.push({ ...skill, status: 'enabled' });
            }
        }

        return active;
    }

    public getSkillDirs(): string[] {
        return this.skillDirs;
    }

    private binCache: Map<string, { available: boolean, checkedAt: number }> = new Map();
    private readonly BIN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    public isBinAvailable(bin: string): boolean {
        // Validation: binaire name must be simple alphanumeric
        if (!/^[a-zA-Z0-9_\-\.]+$/.test(bin)) return false;

        const cached = this.binCache.get(bin);
        if (cached && (Date.now() - cached.checkedAt) < this.BIN_CACHE_TTL_MS) {
            return cached.available;
        }

        let available = false;
        try {
            const cmd = process.platform === 'win32' ? 'where' : 'which';
            execFileSync(cmd, [bin], { stdio: 'pipe' });
            available = true;
        } catch {
            available = false;
        }

        this.binCache.set(bin, { available, checkedAt: Date.now() });
        return available;
    }

    /**
     * Format a list of SkillMd into an XML block for the system prompt.
     */
    public formatForPrompt(skills: SkillMd[]): string {
        if (skills.length === 0) return '';

        let prompt = `\n<available_skills>\n`;
        prompt += `The following skills provide specialized instructions for specific tasks.\n`;
        prompt += `If a task matches a skill's description, use the "read_skill" tool with the skill's name.\n`;

        for (const skill of skills) {
            prompt += `  <skill>\n`;
            prompt += `    <name>${skill.name}</name>\n`;
            prompt += `    <description>${skill.description}</description>\n`;
            prompt += `  </skill>\n`;
        }

        prompt += `</available_skills>\n`;
        return prompt;
    }
}
