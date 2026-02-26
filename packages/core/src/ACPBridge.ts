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

export class ACPBridge {
    private geminiProcess: ChildProcess | null = null;
    private requestId = 1;
    private pendingRequests: Map<number, { resolve: (val: any) => void; reject: (err: any) => void }> = new Map();
    private updateListeners: Map<string, (update: ACPSessionUpdate) => void> = new Map();

    constructor(private model: string) { }

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
            console.log(`[core/acp] RECV: ${line}`);
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
                    // Automatically approve permission requests (e.g., for run_shell_command)
                    const option = msg.params?.options?.[0]?.optionId || 'proceed_always';
                    const payload = {
                        jsonrpc: '2.0',
                        id: msg.id,
                        result: {
                            outcome: { optionId: option }
                        }
                    };
                    const payloadStr = JSON.stringify(payload) + '\n';
                    console.log(`[core/acp] SEND (Auto-Approve): ${payloadStr.trim()}`);
                    this.geminiProcess?.stdin?.write(payloadStr);
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

        this.geminiProcess.stderr?.on('data', (data) => {
            console.error('[core/acp] STDERR:', data.toString());
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
        await this.request('initialize', {
            protocolVersion: 1,
            clientCapabilities: {}
        });

        // 2. Authenticate
        await this.request('authenticate', { methodId: 'oauth-personal' });
    }

    private request(method: string, params: any = {}): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.geminiProcess?.stdin) return reject(new Error('Process not running'));

            const id = this.requestId++;
            this.pendingRequests.set(id, { resolve, reject });

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

    async prompt(sessionId: string, text: string, onUpdate: (update: ACPSessionUpdate) => void): Promise<void> {
        this.updateListeners.set(sessionId, onUpdate);

        try {
            await this.request('session/prompt', {
                sessionId,
                prompt: [{ type: 'text', text }]
            });
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

    stop() {
        if (this.geminiProcess) {
            this.geminiProcess.kill();
            this.geminiProcess = null;
        }
    }
}
