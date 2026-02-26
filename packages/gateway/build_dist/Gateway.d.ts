/**
 * @license Apache-2.0
 * @geminiclaw/gateway — Gateway
 *
 * Central hub. Channel adapters call `ingest()` to submit messages.
 * The Gateway resolves the session, checks ACL, queues the message,
 * calls the appropriate AgentRuntime and dispatches the response.
 */
import type { InboundMessage, Session, ChatMessage } from '@geminiclaw/memory';
import type { AgentConfig } from '@geminiclaw/core';
import { SkillMcpServer } from '@geminiclaw/skills';
import type { GatewayConfig } from './types.js';
/** Channel adapters register a send callback so the gateway can reply */
export type SendCallback = (peerId: string, text: string, thought?: string) => Promise<void>;
export declare class Gateway {
    private config;
    private sessions;
    private transcripts;
    private registry;
    private skillRegistry;
    mcpServer: SkillMcpServer;
    private queue;
    private sendCallbacks;
    private channelConfigs;
    constructor(config: GatewayConfig);
    private registerBuiltinSkills;
    /**
     * Channel adapters register themselves here so the gateway can
     * route responses back to the correct channel.
     */
    registerChannel(channelName: string, sendFn: SendCallback): void;
    /**
     * Main entry point for all channel adapters.
     * Ingest a message → resolve session → ACL check → queue → reply.
     */
    ingest(channel: string, peerId: string, text: string, attachments?: InboundMessage['attachments']): Promise<void>;
    /** Send a message out via a registered channel send callback */
    send(channel: string, peerId: string, text: string, thought?: string): Promise<void>;
    /** Get all active sessions */
    listSessions(): Session[];
    /** Load historical messages for a specific peer on a channel */
    getTranscript(channel: string, peerId: string): ChatMessage[];
    listAgents(): AgentConfig[];
    listAvailableModels(): string[];
    addAgent(config: AgentConfig): Promise<void>;
    updateAgent(name: string, config: AgentConfig): Promise<void>;
    removeAgent(name: string): Promise<void>;
    private saveConfig;
    shutdown(): Promise<void>;
    private isAuthorized;
}
//# sourceMappingURL=Gateway.d.ts.map