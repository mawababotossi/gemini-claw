import axios from 'axios';

const API_BASE_URL = `http://${window.location.hostname}:3002/api`;

// Use an environment variable for the secret. 
// In Vite, this must start with VITE_ to be exposed to the client.
const DASHBOARD_SECRET = import.meta.env.VITE_DASHBOARD_SECRET || '';

axios.interceptors.request.use((config) => {
    if (DASHBOARD_SECRET) {
        config.headers.Authorization = `Bearer ${DASHBOARD_SECRET}`;
    }
    return config;
});

export interface AgentConfig {
    name: string;
    model: string;
    modelCallback?: string;
    fallbackModels?: string[];
    maxHistoryMessages?: number;
    allowedPermissions?: string[];
    baseDir?: string;
    status?: 'Healthy' | 'Unresponsive' | 'Restarting' | 'Dead';
    heartbeat?: {
        enabled: boolean;
        cron?: string;
    };
    authType?: string;
    apiKey?: string;
    /** List of enabled prompt-driven skills (OpenClaw) */
    skills?: string[];
}

export interface AppStatus {
    status: string;
    authType: string;
    accountHint: string;
    uptime?: number;
    tickInterval?: number;
    lastChannelsRefresh?: number;
    instances?: number;
    sessions?: number;
    cron?: number;
}

export interface ProjectConfig {
    name: string;
    description?: string;
    defaultModel?: string;
}

export interface ProviderConfig {
    name: string;
    type: 'google' | 'openai' | 'anthropic' | 'custom';
    apiKey?: string;
    baseUrl?: string;
    models?: string[];
}

export interface GlobalConfig {
    project: ProjectConfig;
    providers: ProviderConfig[];
    dataDir: string;
    gatewayPort?: number;
}

export const api = {
    async getStatus(): Promise<AppStatus> {
        const response = await axios.get(`${API_BASE_URL}/status`);
        return response.data;
    },

    async getGlobalConfig(): Promise<GlobalConfig> {
        const response = await axios.get(`${API_BASE_URL}/config/global`);
        return response.data;
    },

    async updateProjectConfig(config: Partial<ProjectConfig>): Promise<void> {
        await axios.put(`${API_BASE_URL}/config/project`, config);
    },

    async updateProviders(providers: ProviderConfig[]): Promise<void> {
        await axios.put(`${API_BASE_URL}/config/providers`, providers);
    },

    async getAgents(): Promise<AgentConfig[]> {
        const response = await axios.get(`${API_BASE_URL}/agents`);
        return response.data;
    },

    async getModels(): Promise<string[]> {
        const response = await axios.get(`${API_BASE_URL}/models`);
        return response.data;
    },

    async createAgent(config: AgentConfig): Promise<void> {
        await axios.post(`${API_BASE_URL}/agents`, config);
    },

    async updateAgent(name: string, config: AgentConfig): Promise<void> {
        await axios.put(`${API_BASE_URL}/agents/${name}`, config);
    },

    async deleteAgent(name: string): Promise<void> {
        await axios.delete(`${API_BASE_URL}/agents/${name}`);
    },

    async getAgentJobs(name: string): Promise<any[]> {
        const response = await axios.get(`${API_BASE_URL}/agents/${name}/jobs`);
        return response.data;
    },

    async deleteAgentJob(agentName: string, jobId: string): Promise<void> {
        await axios.delete(`${API_BASE_URL}/agents/${agentName}/jobs/${jobId}`);
    },

    async getAgentMemory(name: string): Promise<any[]> {
        const response = await axios.get(`${API_BASE_URL}/agents/${name}/memory`);
        return response.data;
    },

    async getAgentMemoryContent(agentName: string, filename: string): Promise<string> {
        const response = await axios.get(`${API_BASE_URL}/agents/${agentName}/memory/${filename}`);
        return response.data.content;
    },

    async updateAgentMemoryContent(agentName: string, filename: string, content: string): Promise<void> {
        await axios.put(`${API_BASE_URL}/agents/${agentName}/memory/${filename}`, { content });
    },

    async getSkills(): Promise<{ native: any[], project: any[], prompt: any[] }> {
        const response = await axios.get(`${API_BASE_URL}/skills`);
        return response.data;
    },

    async installSkill(name: string): Promise<{ success: boolean, output: string }> {
        const response = await axios.post(`${API_BASE_URL}/skills/${name}/install`);
        return response.data;
    },

    async configureSkill(name: string, envVars: Record<string, string>): Promise<{ success: boolean, status: string }> {
        const response = await axios.post(`${API_BASE_URL}/skills/${name}/configure`, { envVars });
        return response.data;
    },

    async getSessions(): Promise<any[]> {
        const response = await axios.get(`${API_BASE_URL}/sessions`);
        return response.data;
    },

    async getJobs(): Promise<any[]> {
        const response = await axios.get(`${API_BASE_URL}/jobs`);
        return response.data;
    },

    // ── Channels ──
    async getWhatsAppStatus(): Promise<any> {
        const response = await axios.get(`${API_BASE_URL}/channels/whatsapp/status`);
        return response.data;
    },

    async logoutWhatsApp(): Promise<void> {
        await axios.post(`${API_BASE_URL}/channels/whatsapp/logout`);
    },

    async getChannelConfig(name: string): Promise<any> {
        const response = await axios.get(`${API_BASE_URL}/channels/${name}`);
        return response.data;
    },

    async updateChannelConfig(name: string, config: any): Promise<void> {
        await axios.put(`${API_BASE_URL}/channels/${name}`, config);
    },

    // ── Transcripts ──
    async getTranscript(channel: string, peerId: string): Promise<any[]> {
        const response = await axios.get(`${API_BASE_URL}/transcripts/${channel}/${peerId}`);
        return response.data;
    }
};
