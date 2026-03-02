import path from 'node:path';

/**
 * Valide un nom d'agent : alphanumérique, tirets, underscores, 1-64 chars.
 */
export function validateAgentName(name: unknown): string {
    if (typeof name !== 'string') {
        throw new Error('Agent name must be a string');
    }
    const cleaned = name.trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cleaned)) {
        throw new Error(
            `Invalid agent name "${cleaned}". ` +
            'Only alphanumeric characters, hyphens, and underscores are allowed (1-64 chars).'
        );
    }
    return cleaned;
}

/**
 * Vérifie qu'un chemin résolu reste bien dans le répertoire de base (anti path traversal).
 */
export function assertWithinBaseDir(baseDir: string, targetPath: string): void {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);
    if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
        throw new Error(
            `Path traversal detected: "${targetPath}" is outside base directory "${baseDir}"`
        );
    }
}

/**
 * Sanitise un message avant stockage JSONL — supprime les retours à la ligne embarqués.
 */
export function sanitizeMessageContent(content: string): string {
    // Remplace les newlines dans le contenu pour éviter la corruption JSONL
    return content.replace(/\r?\n/g, ' ').replace(/\0/g, '');
}
