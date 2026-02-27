/**
 * @license Apache-2.0
 * @geminiclaw/core — AgentConfig schema
 */
export interface AgentConfig {
    /** Agent identifier (matches agents.json) */
    name: string;
    /** Primary Gemini model ID, e.g. "gemini-2.5-pro" */
    model: string;
    /** Model to use if the primary model fails or is unavailable */
    modelCallback?: string;
    /** Ordered fallback models if primary and callback fail */
    fallbackModels?: string[];
    /** Auth type — mirrors AuthType from gemini-cli-core */
    authType?: 'oauth-personal' | 'gemini-api-key' | 'vertex-ai';
    /** API key (when authType = 'gemini-api-key') */
    apiKey?: string;
    /** Max history messages to inject as context */
    maxHistoryMessages?: number;
    /** Any custom MCP servers to attach when starting an ACP session */
    mcpServers?: any[];
    /** Base directory for agent-specific files (AGENTS.md, USER.md, SOUL.md, workspace/) */
    baseDir?: string;
    /** Proactive heartbeat configuration */
    heartbeat?: {
        enabled: boolean;
        intervalMinutes: number;
    };
}

export interface ProviderConfig {
    name: string;
    type: 'google' | 'openai' | 'anthropic' | 'custom';
    apiKey?: string;
    baseUrl?: string;
    models?: string[];
}

export interface ProjectConfig {
    name: string;
    description?: string;
    defaultModel?: string;
}

export interface RuntimeConfig {
    /** Root directory for data (sessions, transcripts) */
    dataDir: string;
    agents: AgentConfig[];
}

export interface IGateway {
    registerChannel(channel: string, sendCallback: (peerId: string, text: string) => Promise<void>): void;
    ingest(channel: string, peerId: string, text: string, attachments?: any[], metadata?: Record<string, any>): Promise<void>;
}
