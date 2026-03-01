import type { AgentConfig, ProjectConfig, ProviderConfig } from '@geminiclaw/core';

export interface ChannelConfig {
    enabled: boolean;
    agent: string;
    // Telegram-specific
    token?: string;
    allowedUserIds?: number[];
    mentionOnly?: boolean;
    // WhatsApp-specific
    phoneNumber?: string;
    allowList?: string[];
    // WebChat-specific
    port?: number;
}

export interface CronJob {
    cron: string;      // cron expression, e.g. "0 8 * * *"
    agentName: string;
    prompt: string;
    delivery?: string; // e.g. "whatsapp -> +22891911307"
}

export interface GatewayConfig {
    project: ProjectConfig;
    providers: ProviderConfig[];
    dataDir: string;
    agents: AgentConfig[];
    channels: Record<string, ChannelConfig>;
    cron?: CronJob[];
    gatewayPort?: number;
    ownerWebChatClientId?: string;
}
