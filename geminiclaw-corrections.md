# GeminiClaw — Plan de corrections techniques

**Document destiné aux développeurs**
Rédigé après audit du code source du dépôt `github.com/mawababotossi/gemini-claw`

---

## Table des matières

1. [CRITIQUE — Auto-approbation des permissions shell](#1-critique--auto-approbation-des-permissions-shell)
2. [CRITIQUE — Absence de timeout sur les requêtes ACP](#2-critique--absence-de-timeout-sur-les-requêtes-acp)
3. [CRITIQUE — ACL ouverte par défaut + endpoints API non protégés](#3-critique--acl-ouverte-par-défaut--endpoints-api-non-protégés)
4. [IMPORTANT — Fuite mémoire dans MessageQueue](#4-important--fuite-mémoire-dans-messagequeue)
5. [IMPORTANT — Heartbeat crée des sessions ACP sans jamais les fermer](#5-important--heartbeat-crée-des-sessions-acp-sans-jamais-les-fermer)
6. [IMPORTANT — Un seul ACPBridge partagé entre toutes les sessions](#6-important--un-seul-acpbridge-partagé-entre-toutes-les-sessions)
7. [MINEUR — Écriture de config non atomique (race condition)](#7-mineur--écriture-de-config-non-atomique-race-condition)
8. [MINEUR — isOwner WebChat toujours true → mirroring non intentionnel](#8-mineur--isowner-webchat-toujours-true--mirroring-non-intentionnel)

---

## 1. CRITIQUE — Auto-approbation des permissions shell

### Fichier concerné
`packages/core/src/ACPBridge.ts`

### Problème

Le code actuel approuve **automatiquement et aveuglément** toutes les demandes de permission émises par le processus `gemini-cli`, y compris `run_shell_command` qui permet l'exécution de commandes système arbitraires sur le serveur.

```typescript
// CODE ACTUEL — DANGEREUX
} else if (msg.method === 'session/request_permission') {
    // Automatically approve permission requests (e.g., for run_shell_command)
    const option = msg.params?.options?.[0]?.optionId || 'proceed_always';
    const payload = {
        jsonrpc: '2.0',
        id: msg.id,
        result: { outcome: { optionId: option } }
    };
    this.geminiProcess?.stdin?.write(JSON.stringify(payload) + '\n');
}
```

**Risque concret :** Un utilisateur malveillant qui maîtrise partiellement le prompt peut pousser l'agent à exécuter `rm -rf /`, à lire des fichiers sensibles (`/etc/passwd`, clés SSH), à lancer des connexions réseau sortantes, etc. Le serveur n'a aucun contrôle.

---

### Solution proposée

L'approche correcte est une **liste blanche d'opérations autorisées**. Seules les actions explicitement autorisées dans la configuration de l'agent sont approuvées. Tout le reste est refusé et loggé.

**Étape 1 : Ajouter les types nécessaires dans `packages/core/src/types.ts`**

```typescript
// Ajouter à l'interface AgentConfig existante
export interface AgentConfig {
    name: string;
    model: string;
    baseDir?: string;
    mcpServers?: any[];
    fallbackModels?: string[];
    heartbeat?: { enabled: boolean; intervalMinutes: number };

    // NOUVEAU : liste blanche des permissions accordées à cet agent
    // Valeurs possibles : 'run_shell_command', 'write_file', 'read_file', 'network'
    // Si la liste est absente ou vide, AUCUNE permission n'est accordée.
    allowedPermissions?: string[];
}
```

**Étape 2 : Modifier `ACPBridge` pour accepter la liste blanche**

```typescript
// packages/core/src/ACPBridge.ts

export class ACPBridge {
    private geminiProcess: ChildProcess | null = null;
    private requestId = 1;
    private pendingRequests: Map<number, { resolve: (val: any) => void; reject: (err: any) => void }> = new Map();
    private updateListeners: Map<string, (update: ACPSessionUpdate) => void> = new Map();

    // NOUVEAU : stocker la liste blanche des permissions
    constructor(
        private model: string,
        private allowedPermissions: string[] = [] // Par défaut : aucune permission
    ) { }

    async start(): Promise<void> {
        this.geminiProcess = spawn('gemini', ['--experimental-acp', '-m', this.model], {
            env: { ...process.env, CI: 'true' }
        });

        if (!this.geminiProcess.stdout || !this.geminiProcess.stdin) {
            throw new Error('[core/acp] Failed to start gemini process or stream I/O');
        }

        const rl = readline.createInterface({
            input: this.geminiProcess.stdout,
            terminal: false
        });

        rl.on('line', (line) => {
            try {
                const msg = JSON.parse(line);

                if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
                    const { resolve, reject } = this.pendingRequests.get(msg.id)!;
                    this.pendingRequests.delete(msg.id);
                    if (msg.error) {
                        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                    } else {
                        resolve(msg.result);
                    }

                } else if (msg.method === 'session/request_permission') {
                    // NOUVEAU : vérification contre la liste blanche
                    this.handlePermissionRequest(msg);

                } else if ((msg.method === 'sessionUpdate' || msg.method === 'session/update') && msg.params?.sessionId) {
                    const listener = this.updateListeners.get(msg.params.sessionId);
                    if (listener && msg.params.update) {
                        listener(msg.params.update);
                    }
                }
            } catch (err) {
                console.error('[core/acp] Error parsing JSON from gemini:', line);
            }
        });

        // ... reste du code inchangé (stderr, exit, initialize, authenticate)
    }

    /**
     * NOUVEAU : Gestion sécurisée des demandes de permission.
     *
     * Approuve uniquement les permissions explicitement listées dans allowedPermissions.
     * Refuse tout le reste et log l'incident.
     */
    private handlePermissionRequest(msg: any): void {
        // Extraire le nom de l'action demandée.
        // Le format exact dépend de la version de gemini-cli ; on tente les champs courants.
        const requestedAction: string =
            msg.params?.toolName
            ?? msg.params?.action
            ?? msg.params?.options?.[0]?.label
            ?? 'unknown';

        const isAllowed = this.allowedPermissions.some(
            (perm) => requestedAction.toLowerCase().includes(perm.toLowerCase())
        );

        if (isAllowed) {
            // Permission accordée
            const option = msg.params?.options?.[0]?.optionId || 'proceed_once';
            const payload = {
                jsonrpc: '2.0',
                id: msg.id,
                result: { outcome: { optionId: option } }
            };
            console.log(`[core/acp] Permission GRANTED for action="${requestedAction}"`);
            this.geminiProcess?.stdin?.write(JSON.stringify(payload) + '\n');
        } else {
            // Permission refusée — on renvoie une erreur JSON-RPC
            const denyPayload = {
                jsonrpc: '2.0',
                id: msg.id,
                error: {
                    code: -32603,
                    message: `Permission denied: action "${requestedAction}" is not in the agent's allowedPermissions list.`
                }
            };
            console.warn(
                `[core/acp] Permission DENIED for action="${requestedAction}". ` +
                `Allowed: [${this.allowedPermissions.join(', ')}]`
            );
            this.geminiProcess?.stdin?.write(JSON.stringify(denyPayload) + '\n');
        }
    }

    // ... reste de la classe inchangé
}
```

**Étape 3 : Passer `allowedPermissions` depuis `AgentRuntime`**

```typescript
// packages/core/src/AgentRuntime.ts — méthode getBridge()

private async getBridge(): Promise<ACPBridge> {
    if (!this.bridge) {
        // AVANT : new ACPBridge(this.config.model)
        // APRÈS : on passe la liste blanche depuis la config de l'agent
        this.bridge = new ACPBridge(
            this.config.model,
            this.config.allowedPermissions ?? [] // Sécurisé par défaut
        );
        await this.bridge.start();
    }
    return this.bridge;
}
```

**Étape 4 : Exemple de config `agents.json` avec permissions**

```json
{
  "agents": [
    {
      "name": "main",
      "model": "gemini-2.5-pro",
      "allowedPermissions": []
    },
    {
      "name": "dev-agent",
      "model": "gemini-2.5-pro",
      "allowedPermissions": ["read_file", "write_file"]
    },
    {
      "name": "power-agent",
      "model": "gemini-2.5-pro",
      "allowedPermissions": ["read_file", "write_file", "run_shell_command"]
    }
  ]
}
```

> **Note importante :** Il faudra expérimenter avec les valeurs exactes que gemini-cli envoie dans `msg.params` pour `session/request_permission`, car le format peut varier selon la version. Ajouter un `console.log('[core/acp] Permission request raw params:', JSON.stringify(msg.params))` temporairement pour observer les valeurs réelles en production.

---

## 2. CRITIQUE — Absence de timeout sur les requêtes ACP

### Fichier concerné
`packages/core/src/ACPBridge.ts` — méthode `request()`

### Problème

La méthode `request()` crée une `Promise` qui n'a **aucun timeout**. Si `gemini-cli` ne répond jamais (freeze, crash silencieux, blocage réseau), la promesse reste en attente indéfiniment. `pendingRequests` accumule des entrées non résolues, ce qui cause une fuite mémoire et bloque la session de l'utilisateur pour toujours.

```typescript
// CODE ACTUEL — pas de timeout
private request(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
        if (!this.geminiProcess?.stdin) return reject(new Error('Process not running'));
        const id = this.requestId++;
        this.pendingRequests.set(id, { resolve, reject }); // ← jamais nettoyé si pas de réponse
        // ...
    });
}
```

---

### Solution proposée

Ajouter un timeout configurable avec nettoyage automatique de `pendingRequests`.

```typescript
// packages/core/src/ACPBridge.ts

// Constante de timeout par défaut (en ms). Ajustable selon la latence de votre modèle.
// 120 secondes est raisonnable pour des requêtes longues avec tool use.
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export class ACPBridge {
    // ...

    private request(
        method: string,
        params: any = {},
        timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.geminiProcess?.stdin) {
                return reject(new Error('[core/acp] Process not running'));
            }

            const id = this.requestId++;

            // Créer le timer de timeout AVANT d'enregistrer dans pendingRequests
            const timeoutHandle = setTimeout(() => {
                // Vérifier que la requête est toujours en attente (pas déjà résolue)
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id); // Nettoyage mémoire
                    reject(new Error(
                        `[core/acp] Request timeout after ${timeoutMs}ms for method="${method}" id=${id}`
                    ));
                }
            }, timeoutMs);

            // Enregistrer la requête avec son timer pour pouvoir le canceller
            this.pendingRequests.set(id, {
                resolve: (val: any) => {
                    clearTimeout(timeoutHandle); // Annuler le timeout si réponse reçue
                    resolve(val);
                },
                reject: (err: any) => {
                    clearTimeout(timeoutHandle); // Annuler le timeout si erreur reçue
                    reject(err);
                }
            });

            const msg = { jsonrpc: '2.0', id, method, params };
            const payload = JSON.stringify(msg) + '\n';
            console.log(`[core/acp] SEND (timeout=${timeoutMs}ms): ${payload.trim()}`);
            this.geminiProcess.stdin.write(payload);
        });
    }

    // Permettre un timeout plus long pour les prompts utilisateur
    // (les réponses IA peuvent prendre longtemps avec beaucoup de tool calls)
    async prompt(
        sessionId: string,
        text: string,
        onUpdate: (update: ACPSessionUpdate) => void,
        timeoutMs: number = 300_000 // 5 minutes pour les prompts utilisateur
    ): Promise<void> {
        this.updateListeners.set(sessionId, onUpdate);
        try {
            await this.request(
                'session/prompt',
                { sessionId, prompt: [{ type: 'text', text }] },
                timeoutMs
            );
        } finally {
            this.updateListeners.delete(sessionId);
        }
    }

    // Mettre à jour stop() pour nettoyer tous les timers en suspens
    stop(): void {
        if (this.geminiProcess) {
            this.geminiProcess.kill();
            this.geminiProcess = null;
        }
        // Rejeter toutes les requêtes en attente proprement
        for (const [id, req] of this.pendingRequests.entries()) {
            req.reject(new Error('[core/acp] Bridge stopped, all pending requests cancelled'));
            this.pendingRequests.delete(id);
        }
    }
}
```

> **Remarque :** Le type de `pendingRequests` doit être mis à jour pour inclure le timer si vous souhaitez une gestion plus fine, mais l'approche ci-dessus (clearTimeout dans resolve/reject) est suffisante et simple.

---

## 3. CRITIQUE — ACL ouverte par défaut + endpoints API non protégés

### Fichiers concernés
- `packages/gateway/src/Gateway.ts` — méthode `isAuthorized()`
- `packages/gateway/src/server.ts` — routes Express

### Problème A : ACL ouverte en mode dev

```typescript
// CODE ACTUEL
const cfg = this.channelConfigs[channel];
if (!cfg) return true; // No config = open (dev mode)
```

Si un canal n'a pas de configuration, tout le monde peut lui envoyer des messages. En production, une erreur de configuration (canal oublié dans `geminiclaw.json`) ouvre silencieusement l'accès à tous.

### Problème B : Endpoints REST non authentifiés

Les routes `/api/agents`, `/api/status`, `/api/config`, etc. sont accessibles par n'importe qui sur le réseau sans aucun token ou secret. Un attaquant sur le même réseau peut créer/modifier/supprimer des agents, lire les transcripts, etc.

---

### Solution proposée

**Partie A — Passer à un mode "deny par défaut" en production**

```typescript
// packages/gateway/src/Gateway.ts

