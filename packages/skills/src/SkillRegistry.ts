/**
 * @license Apache-2.0
 * @geminiclaw/skills — SkillRegistry
 */
import type { FunctionDeclaration } from '@google/genai';
import type { Skill } from './types.js';
import { extractDeclaration } from './types.js';

export class SkillRegistry {
    private skills: Map<string, Skill> = new Map();

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
