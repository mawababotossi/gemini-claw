/**
 * @license Apache-2.0
 * @geminiclaw/skills — SkillRegistry
 */
import type { FunctionDeclaration } from '@google/genai';
import type { Skill } from './types.js';
import { extractDeclaration } from './types.js';
import { SkillMdLoader, SkillMd } from './SkillMdLoader.js';
import { SkillOverrideStore } from './SkillOverrideStore.js';
import { SkillManifest, SkillStatus } from './types.js';

export class SkillRegistry {
    private skills: Map<string, Skill> = new Map();
    private skillMdLoader?: SkillMdLoader;
    private skillOverrideStore?: SkillOverrideStore;
    private _allSkillsCache: SkillMd[] = [];
    private _activeSkillsCache: SkillMd[] = [];
    private _cacheTimestamp = 0;
    private readonly CACHE_TTL_MS = 10_000; // 10 seconds

    constructor(skillDirs?: string[], dataDir?: string) {
        if (dataDir) {
            this.skillOverrideStore = new SkillOverrideStore(dataDir);
        }
        if (skillDirs && skillDirs.length > 0) {
            this.skillMdLoader = new SkillMdLoader(skillDirs);
            try {
                this._rebuildCache();
            } catch (err) {
                console.error('[skills] Initial skill load failed:', err);
            }
        }
    }

    public getSkillMdLoader(): SkillMdLoader | undefined {
        return this.skillMdLoader;
    }

    /** Refresh prompt-driven skills from disk (force cache invalidation) */
    public refreshPromptSkills(): void {
        this._cacheTimestamp = 0; // Force rebuild
        this._rebuildCache();
        console.log(`[skills] ${this._activeSkillsCache.length}/${this._allSkillsCache.length} prompt skills refreshed.`);
    }

    private _maybeRebuildCache(): void {
        if (Date.now() - this._cacheTimestamp > this.CACHE_TTL_MS) {
            this._rebuildCache();
        }
    }

    private _rebuildCache(): void {
        if (!this.skillMdLoader) return;
        const all = this.skillMdLoader.loadAll();

        // Apply manual overrides
        if (this.skillOverrideStore) {
            for (const skill of all) {
                if (this.skillOverrideStore.isDisabled(skill.name)) {
                    skill.status = 'disabled';
                    skill.reason = 'Manually disabled via dashboard';
                }
            }
        }

        // filter() updates statuses in-place and returns only the enabled ones
        const active = this.skillMdLoader.filter(all);
        this._allSkillsCache = all;
        this._activeSkillsCache = active;
        this._cacheTimestamp = Date.now();
    }

    /** Get the prompt block for all active prompt-driven skills, or a specific subset */
    public getPromptBlock(whitelist?: string[]): string {
        if (!this.skillMdLoader) return '';

        this._maybeRebuildCache();
        let targetSkills = this._activeSkillsCache;
        if (whitelist && whitelist.length > 0) {
            targetSkills = this._activeSkillsCache.filter(s => whitelist.includes(s.name));
        }

        // If few skills, use inline injection for better latency
        if (targetSkills.length > 0 && targetSkills.length <= 4) {
            let block = '\n<skills_instructions>\n';
            block += `The following skills provide specialized instructions for your task:\n\n`;
            for (const skill of targetSkills) {
                block += `<skill name="${skill.name}">\n${skill.body}\n</skill>\n`;
            }
            block += '</skills_instructions>\n';
            return block;
        }

        return this.skillMdLoader.formatForPrompt(targetSkills);
    }

    /** Get all prompt-driven skills (including disabled ones) */
    public getAllPromptSkills(): SkillMd[] {
        this._maybeRebuildCache();
        return this._allSkillsCache;
    }

    /** Get filtered prompt-driven skills */
    public getActivePromptSkills(): SkillMd[] {
        this._maybeRebuildCache();
        return this._activeSkillsCache;
    }

    /** Unify all skills into manifests for the dashboard */
    public getAllManifests(): SkillManifest[] {
        this._maybeRebuildCache();
        const manifests: SkillManifest[] = [];

        // 1. Add prompt skills
        for (const s of this._allSkillsCache) {
            manifests.push({
                name: s.name,
                description: s.description,
                kind: 'prompt',
                status: s.status as SkillStatus,
                path: s.path,
                requiredEnv: s.requiredEnv,
                missingEnv: s.missingEnv,
                missingBins: s.missingBins,
                reason: s.reason,
                manuallyDisabled: this.skillOverrideStore?.isDisabled(s.name)
            });
        }

        // 2. Add native/MCP skills
        for (const s of this.skills.values()) {
            const isManualDisabled = this.skillOverrideStore?.isDisabled(s.name);
            manifests.push({
                name: s.name,
                description: s.description,
                kind: 'native',
                status: isManualDisabled ? 'disabled' : 'enabled',
                parameters: s.parameters,
                manuallyDisabled: isManualDisabled,
                reason: isManualDisabled ? 'Manually disabled via dashboard' : undefined
            });
        }

        return manifests;
    }

    public disableSkill(name: string): void {
        this.skillOverrideStore?.disable(name);
        this.refreshPromptSkills();
    }

    public enableSkill(name: string): void {
        this.skillOverrideStore?.enable(name);
        this.refreshPromptSkills();
    }

    /** Register a local skill */
    register(skill: Skill): void {
        if (this.skills.has(skill.name)) {
            console.warn(`[skills] Overwriting existing skill: ${skill.name}`);
        }
        this.skills.set(skill.name, skill);
    }

    /** Unregister a skill by name */
    unregister(name: string): void {
        this.skills.delete(name);
    }

    /** 
     * Get all registered skills as FunctionDeclarations for the LLM.
     * Returns undefined if no skills are registered (to omit from config).
     */
    getDeclarations(): FunctionDeclaration[] | undefined {
        if (this.skills.size === 0) return undefined;
        return Array.from(this.skills.values()).map(extractDeclaration);
    }

    /**
     * Execute a skill safely by its name with the provided arguments.
     * Returns an object that will be passed back to the LLM directly.
     */
    async execute(name: string, args: Record<string, unknown>): Promise<any> {
        const skill = this.skills.get(name);
        if (!skill) {
            throw new Error(`[skills] Skill not found: ${name}`);
        }

        try {
            // Wait for the skill to execute (can be sync or async)
            const result = await skill.execute(args);
            return result;
        } catch (error) {
            console.error(`[skills] Error executing skill '${name}':`, error);
            // Return a structured error back to the LLM so it can recover
            return {
                error: true,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }
}