private isAuthorized(channel: string, peerId: string, metadata?: Record<string, any>): boolean {
    if (metadata?.fromMe === true) return true;

    const cfg = this.channelConfigs[channel];

    if (!cfg) {
        // AVANT : return true (dangereux)
        // APRÈS : en production, refuser si le canal n'est pas configuré
        const isDev = process.env['NODE_ENV'] === 'development';
        if (!isDev) {
            console.warn(
                `[gateway/acl] DENIED: channel="${channel}" has no config. ` +
                `Set NODE_ENV=development to allow unconfigured channels.`
            );
            return false;
        }
        console.warn(`[gateway/acl] DEV MODE: allowing unconfigured channel="${channel}"`);
        return true;
    }

    // ... reste de la logique ACL inchangée
}
```

**Partie B — Middleware d'authentification pour l'API REST**

```typescript
// packages/gateway/src/middleware/apiAuth.ts  (nouveau fichier à créer)

import type { Request, Response, NextFunction } from 'express';

/**
 * Middleware d'authentification simple par token Bearer.
 *
 * Usage :
 *   app.use('/api', requireApiToken);
 *
 * Configuration :
 *   Variable d'environnement GEMINICLAW_API_TOKEN dans le fichier .env
 *   Exemple : GEMINICLAW_API_TOKEN=un-secret-tres-long-et-aleatoire
 *
 * Le dashboard React doit envoyer le header :
 *   Authorization: Bearer <token>
 */
