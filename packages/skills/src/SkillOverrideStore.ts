/**
 * @license Apache-2.0
 * @geminiclaw/skills — SkillOverrideStore
 * Persists manual skill disablement to a JSON file.
 */
import fs from 'node:fs';
import path from 'node:path';

export class SkillOverrideStore {
    private overrides: Set<string> = new Set();
    private readonly filePath: string;

    constructor(dataDir: string) {
        this.filePath = path.join(dataDir, 'skills-overrides.json');
        this.load();
    }

    private load() {
        if (!fs.existsSync(this.filePath)) return;
        try {
            const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            if (Array.isArray(data.disabled)) {
                for (const name of data.disabled) {
                    this.overrides.add(name);
                }
            }
        } catch (err) {
            console.error('[skills/overrides] Failed to load overrides:', err);
        }
    }

    public isDisabled(name: string): boolean {
        return this.overrides.has(name);
    }

    public disable(name: string): void {
        this.overrides.add(name);
        this.persist();
    }

    public enable(name: string): void {
        this.overrides.delete(name);
        this.persist();
    }

    private persist() {
        try {
            const data = { disabled: Array.from(this.overrides) };
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('[skills/overrides] Failed to persist overrides:', err);
        }
    }
}
