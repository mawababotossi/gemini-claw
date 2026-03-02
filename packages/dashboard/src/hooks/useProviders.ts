import { useState, useEffect } from 'react';
import { api } from '../services/api';

export interface ProviderMetadata {
    id: string;
    name: string;
    type: string;
    models: string[];
    authType: string[];
}

export function useProviders() {
    const [providers, setProviders] = useState<ProviderMetadata[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchProviders = async () => {
        try {
            setIsLoading(true);
            const data = await api.getProviders();
            setProviders(data);
            setError(null);
        } catch (err: any) {
            console.error('Failed to fetch providers', err);
            setError(err.message || 'Failed to fetch providers');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchProviders();
    }, []);

    const getProviderById = (id: string) => providers.find(p => p.id === id);

    return {
        providers,
        isLoading,
        error,
        refresh: fetchProviders,
        getProviderById
    };
}