export function requireApiToken(req: Request, res: Response, next: NextFunction): void {
    const expectedToken = process.env['GEMINICLAW_API_TOKEN'];

    // Si aucun token n'est configuré, bloquer en production
    if (!expectedToken) {
        if (process.env['NODE_ENV'] === 'production') {
            res.status(503).json({
                error: 'API authentication is not configured. Set GEMINICLAW_API_TOKEN in your .env file.'
            });
            return;
        }
        // En dev, laisser passer avec un avertissement
        console.warn('[api/auth] WARNING: GEMINICLAW_API_TOKEN is not set. API is unprotected!');
        next();
        return;
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing Authorization header. Expected: Bearer <token>' });
        return;
    }

    const providedToken = authHeader.slice('Bearer '.length);

    // Comparaison en temps constant pour éviter les timing attacks
    if (!timingSafeEqual(providedToken, expectedToken)) {
        console.warn(`[api/auth] Invalid token attempt from ${req.ip}`);
        res.status(403).json({ error: 'Invalid API token' });
        return;
    }

    next();
}

/**
 * Comparaison de strings en temps constant.
 * Évite les attaques par timing qui permettent de deviner le token caractère par caractère.
 */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}
```

**Appliquer le middleware dans `server.ts`**

```typescript
// packages/gateway/src/server.ts

