import type { AgentConfig, ProjectConfig, ProviderConfig } from '@geminiclaw/core';
export interface ChannelConfig {
    enabled: boolean;
    agent: string;
    token?: string;
    allowedUserIds?: number[];
    mentionOnly?: boolean;
    allowedJids?: string[];
    port?: number;
}
export interface CronJob {
    schedule: string;
    agent: string;
    channel: string;
    peerId: string;
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
//# sourceMappingURL=types.d.ts.map