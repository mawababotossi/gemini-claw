import axios from 'axios';

const API_BASE_URL = '/api';

// Configure axios for cookie-based authentication
axios.defaults.withCredentials = true;

// Direct token usage via env is deprecated in favor of secure HttpOnly cookies.
// We keep the interceptor only for explicit Bearer overrides if needed.
axios.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            // Only clear auth if it's not the login request itself
            if (!error.config.url.endsWith('/auth/login')) {
                localStorage.removeItem('isAuthenticated');
                window.location.href = '/';
            }
        }
        return Promise.reject(error);
    }
);

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
    skills?: string[];
    provider?: string;
    mcpServers?: { name: string; type: string; url?: string; headers?: any[] }[];
    performance?: {
        bridgeIdleTtlMs?: number;
        maxConcurrentBridges?: number;
    };
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
    performance?: {
        bridgeIdleTtlMs?: number;
        maxConcurrentBridges?: number;
        maxMessageQueueSize?: number;
        bridgeGcIntervalMs?: number;
    };
}

export interface ProviderConfig {
    name: string;
    type: 'google' | 'openai' | 'anthropic' | 'custom';
    apiKey?: string;
    baseUrl?: string;
    models?: string[];
    authType?: string[];
}

export interface GlobalConfig {
    project: ProjectConfig;
    providers: ProviderConfig[];
    dataDir: string;
    gatewayPort?: number;
}

export interface SkillManifest {
    name: string;
    description: string;
    kind: 'prompt' | 'mcp' | 'native';
    status: 'enabled' | 'disabled' | 'needs-config' | 'needs-install';
    requiredEnv?: { key: string; description?: string; secret?: boolean; url?: string }[];
    missingEnv?: string[];
    missingBins?: string[];
    reason?: string;
    parameters?: any;
    manuallyDisabled?: boolean;
    assignedAgents?: string[];
    icon?: string;
    install?: InstallStep[];
    homepage?: string;
}

export interface InstallStep {
    id?: string;
    kind: string;
    formula?: string;    // brew
    package?: string;    // apt, uv, node (fallback)
    module?: string;     // go, node (prioritaire)
    command?: string;    // shell
    label?: string;
    bins?: string[];
    os?: string[];
}

export const api = {
    async login(token: string): Promise<boolean> {
        try {
            const response = await axios.post(`${API_BASE_URL}/auth/login`, { token });
            return response.data.success;
        } catch {
            return false;
        }
    },

    async logout(): Promise<void> {
        await axios.post(`${API_BASE_URL}/auth/logout`);
    },

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

    async getModels(provider?: string): Promise<string[]> {
        const params = provider ? `?provider=${encodeURIComponent(provider)}` : '';
        const response = await axios.get(`${API_BASE_URL}/models${params}`);
        return response.data;
    },

    async getProviders(): Promise<any[]> {
        const response = await axios.get(`${API_BASE_URL}/providers`);
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

    /**
     * Récupère la liste unifiée des skills (prompt + mcp + native)
     */
    async getSkillManifests(agentName?: string): Promise<SkillManifest[]> {
        const params = agentName ? `?agent=${encodeURIComponent(agentName)}` : '';
        const response = await axios.get(`${API_BASE_URL}/skills${params}`);
        return response.data;
    },

    /** Legacy method - deprecated but kept for compatibility */
    async getSkills(): Promise<{ native: any[], project: any[], prompt: any[] }> {
        const response = await axios.get(`${API_BASE_URL}/skills`);
        // If the backend returns a flat array now, this might need mapping or just return empty structure
        if (Array.isArray(response.data)) {
            return {
                native: response.data.filter(s => s.kind === 'native'),
                project: response.data.filter(s => s.kind === 'mcp'),
                prompt: response.data.filter(s => s.kind === 'prompt')
            };
        }
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

    /** Désactive manuellement un skill */
    async disableSkill(name: string): Promise<void> {
        await axios.post(`${API_BASE_URL}/skills/${encodeURIComponent(name)}/disable`);
    },

    /** Réactive un skill */
    async enableSkill(name: string): Promise<void> {
        await axios.post(`${API_BASE_URL}/skills/${encodeURIComponent(name)}/enable`);
    },

    /** Met à jour les skills d'un agent */
    async updateAgentSkills(agentName: string, skills: string[]): Promise<void> {
        await axios.patch(`${API_BASE_URL}/agents/${encodeURIComponent(agentName)}/skills`, { skills });
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
    },

    // ── Heartbeat ──
    async triggerAgentHeartbeat(name: string): Promise<{ success: boolean; message?: string }> {
        const response = await axios.post(`${API_BASE_URL}/agents/${encodeURIComponent(name)}/heartbeat`);
        return response.data;
    },

    // ── Message Board ──
    async getBoardChannels(): Promise<string[]> {
        const response = await axios.get(`${API_BASE_URL}/board/channels`);
        return response.data;
    },

    async getBoardMessages(channel: string, limit = 50): Promise<any[]> {
        const response = await axios.get(`${API_BASE_URL}/board/${encodeURIComponent(channel)}/messages?limit=${limit}`);
        return response.data;
    }
};