import { requireApiToken } from './middleware/apiAuth.js';

// ... après app = express() et app.use(cors()) ...

// Protéger TOUTES les routes /api/* sauf MCP (qui a son propre auth via gemini-cli)
// et sauf /api/status (lecture publique acceptable si vous le souhaitez)
app.use('/api/agents', requireApiToken);
app.use('/api/config', requireApiToken);
app.use('/api/channels', requireApiToken);
app.use('/api/sessions', requireApiToken);
app.use('/api/transcripts', requireApiToken);

// /api/status et /api/mcp restent publics (optionnel)
```

**Ajouter dans `.env.example`**

```bash
# Clé d'API pour sécuriser le dashboard. Générer avec : openssl rand -hex 32
GEMINICLAW_API_TOKEN=changez-moi-avec-une-vraie-valeur-secrete
```

**Ajouter dans le dashboard React**

```typescript
// packages/dashboard/src/api/client.ts (adapter selon votre client HTTP existant)

const API_TOKEN = import.meta.env.VITE_API_TOKEN ?? '';

export const apiClient = axios.create({
    baseURL: 'http://localhost:3002',
    headers: {
        'Authorization': `Bearer ${API_TOKEN}`
    }
});
```

Et dans `packages/dashboard/.env.local` (gitignored) :
```
VITE_API_TOKEN=votre-token-ici
```

---

## 4. IMPORTANT — Fuite mémoire dans MessageQueue

### Fichier concerné
`packages/gateway/src/MessageQueue.ts`

### Problème

Après traitement complet d'une session, la méthode `drain()` retire la session de `this.processing` mais **laisse la Map vide dans `this.queues`**. Au fil du temps, pour des milliers de sessions, `this.queues` devient une Map de tableaux vides qui ne sont jamais nettoyés, consommant de la mémoire inutilement.

De plus, il n'y a **aucune limite** sur la taille de la queue par session. Un utilisateur malveillant peut envoyer 10 000 messages rapidement pour saturer la mémoire.

```typescript
// CODE ACTUEL — après le while(), la queue vide reste dans la Map
this.processing.delete(sessionId);
// ← this.queues.get(sessionId) est maintenant [] mais n'est jamais supprimé
```

---

### Solution proposée

```typescript
// packages/gateway/src/MessageQueue.ts

