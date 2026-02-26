import axios from 'axios';

const API_BASE_URL = 'http://localhost:3002/api';

export interface AgentConfig {
    name: string;
    model: string;
    modelCallback?: string;
    fallbackModels?: string[];
    maxHistoryMessages?: number;
    skills?: string[];
    baseDir?: string;
    status?: 'Healthy' | 'Unresponsive' | 'Restarting' | 'Dead';
}

export interface AppStatus {
    status: string;
    authType: string;
    accountHint: string;
}

export const api = {
    async getStatus(): Promise<AppStatus> {
        const response = await axios.get(`${API_BASE_URL}/status`);
        return response.data;
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
    }
};
