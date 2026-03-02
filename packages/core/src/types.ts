/**
 * @license Apache-2.0
 * @geminiclaw/core — AgentConfig schema
 */
import { InboundMessage, AgentResponse, OutboundAttachment } from '@geminiclaw/memory';

export type ACPProvider =
    | 'gemini'        // gemini --experimental-acp (default)
    | 'claude-code'   // claude --acp (Claude Code CLI)
    | 'codex'         // codex --acp (OpenAI Codex CLI)
    | string;         // custom/future provider

export interface AgentConfig {
    /** Agent identifier (matches agents.json) */
    name: string;
    /** Primary model ID, e.g. "gemini-2.0-flash" or "claude-3-5-sonnet" */
    model: string;
    /** Optional ACP provider — defaults to "gemini" if omitted */
    provider?: ACPProvider;
    /** Model to use if the primary model fails or is unavailable */
    modelCallback?: string;
    /** Ordered fallback models if primary and callback fail */
    fallbackModels?: string[];
    /** Auth type — mirrors AuthType from gemini-cli-core */
    authType?: 'oauth-personal' | 'gemini-api-key' | 'vertex-ai' | 'claude-api-key' | 'openai-api-key';
    /** API key (when authType = 'gemini-api-key' etc.) */
    apiKey?: string;
    /** Max history messages to inject as context */
    maxHistoryMessages?: number;
    /** Any custom MCP servers to attach when starting an ACP session */
    mcpServers?: any[];
    /** Base directory for agent-specific files (AGENTS.md, USER.md, SOUL.md, workspace/) */
    baseDir?: string;
    /** Dynamic connection health status (injected at runtime, not persisted) */
    status?: 'Healthy' | 'Unresponsive' | 'Restarting' | 'Dead';
    /** Proactive heartbeat/distillation configuration */
    heartbeat?: {
        enabled: boolean;
        intervalMinutes?: number;
        cron?: string;
    };
    /** Whitelist of granted permissions (run_shell_command, write_file, read_file, network) */
    allowedPermissions?: string[];
    /** List of enabled prompt-driven skills (OpenClaw) */
    skills?: string[];
}

export interface ProviderConfig {
    name: string;
    type: 'google' | 'openai' | 'anthropic' | 'custom';
    apiKey?: string;
    baseUrl?: string;
    models?: string[];
    /** CLI binary associated with this provider */
    cli?: string;
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

export type ActivityType = 'typing' | 'paused';

export interface IGateway {
    registerChannel(
        channel: string,
        sendCallback: (peerId: string, text: string, thought?: string) => Promise<void>,
        activityCallback?: (peerId: string, type: ActivityType) => Promise<void>,
        sendFileCallback?: (peerId: string, att: OutboundAttachment) => Promise<void>
    ): void;
    ingest(channel: string, peerId: string, text: string, attachments?: any[], metadata?: Record<string, any>): Promise<void>;
    listSessionsDetailed(): any[];
}