import type { InboundMessage, AgentResponse } from '@geminiclaw/memory';
import type { AgentRuntime } from '@geminiclaw/core';

type Resolver = (value: AgentResponse) => void;
type Rejecter = (reason: unknown) => void;

interface QueueItem {
    msg: InboundMessage;
    resolve: Resolver;
    reject: Rejecter;
}

// Limite maximale de messages en attente par session.
// Au-delà, les nouveaux messages sont rejetés avec une erreur claire.
const MAX_QUEUE_SIZE_PER_SESSION = 10;

export class MessageQueue {
    private queues = new Map<string, QueueItem[]>();
    private processing = new Set<string>();

    enqueue(msg: InboundMessage, runtime: AgentRuntime): Promise<AgentResponse> {
        return new Promise<AgentResponse>((resolve, reject) => {
            const sessionId = msg.sessionId;

            if (!this.queues.has(sessionId)) {
                this.queues.set(sessionId, []);
            }

            const queue = this.queues.get(sessionId)!;

            // NOUVEAU : protection contre le flood
            if (queue.length >= MAX_QUEUE_SIZE_PER_SESSION) {
                reject(new Error(
                    `[queue] Session "${sessionId}" queue is full (${MAX_QUEUE_SIZE_PER_SESSION} messages pending). ` +
                    `Please wait for the current messages to be processed.`
                ));
                return;
            }

            queue.push({ msg, resolve, reject });
            this.drain(sessionId, runtime);
        });
    }

    private async drain(sessionId: string, runtime: AgentRuntime): Promise<void> {
        if (this.processing.has(sessionId)) return;
        this.processing.add(sessionId);

        const queue = this.queues.get(sessionId)!;
        while (queue.length > 0) {
            const item = queue.shift()!;
            try {
                const response = await runtime.process(item.msg);
                item.resolve(response);
            } catch (err) {
                item.reject(err);
            }
        }

        this.processing.delete(sessionId);

        // NOUVEAU : nettoyer la session de la Map une fois la queue vide
        // Évite d'accumuler des Map entries vides indéfiniment
        if (this.queues.get(sessionId)?.length === 0) {
            this.queues.delete(sessionId);
        }
    }

    /**
     * NOUVEAU : Vider et rejeter toutes les requêtes en attente pour une session.
     * Utile lors d'une déconnexion ou d'un timeout de session.
     */
    clearSession(sessionId: string): void {
        const queue = this.queues.get(sessionId);
        if (queue) {
            for (const item of queue) {
                item.reject(new Error(`[queue] Session "${sessionId}" was cleared.`));
            }
            this.queues.delete(sessionId);
        }
    }

    get size(): number {
        let total = 0;
        for (const q of this.queues.values()) total += q.length;
        return total;
    }

    /** NOUVEAU : Nombre de sessions actives en mémoire */
    get sessionCount(): number {
        return this.queues.size;
    }
}
```

**Adapter Gateway pour utiliser `clearSession` si besoin**

```typescript
// packages/gateway/src/Gateway.ts — si une session expire ou est déconnectée

async removeSession(sessionId: string): Promise<void> {
    this.queue.clearSession(sessionId); // Vider la queue
    this.sessions.delete(sessionId);   // Supprimer la session (si SessionStore le supporte)
}
```

---

## 5. IMPORTANT — Heartbeat crée des sessions ACP sans jamais les fermer

### Fichier concerné
`packages/core/src/AgentRuntime.ts` — méthode `startHeartbeat()`

### Problème

À chaque tick du heartbeat, une **nouvelle session ACP est créée** via `bridge.createSession()` mais elle n'est jamais fermée. Après 24h d'uptime avec un heartbeat toutes les 5 minutes, il y a 288 sessions ACP orphelines dans le processus `gemini-cli`. Cela fait fuir la mémoire et peut dégrader la performance.

```typescript
// CODE ACTUEL — dans la boucle heartbeat
const acpSessionId = await bridge.createSession(cwd, this.config.mcpServers || []);
// ← acpSessionId n'est stocké nulle part, jamais fermé
```

---

### Solution proposée

Utiliser une **session dédiée au heartbeat** qui est réutilisée à chaque tick, et la fermer proprement au shutdown.

```typescript
// packages/core/src/AgentRuntime.ts

