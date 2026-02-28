/**
 * @license Apache-2.0
 * @geminiclaw/core — ACPBridge
 */
import { spawn, ChildProcess } from 'node:child_process';
import readline from 'node:readline';

export interface ACPMessageChunk {
    type: 'text';
    text: string;
}

export interface ACPSessionUpdate {
    sessionUpdate: 'agent_thought_chunk' | 'agent_message_chunk';
    content: ACPMessageChunk;
}

// Default timeout for standard requests (ms)
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export class ACPBridge {
    private geminiProcess: ChildProcess | null = null;
    private requestId = 1;
    private pendingRequests: Map<number, { resolve: (val: any) => void; reject: (err: any) => void }> = new Map();
    private updateListeners: Map<string, (update: ACPSessionUpdate) => void> = new Map();

    constructor(
        private model: string,
        private allowedPermissions: string[] = []
    ) { }

    async start(options?: { authType?: string; apiKey?: string }): Promise<void> {
        let cmd = 'gemini';
        // Fallback for environments where global bin is not in PATH (like PM2)
        const fs = await import('node:fs');
        const paths = ['/usr/bin/gemini', '/usr/local/bin/gemini', '/root/.local/bin/gemini'];
        for (const p of paths) {
            if (fs.existsSync(p)) {
                cmd = p;
                break;
            }
        }

        const env: Record<string, string | undefined> = {
            ...process.env,
            CI: 'true',
            TERM: 'dumb',
            NO_COLOR: '1'
        };
        if (options?.apiKey) {
            env.GEMINI_API_KEY = options.apiKey;
        }

        this.geminiProcess = spawn(cmd, ['--experimental-acp', '-m', this.model], { env });

        if (!this.geminiProcess.stdout || !this.geminiProcess.stdin) {
            throw new Error('[core/acp] Failed to start gemini process or stream I/O');
        }

        const rl = readline.createInterface({
            input: this.geminiProcess.stdout,
            terminal: false
        });

        rl.on('line', (line) => {
            console.log(`[core/acp] RECV: ${line}`);
            try {
                // If we see an OAuth URL, and we are waiting for an authenticate response, 
                // it means headless auth failed/needs interaction.
                if (line.includes('accounts.google.com/o/oauth2/v2/auth')) {
                    const authReqId = Array.from(this.pendingRequests.entries()).find(([id, req]) => id === 2)?.[0];
                    if (authReqId !== undefined) {
                        const { reject } = this.pendingRequests.get(authReqId)!;
                        this.pendingRequests.delete(authReqId);
                        reject(new Error('[core/acp] GCA Authentication requires manual interaction (URL provided in logs). Please use GEMINI_API_KEY instead on headless servers.'));
                    }
                }

                const msg = JSON.parse(line);

                // Silently ignore ping "Method not found" errors to prevent log pollution
                if (msg.error && msg.error.code === -32601 && msg.error.data?.method === 'ping') {
                    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
                        const { resolve } = this.pendingRequests.get(msg.id)!;
                        this.pendingRequests.delete(msg.id);
                        resolve(true); // Treat as healthy since the process responded
                    }
                    return; // Skip logging this specific expected error
                }

                if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
                    const { resolve, reject } = this.pendingRequests.get(msg.id)!;
                    this.pendingRequests.delete(msg.id);
                    if (msg.error) {
                        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                    } else {
                        resolve(msg.result);
                    }
                } else if (msg.method === 'session/request_permission') {
                    this.handlePermissionRequest(msg);
                } else if ((msg.method === 'sessionUpdate' || msg.method === 'session/update') && msg.params?.sessionId) {
                    const listener = this.updateListeners.get(msg.params.sessionId);
                    if (listener && msg.params.update) {
                        listener(msg.params.update);
                    }
                }
            } catch (err) {
                // Ignore parsing errors for non-JSON lines
            }
        });

        this.geminiProcess.stderr?.on('data', (data) => {
            const str = data.toString();
            if (str.includes('"Method not found": ping')) return;
            console.error('[core/acp] STDERR:', str);
        });

        this.geminiProcess.on('error', (err) => {
            console.error('[core/acp] Failed to start gemini process:', err);
        });

        this.geminiProcess.on('exit', (code, signal) => {
            console.log(`[core/acp] Gemini process exited with code ${code} and signal ${signal}`);
            // Reject any pending requests
            for (const [id, req] of this.pendingRequests.entries()) {
                req.reject(new Error(`Process exited with code ${code}`));
                this.pendingRequests.delete(id);
            }
        });

        console.log(`[core/acp] Spawned gemini --experimental-acp -m ${this.model}`);

        // 1. Initialize
        const initResult = await this.request('initialize', {
            protocolVersion: 1,
            clientCapabilities: {}
        });

        // 2. Select Auth Method
        let methodId = options?.authType;
        const availableMethods = initResult.authMethods?.map((m: any) => m.id) || [];

        if (!methodId) {
            if (availableMethods.includes('gemini-api-key') && (env.GEMINI_API_KEY || process.env.GEMINI_API_KEY)) {
                methodId = 'gemini-api-key';
            } else if (availableMethods.includes('oauth-personal')) {
                methodId = 'oauth-personal';
            } else {
                methodId = availableMethods[0];
            }
        }

        if (!methodId) {
            throw new Error('[core/acp] No authentication method available');
        }

        console.log(`[core/acp] Authenticating with method: ${methodId}`);
        await this.request('authenticate', { methodId });
    }

    private request(method: string, params: any = {}, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.geminiProcess?.stdin) return reject(new Error('Process not running'));

            const id = this.requestId++;

            // Set a timeout for the request to avoid hanging the whole system
            const timeoutHandler = setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`[core/acp] Request "${method}" timed out after ${timeoutMs}ms`));
                }
            }, timeoutMs);

            this.pendingRequests.set(id, {
                resolve: (val) => { clearTimeout(timeoutHandler); resolve(val); },
                reject: (err) => { clearTimeout(timeoutHandler); reject(err); }
            });

            const msg = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };
            const payload = JSON.stringify(msg) + '\n';
            console.log(`[core/acp] SEND: ${payload.trim()}`);
            this.geminiProcess.stdin.write(payload);
        });
    }

    async createSession(cwd: string, mcpServers: any[] = []): Promise<string> {

        const res = await this.request('session/new', { cwd, mcpServers });
        return res.sessionId;
    }

    async prompt(
        sessionId: string,
        text: string,
        onUpdate: (update: ACPSessionUpdate) => void,
        timeoutMs: number = 300000 // 5 minutes default for prompts
    ): Promise<void> {
        this.updateListeners.set(sessionId, onUpdate);

        try {
            await this.request('session/prompt', {
                sessionId,
                prompt: [{ type: 'text', text }]
            }, timeoutMs);
        } finally {
            this.updateListeners.delete(sessionId);
        }
    }

    async ping(timeoutMs = 5000): Promise<boolean> {
        if (!this.geminiProcess || this.geminiProcess.exitCode !== null) return false;

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                resolve(false);
            }, timeoutMs);

            this.request('ping', {}).then(() => {
                clearTimeout(timer);
                resolve(true);
            }).catch(() => {
                // Method not found is still a sign of life
                clearTimeout(timer);
                resolve(true);
            });
        });
    }

    private handlePermissionRequest(msg: any): void {
        const requestedAction: string =
            msg.params?.toolName
            ?? msg.params?.action
            ?? msg.params?.options?.[0]?.label
            ?? 'unknown';

        const isAllowed = this.allowedPermissions.some(
            (perm) => requestedAction.toLowerCase().includes(perm.toLowerCase())
        );

        if (isAllowed) {
            const option = msg.params?.options?.[0]?.optionId || 'proceed_once';
            const payload = {
                jsonrpc: '2.0',
                id: msg.id,
                result: { outcome: { optionId: option } }
            };
            console.log(`[core/acp] Permission GRANTED for action="${requestedAction}"`);
            this.geminiProcess?.stdin?.write(JSON.stringify(payload) + '\n');
        } else {
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

    stop() {
        if (this.geminiProcess) {
            this.geminiProcess.kill();
            this.geminiProcess = null;
        }
        // Reject all pending requests
        for (const [id, req] of this.pendingRequests.entries()) {
            req.reject(new Error('[core/acp] Bridge stopped, all pending requests cancelled'));
            this.pendingRequests.delete(id);
        }
    }
}
