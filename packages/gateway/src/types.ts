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
    schedule: string;  // cron expression, e.g. "0 8 * * *"
    agent: string;
    channel: string;
    peerId: string;    // recipient to send to
    prompt: string;
}

export interface GatewayConfig {
    project: ProjectConfig;
    providers: ProviderConfig[];
    dataDir: string;
    agents: AgentConfig[];
    channels: Record<string, ChannelConfig>;
    cron?: CronJob[];
    gatewayPort?: number;
}