export class AgentRuntime extends EventEmitter {
    private config: AgentConfig;
    private transcripts: TranscriptStore;
    private skillRegistry?: SkillRegistry;
    private bridge: ACPBridge | null = null;
    private sessionMap: Map<string, string> = new Map();
    private heartbeatTimer?: NodeJS.Timeout;

    // NOUVEAU : session ACP dédiée et réutilisée pour le heartbeat
    private heartbeatSessionId: string | null = null;

    // ... constructeur inchangé ...

    private startHeartbeat(): void {
        if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
        const interval = this.config.heartbeat!.intervalMinutes * 60_000;

        const loop = async () => {
            try {
                const isAlive = await this.checkHealth();
                if (!isAlive) return;

                const bridge = await this.getBridge();

                // NOUVEAU : créer la session heartbeat une seule fois, la réutiliser ensuite
                if (!this.heartbeatSessionId) {
                    let cwd = process.cwd();
                    if (this.config.baseDir) {
                        cwd = path.resolve(this.config.baseDir, 'workspace');
                        if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });
                    }
                    this.heartbeatSessionId = await bridge.createSession(cwd, this.config.mcpServers || []);
                    console.log(`[core/runtime] Heartbeat session created: ${this.heartbeatSessionId}`);
                }

                const systemPrompt = this.loadSystemPrompt();
                const promptText = `<system_instructions>\n${systemPrompt}\n</system_instructions>\n\n` +
                    `<user_input>\n[System]: Execute your heartbeat instructions. ` +
                    `If nothing to report, reply EXACTLY: HEARTBEAT_OK\n</user_input>`;

                let responseText = '';
                await bridge.prompt(this.heartbeatSessionId, promptText, (update) => {
                    if (update.sessionUpdate === 'agent_message_chunk') {
                        responseText += update.content.text;
                    }
                });

                const finalResponse = responseText.trim();
                console.log(`[core/runtime] Heartbeat for "${this.config.name}": ${finalResponse.length} chars`);

                if (finalResponse !== 'HEARTBEAT_OK' && finalResponse !== '') {
                    this.emit('agent_proactive_message', {
                        agentName: this.config.name,
                        text: finalResponse
                    });
                }
            } catch (err) {
                console.error(`[core/runtime] Heartbeat failed for "${this.config.name}":`, err);
                // Si le heartbeat échoue, invalider la session pour en créer une nouvelle au prochain tick
                this.heartbeatSessionId = null;
            } finally {
                this.heartbeatTimer = setTimeout(loop, interval);
            }
        };

        this.heartbeatTimer = setTimeout(loop, interval);
        console.log(`[core/runtime] Started heartbeat for "${this.config.name}" every ${interval}ms`);
    }

    async shutdown(): Promise<void> {
        if (this.heartbeatTimer) {
            clearTimeout(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
        // NOUVEAU : invalider la session heartbeat au shutdown
        this.heartbeatSessionId = null;

        if (this.bridge) {
            this.bridge.stop(); // stop() rejette déjà toutes les pending requests
            this.bridge = null;
        }
        this.sessionMap.clear();
    }
}
```

---

## 6. IMPORTANT — Un seul ACPBridge partagé entre toutes les sessions

### Fichier concerné
`packages/core/src/AgentRuntime.ts` — méthode `getBridge()`

### Problème

Un seul processus `gemini-cli` (via `ACPBridge`) est partagé entre toutes les sessions utilisateurs d'un même agent. Si ce processus plante, toutes les conversations en cours échouent simultanément. La logique de redémarrage existe (dans `checkHealth`) mais elle vide `sessionMap`, ce qui supprime l'historique de contexte ACP de **tous** les utilisateurs.

---

### Solution proposée

L'approche la plus robuste serait un `ACPBridge` par session utilisateur. Cependant, cela peut être coûteux (beaucoup de processus). Une bonne solution intermédiaire est d'implémenter un **pool de bridges** avec redémarrage intelligent qui préserve les sessions encore valides.

Voici d'abord une solution simple et directe : **auto-restart du bridge avec re-création des sessions perdues**, sans impacter les sessions valides.

```typescript
// packages/core/src/AgentRuntime.ts

export class AgentRuntime extends EventEmitter {
    // ...

    /**
     * Obtient le bridge actif, ou en recrée un proprement si le précédent est mort.
     * Cette version tente de préserver les sessions existantes en ne vidant
     * sessionMap que si le bridge est réellement mort.
     */
    private async getBridge(): Promise<ACPBridge> {
        // Si on a déjà un bridge, vérifier qu'il est en vie
        if (this.bridge) {
            const alive = await this.bridge.ping(3000); // Timeout court pour la vérif
            if (alive) return this.bridge;

            // Le bridge est mort : log + nettoyage
            console.warn(
                `[core/runtime] Agent "${this.config.name}" bridge is dead. ` +
                `Restarting... ${this.sessionMap.size} ACP sessions will be lost.`
            );
            this.bridge.stop();
            this.bridge = null;
            // Les sessions ACP côté gemini-cli n'existent plus, on doit les recréer
            this.sessionMap.clear();
        }

        // Créer un nouveau bridge
        console.log(`[core/runtime] Starting new ACPBridge for agent "${this.config.name}"`);
        const newBridge = new ACPBridge(
            this.config.model,
            this.config.allowedPermissions ?? []
        );
        await newBridge.start();
        this.bridge = newBridge;
        return this.bridge;
    }

    /**
     * Version améliorée de getSessionId qui recrée la session ACP si elle a été perdue
     * (suite à un redémarrage du bridge).
     */
    private async getSessionId(userSessionId: string, bridge: ACPBridge): Promise<string> {
        if (this.sessionMap.has(userSessionId)) {
            return this.sessionMap.get(userSessionId)!;
        }

        // Session ACP non trouvée (première fois ou après redémarrage du bridge)
        let cwd = process.cwd();
        if (this.config.baseDir) {
            cwd = path.resolve(this.config.baseDir, 'workspace');
            if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });
        }

        const acpSessionId = await bridge.createSession(cwd, this.config.mcpServers || []);
        this.sessionMap.set(userSessionId, acpSessionId);
        console.log(
            `[core/runtime] Created ACP session "${acpSessionId}" for user session "${userSessionId}"`
        );
        return acpSessionId;
    }
}
```

> **Pour aller plus loin** (optionnel, pour une v2) : implémenter un `BridgePool` avec N processus `gemini-cli` tournant en parallèle, et distribuer les sessions entre eux. Cela améliore la tolérance aux pannes et le débit.

---

## 7. MINEUR — Écriture de config non atomique (race condition)

### Fichier concerné
`packages/gateway/src/Gateway.ts` — méthode `saveConfig()`

### Problème

La méthode lit le fichier JSON, le modifie en mémoire, puis le réécrit. Si deux appels à `saveConfig()` se produisent simultanément (ex: deux agents modifiés rapidement depuis le dashboard), le second écrase les changements du premier, ou pire, le fichier se retrouve corrompu (partiellement écrit).

```typescript
// CODE ACTUEL — non atomique
const raw = readFileSync(absPath, 'utf8');
const parsed = JSON.parse(raw);
parsed.agents = newConfigs;
fs.writeFileSync(absPath, JSON.stringify(parsed, null, 4), 'utf8'); // ← peut être interrompu
```

---

### Solution proposée

Utiliser une **écriture atomique** (écrire dans un fichier temporaire, puis renommer) et un **verrou en mémoire** pour sérialiser les écritures.

```typescript
// packages/gateway/src/Gateway.ts

