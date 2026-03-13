import { useState, useEffect } from 'react';
import { Globe, Cpu, Database, Save, Plus, Trash2, Eye, EyeOff, Zap } from 'lucide-react';
import { api, type GlobalConfig, type ProviderConfig } from '../services/api';
import './Settings.css';

import { PageHeader } from '../components/PageHeader';

export function Settings() {
    const [config, setConfig] = useState<GlobalConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showKeys, setShowKeys] = useState<Record<number, boolean>>({});
    const [models, setModels] = useState<string[]>([]);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            const [cfg, availableModels] = await Promise.all([
                api.getGlobalConfig(),
                api.getModels()
            ]);
            setConfig(cfg);
            setModels(availableModels);
        } catch (err) {
            console.error('Failed to load config:', err);
        } finally {
            setLoading(false);
        }
    }

    const handleProjectChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (!config) return;
        const { name, value } = e.target;
        setConfig({
            ...config,
            project: { ...config.project, [name]: value }
        });
    };

    const handleSaveProject = async () => {
        if (!config) return;
        setSaving(true);
        try {
            await api.updateProjectConfig(config.project);
            alert('Project settings saved successfully!');
        } catch (err) {
            console.error('Save failed:', err);
            alert('Failed to save project settings.');
        } finally {
            setSaving(false);
        }
    };

    const handleProviderChange = (index: number, field: keyof ProviderConfig, value: any) => {
        if (!config) return;
        const newProviders = [...config.providers];
        newProviders[index] = { ...newProviders[index], [field]: value };
        setConfig({ ...config, providers: newProviders });
    };

    const addProvider = () => {
        if (!config) return;
        const newProvider: ProviderConfig = {
            name: 'New Provider',
            type: 'custom',
            apiKey: '',
            models: []
        };
        setConfig({ ...config, providers: [...config.providers, newProvider] });
    };

    const removeProvider = (index: number) => {
        if (!config) return;
        const newProviders = config.providers.filter((_, i: number) => i !== index);
        setConfig({ ...config, providers: newProviders });
    };

    const handleSaveProviders = async () => {
        if (!config) return;
        setSaving(true);
        try {
            await api.updateProviders(config.providers);
            alert('Providers updated successfully!');
        } catch (err) {
            console.error('Save failed:', err);
            alert('Failed to update providers.');
        } finally {
            setSaving(false);
        }
    };

    const toggleKeyVisibility = (index: number) => {
        setShowKeys((prev: Record<number, boolean>) => ({ ...prev, [index]: !prev[index] }));
    };

    if (loading) return <div className="page-container p-8"><p className="text-muted">Loading settings...</p></div>;
    if (!config) return <div className="page-container p-8"><p className="text-danger">Error loading configuration.</p></div>;

    return (
        <div className="page-container settings-page">
            <PageHeader
                title="System Settings"
                description="Manage global system parameters and AI provider integrations."
            />

            <div className="settings-grid">
                {/* Project Section */}
                <div className="glass-panel settings-section">
                    <div className="section-header">
                        <Globe size={20} />
                        <h2>Project Metadata</h2>
                    </div>
                    <div className="form-group">
                        <label>Name</label>
                        <input
                            name="name"
                            value={config.project.name}
                            onChange={handleProjectChange}
                            placeholder="ClawGate"
                        />
                    </div>
                    <div className="form-group">
                        <label>Description</label>
                        <textarea
                            name="description"
                            value={config.project.description || ''}
                            onChange={handleProjectChange}
                            placeholder="AI Agent Supervisor"
                        />
                    </div>
                    <div className="form-group">
                        <label>Default Model</label>
                        <select
                            name="defaultModel"
                            value={config.project.defaultModel || ''}
                            onChange={(e) => handleProjectChange(e as any)}
                        >
                            <option value="">Select a model...</option>
                            {models.map((m: string) => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>

                    <div className="section-header" style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                        <Zap size={20} />
                        <h2>Global Performance</h2>
                    </div>
                    <div className="form-row split-form" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div className="form-group">
                            <label>Max Session Queue</label>
                            <input
                                type="number"
                                value={config.project.performance?.maxMessageQueueSize ?? ''}
                                onChange={e => {
                                    const val = e.target.value ? parseInt(e.target.value) : undefined;
                                    setConfig({
                                        ...config,
                                        project: {
                                            ...config.project,
                                            performance: { ...(config.project.performance ?? {}), maxMessageQueueSize: val }
                                        }
                                    });
                                }}
                                placeholder="50"
                            />
                        </div>
                        <div className="form-group">
                            <label>Bridge GC Interval (ms)</label>
                            <input
                                type="number"
                                value={config.project.performance?.bridgeGcIntervalMs ?? ''}
                                onChange={e => {
                                    const val = e.target.value ? parseInt(e.target.value) : undefined;
                                    setConfig({
                                        ...config,
                                        project: {
                                            ...config.project,
                                            performance: { ...(config.project.performance ?? {}), bridgeGcIntervalMs: val }
                                        }
                                    });
                                }}
                                placeholder="30000"
                            />
                        </div>
                    </div>
                    <div className="form-row split-form" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                        <div className="form-group">
                            <label>Default Idle TTL (ms)</label>
                            <input
                                type="number"
                                value={config.project.performance?.bridgeIdleTtlMs ?? ''}
                                onChange={e => {
                                    const val = e.target.value ? parseInt(e.target.value) : undefined;
                                    setConfig({
                                        ...config,
                                        project: {
                                            ...config.project,
                                            performance: { ...(config.project.performance ?? {}), bridgeIdleTtlMs: val }
                                        }
                                    });
                                }}
                                placeholder="1800000"
                            />
                        </div>
                        <div className="form-group">
                            <label>Default Max Bridges</label>
                            <input
                                type="number"
                                value={config.project.performance?.maxConcurrentBridges ?? ''}
                                onChange={e => {
                                    const val = e.target.value ? parseInt(e.target.value) : undefined;
                                    setConfig({
                                        ...config,
                                        project: {
                                            ...config.project,
                                            performance: { ...(config.project.performance ?? {}), maxConcurrentBridges: val }
                                        }
                                    });
                                }}
                                placeholder="0"
                            />
                        </div>
                    </div>

                    <div className="section-actions">
                        <button
                            className="btn btn-primary"
                            onClick={handleSaveProject}
                            disabled={saving}
                        >
                            <Save size={16} /> Save Project
                        </button>
                    </div>
                </div>

                {/* System Section */}
                <div className="glass-panel settings-section">
                    <div className="section-header">
                        <Database size={20} />
                        <h2>System</h2>
                    </div>
                    <div className="info-item">
                        <label>Data Directory</label>
                        <code>{config.dataDir}</code>
                    </div>
                    <div className="info-item">
                        <label>Gateway Port</label>
                        <code>{config.gatewayPort || 3002}</code>
                    </div>
                    <div className="info-item">
                        <label>Environment</label>
                        <span className="status-chip status-healthy">Production</span>
                    </div>
                </div>
            </div>

            {/* Providers Section */}
            <div className="glass-panel settings-section" style={{ marginTop: '1.5rem' }}>
                <div className="section-header">
                    <Cpu size={20} />
                    <h2>AI Providers</h2>
                    <button className="btn btn-outline btn-sm" onClick={addProvider} style={{ marginLeft: 'auto' }}>
                        <Plus size={14} /> Add Provider
                    </button>
                </div>

                <div className="providers-list">
                    {config.providers.map((provider: ProviderConfig, idx: number) => (
                        <div key={idx} className="provider-card">
                            <div className="provider-card-header">
                                <h3>{provider.name}</h3>
                                <button className="btn-icon text-danger" onClick={() => removeProvider(idx)}>
                                    <Trash2 size={16} />
                                </button>
                            </div>
                            <div className="provider-form-grid">
                                <div className="form-group">
                                    <label>Name</label>
                                    <input
                                        value={provider.name}
                                        onChange={(e) => handleProviderChange(idx, 'name', e.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Type</label>
                                    <select
                                        value={provider.type}
                                        onChange={(e) => handleProviderChange(idx, 'type', e.target.value as any)}
                                    >
                                        <option value="google">Google</option>
                                        <option value="openai">OpenAI</option>
                                        <option value="anthropic">Anthropic</option>
                                        <option value="custom">Custom (OpenClaw/Ollama)</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Base URL</label>
                                    <input
                                        value={provider.baseUrl || ''}
                                        onChange={(e) => handleProviderChange(idx, 'baseUrl', e.target.value)}
                                        placeholder="https://api.example.com"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>API Key</label>
                                    <div className="input-with-icon">
                                        <input
                                            type={showKeys[idx] ? 'text' : 'password'}
                                            value={provider.apiKey || ''}
                                            onChange={(e) => handleProviderChange(idx, 'apiKey', e.target.value)}
                                            placeholder="sk-..."
                                        />
                                        <button className="btn-icon" onClick={() => toggleKeyVisibility(idx)}>
                                            {showKeys[idx] ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="section-actions" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem', marginTop: '1rem' }}>
                    <button
                        className="btn btn-primary"
                        onClick={handleSaveProviders}
                        disabled={saving}
                    >
                        <Save size={16} /> Save All Providers
                    </button>
                </div>
            </div>
        </div>
    );
}