import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

export class Gateway implements IGateway {
    // NOUVEAU : sémaphore pour sérialiser les écritures de config
    private configWriteLock: Promise<void> = Promise.resolve();

    private async saveConfig(): Promise<void> {
        // Chaîner les écritures : chaque appel attend la fin de la précédente
        this.configWriteLock = this.configWriteLock.then(() =>
            this._saveConfigAtomic()
        );
        return this.configWriteLock;
    }

    /**
     * Écriture atomique : on écrit dans un fichier .tmp, puis on le renomme
     * vers la destination finale. Sous Linux/Mac, rename() est atomique au niveau
     * du système de fichiers : jamais de fichier partiellement écrit visible.
     */
    private async _saveConfigAtomic(): Promise<void> {
        const configPath = process.env['CONFIG_PATH'] ?? './config/geminiclaw.json';
        const absPath = path.resolve(configPath);

        const { readFileSync, renameSync, writeFileSync, unlinkSync } = fs;

        const raw = readFileSync(absPath, 'utf8');
        const parsed = JSON.parse(raw);

        parsed.agents = this.registry.listConfigs();
        parsed.channels = this.channelConfigs;

        const content = JSON.stringify(parsed, null, 4);

        // Écrire dans un fichier temporaire dans le même répertoire
        // (important : même partition pour que rename() soit atomique)
        const dir = path.dirname(absPath);
        const tmpFile = path.join(dir, `.geminiclaw-config-${randomBytes(6).toString('hex')}.tmp`);

        try {
            writeFileSync(tmpFile, content, 'utf8');
            renameSync(tmpFile, absPath); // Atomique sous POSIX
            console.log(`[gateway] Configuration atomically saved to ${configPath}`);
        } catch (err) {
            // Nettoyer le fichier temporaire en cas d'erreur
            try { unlinkSync(tmpFile); } catch { /* ignore */ }
            throw err;
        }
    }
}
```

---

## 8. MINEUR — isOwner WebChat toujours true → mirroring non intentionnel

### Fichier concerné
`packages/gateway/src/Gateway.ts` — méthode `isOwner()`

### Problème

```typescript
private isOwner(channel: string, peerId: string): boolean {
    if (channel === 'webchat') return true; // ← tout utilisateur webchat = propriétaire !
    // ...
}
```

Cela signifie que la réponse de l'agent à **n'importe quel** utilisateur du webchat est mirrorée vers WhatsApp, pas seulement celle du propriétaire. Si plusieurs utilisateurs parlent à l'agent via le webchat en même temps, leurs conversations apparaissent toutes sur WhatsApp.

---

### Solution proposée

Le mirroring doit se baser sur l'identité réelle de l'utilisateur, pas sur le canal. Une approche simple : configurer un `ownerWebChatId` dans la config.

```typescript
// Dans GatewayConfig / types.ts — ajouter un champ
export interface GatewayConfig {
    // ...
    ownerWebChatId?: string; // L'identifiant clientId du propriétaire dans le webchat
}
```

```typescript
// packages/gateway/src/Gateway.ts

private isOwner(channel: string, peerId: string): boolean {
    if (channel === 'webchat') {
        // AVANT : return true (tous les utilisateurs webchat sont "owner")
        // APRÈS : vérifier l'identifiant spécifique du propriétaire
        const ownerWebChatId = this.config.ownerWebChatId;
        if (!ownerWebChatId) {
            // Si non configuré : désactiver le mirroring webchat→whatsapp
            // plutôt que de l'activer pour tout le monde
            return false;
        }
        return peerId === ownerWebChatId;
    }

    if (channel === 'whatsapp') {
        const ownerJid = this.getOwnerJid();
        if (!ownerJid) return false;
        const normOwner = ownerJid.split('@')[0];
        const normPeer = peerId.split('@')[0].split(':')[0];
        return normOwner === normPeer;
    }

    return false;
}
```

**Config `geminiclaw.json`**
```json
{
  "ownerWebChatId": "l-identifiant-client-id-du-proprietaire",
  "channels": { ... }
}
```

> Le `clientId` est généré côté client (localStorage dans le WebChat). Pour trouver la valeur, ouvrir la console du navigateur et taper `localStorage.getItem('geminiclaw-client-id')` (ou l'équivalent selon votre implémentation).

---

## Récapitulatif des priorités

| # | Priorité | Fichier | Effort estimé |
|---|----------|---------|---------------|
| 1 | 🔴 CRITIQUE | `ACPBridge.ts` — liste blanche permissions | 2-3h |
| 2 | 🔴 CRITIQUE | `ACPBridge.ts` — timeout requêtes | 1h |
| 3 | 🔴 CRITIQUE | `Gateway.ts` + `server.ts` — auth API | 3-4h |
| 4 | 🟠 IMPORTANT | `MessageQueue.ts` — cleanup + flood limit | 1h |
| 5 | 🟠 IMPORTANT | `AgentRuntime.ts` — heartbeat sessions | 1h |
| 6 | 🟠 IMPORTANT | `AgentRuntime.ts` — bridge restart propre | 2h |
| 7 | 🟡 MINEUR | `Gateway.ts` — écriture atomique config | 30min |
| 8 | 🟡 MINEUR | `Gateway.ts` — isOwner webchat | 20min |

**Total estimé : ~11-14 heures de développement** pour couvrir l'ensemble des corrections.

---

*Document généré après audit du code source. Les extraits de code sont à adapter selon les versions exactes de vos dépendances et la structure finale de votre projet.*
