import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, LogOut, Settings, Save, X, MessageSquare, CheckCircle2, Clock, ExternalLink, Power, Bot, Hash, Send, Globe } from 'lucide-react';
import { api } from '../services/api';
import './Channels.css';

export function Channels() {
    const [waStatus, setWaStatus] = useState<any>(null);
    const [agents, setAgents] = useState<any[]>([]);
    const [activeChannel, setActiveChannel] = useState<string | null>(null);
    const [configs, setConfigs] = useState<Record<string, any>>({});
    const [saveStatus, setSaveStatus] = useState('');

    const fetchStatus = async () => {
        try {
            const data = await api.getWhatsAppStatus();
            setWaStatus(data);
        } catch (err) {
            console.error('Failed to fetch status', err);
        }
    };

    const fetchAgents = async () => {
        try {
            const data = await api.getAgents();
            setAgents(data);
        } catch (err) {
            console.error('Failed to fetch agents', err);
        }
    };

    const fetchConfig = async (name: string) => {
        try {
            const data = await api.getChannelConfig(name);
            setConfigs(prev => ({ ...prev, [name]: data }));
        } catch (err) {
            console.error(`Failed to fetch config for ${name}`, err);
        }
    };

    useEffect(() => {
        fetchStatus();
        fetchAgents();
        ['whatsapp', 'telegram', 'discord', 'slack', 'webchat'].forEach(fetchConfig);
        const interval = setInterval(fetchStatus, 3000);
        return () => clearInterval(interval);
    }, []);

    const handleSaveConfig = async (name: string) => {
        setSaveStatus(`Saving ${name}...`);
        try {
            const config = configs[name];
            // Format arrays if needed (allowlist, discord channels)
            if (typeof config.allowList === 'string') {
                config.allowList = config.allowList.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
            }
            if (typeof config.channels === 'string') {
                config.channels = config.channels.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
            }

            await api.updateChannelConfig(name, config);
            setSaveStatus('Config saved! Restart server to apply.');
            fetchConfig(name);
            setTimeout(() => {
                setSaveStatus('');
                setActiveChannel(null);
            }, 4000);
        } catch (err) {
            console.error('Save failed', err);
            setSaveStatus('Error saving config.');
        }
    };

    const handleLogoutWA = async () => {
        if (!confirm('Are you sure you want to disconnect? This will clear your WhatsApp session.')) return;
        try {
            await api.logoutWhatsApp();
            fetchStatus();
        } catch (err) {
            console.error('Logout failed', err);
        }
    };

    const getStatusBadge = (name: string, status?: string) => {
        if (name === 'whatsapp') {
            switch (status) {
                case 'connected': return <span className="status-badge status-connected"><CheckCircle2 size={12} /> CONNECTED</span>;
                case 'qr': return <span className="status-badge status-warning"><Clock size={12} /> QR READY</span>;
                case 'waiting': return <span className="status-badge status-warning"><Clock size={12} /> WAITING</span>;
                case 'disabled': return <span className="status-badge status-disabled"><Power size={12} /> DISABLED</span>;
                default: return <span className="status-badge status-unknown">{status?.toUpperCase() || 'UNKNOWN'}</span>;
            }
        }
        const isEnabled = configs[name]?.enabled;
        return isEnabled
            ? <span className="status-badge status-connected"><CheckCircle2 size={12} /> ENABLED</span>
            : <span className="status-badge status-disabled"><Power size={12} /> DISABLED</span>;
    };

    const updateField = (channel: string, field: string, value: any) => {
        setConfigs(prev => ({
            ...prev,
            [channel]: { ...prev[channel], [field]: value }
        }));
    };

    const channels = [
        { id: 'webchat', name: 'WebChat', icon: <Globe size={32} />, desc: 'Built-in web chat interface served on a configurable port.' },
        { id: 'whatsapp', name: 'WhatsApp Adapter', icon: <Smartphone size={32} />, desc: 'Persistent connection via Baileys. Handles direct and group messages.' },
        { id: 'telegram', name: 'Telegram Adapter', icon: <Send size={32} />, desc: 'Official Bot API integration. Support for groups and inline mode.' },
        { id: 'discord', name: 'Discord Adapter', icon: <Hash size={32} />, desc: 'Discord.js integration. Monitor specific channels or DMs.' },
        { id: 'slack', name: 'Slack Adapter', icon: <MessageSquare size={32} />, desc: 'Slack Bolt integration with Socket Mode support.' },
    ];

    return (
        <div className="page-container channels-page">
            <div className="page-header mb-8">
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700 }}>Channels & Integrations</h1>
                    <p className="text-muted text-sm">Manage external messaging platforms like WhatsApp, Telegram, Discord, and Slack.</p>
                </div>
            </div>

            <div className="glass-panel channels-list-panel">
                <div className="panel-header py-4 px-6 flex justify-between items-center bg-transparent border-b border-white/5">
                    <div>
                        <h3 className="text-lg font-bold">Active Channels</h3>
                        <span className="text-xs text-muted">Currently registered gateway adapters.</span>
                    </div>
                </div>

                <div className="channels-list">
                    {channels.map(chan => {
                        const isExpanded = activeChannel === chan.id;
                        const config = configs[chan.id] || {};

                        return (
                            <div key={chan.id} className="channel-row p-6">
                                <div className="channel-row-main flex items-center justify-between">
                                    <div className="flex items-center gap-6">
                                        <div className={`channel-icon-wrapper ${chan.id} p-3 rounded-lg`}>
                                            {chan.icon}
                                        </div>
                                        <div className="grow">
                                            <div className="flex items-center gap-3 mb-1">
                                                <h4 className="channel-name text-lg">{chan.name}</h4>
                                                {getStatusBadge(chan.id, chan.id === 'whatsapp' ? waStatus?.status : undefined)}
                                            </div>
                                            <p className="channel-desc text-muted">{chan.desc}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button className="btn btn-outline btn-sm" onClick={() => setActiveChannel(isExpanded ? null : chan.id)}>
                                            <Settings size={14} className="mr-2" /> Configure
                                        </button>
                                        {chan.id === 'whatsapp' && waStatus?.status !== 'disabled' && (
                                            <button className="btn btn-outline btn-sm text-danger" onClick={handleLogoutWA}>
                                                <LogOut size={14} className="mr-2" /> {waStatus?.status === 'connected' ? 'Disconnect' : 'Reset Session'}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="channel-expanded-config mt-6 p-6 rounded-md bg-black/30 border border-white/5 shadow-lg">
                                        <div className="flex items-center justify-between mb-4">
                                            <h5 className="text-sm font-bold uppercase tracking-wider text-muted">{chan.name} Configuration</h5>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={!!config.enabled}
                                                    onChange={(e) => updateField(chan.id, 'enabled', e.target.checked)}
                                                    style={{ width: '16px', height: '16px' }}
                                                />
                                                <span className="text-xs font-bold uppercase">Enabled</span>
                                            </label>
                                        </div>

                                        <div className="grid grid-cols-2 gap-6 mb-6">
                                            <div className="form-group">
                                                <label className="block text-xs font-semibold text-muted mb-2 uppercase">Associated Agent</label>
                                                <div className="relative flex items-center">
                                                    <Bot size={16} className="absolute left-3 text-muted" />
                                                    <select
                                                        className="form-control-v2 pl-10"
                                                        value={config.agent || 'main'}
                                                        onChange={(e) => updateField(chan.id, 'agent', e.target.value)}
                                                        style={{ appearance: 'none' }}
                                                    >
                                                        {agents.map((a: any) => (
                                                            <option key={a.name} value={a.name} style={{ background: '#1a1a1a' }}>
                                                                {a.name} ({a.model})
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>

                                            {chan.id === 'webchat' && (
                                                <div className="form-group">
                                                    <label className="block text-xs font-semibold text-muted mb-2 uppercase">Port</label>
                                                    <input
                                                        type="number" className="form-control-v2"
                                                        value={config.port || 3001}
                                                        onChange={(e) => updateField(chan.id, 'port', parseInt(e.target.value, 10))}
                                                        placeholder="3001"
                                                    />
                                                    <p className="text-xs text-muted mt-1">Port on which the WebChat HTTP server listens.</p>
                                                </div>
                                            )}

                                            {chan.id === 'whatsapp' && (
                                                <>
                                                    <div className="form-group">
                                                        <label className="block text-xs font-semibold text-muted mb-2 uppercase">Phone Number</label>
                                                        <input
                                                            type="text" className="form-control-v2"
                                                            value={config.phoneNumber || ''}
                                                            onChange={(e) => updateField(chan.id, 'phoneNumber', e.target.value)}
                                                            placeholder="e.g. 22898111917"
                                                        />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="block text-xs font-semibold text-muted mb-2 uppercase">Allowlist</label>
                                                        <input
                                                            type="text" className="form-control-v2"
                                                            value={Array.isArray(config.allowList) ? config.allowList.join(', ') : config.allowList || ''}
                                                            onChange={(e) => updateField(chan.id, 'allowList', e.target.value)}
                                                            placeholder="Comma separated"
                                                        />
                                                    </div>
                                                </>
                                            )}

                                            {chan.id === 'telegram' && (
                                                <div className="form-group">
                                                    <label className="block text-xs font-semibold text-muted mb-2 uppercase">Bot Token</label>
                                                    <input
                                                        type="password" className="form-control-v2"
                                                        value={config.token || ''}
                                                        onChange={(e) => updateField(chan.id, 'token', e.target.value)}
                                                        placeholder="xoxb-..."
                                                    />
                                                    <p className="text-xs text-muted mt-1">Can also be set via TELEGRAM_BOT_TOKEN env var.</p>
                                                </div>
                                            )}

                                            {chan.id === 'discord' && (
                                                <div className="form-group">
                                                    <label className="block text-xs font-semibold text-muted mb-2 uppercase">Allowed Channels</label>
                                                    <input
                                                        type="text" className="form-control-v2"
                                                        value={Array.isArray(config.channels) ? config.channels.join(', ') : config.channels || ''}
                                                        onChange={(e) => updateField(chan.id, 'channels', e.target.value)}
                                                        placeholder="IDs or Names"
                                                    />
                                                </div>
                                            )}

                                            {chan.id === 'slack' && (
                                                <div className="form-group">
                                                    <label className="block text-xs font-semibold text-muted mb-2 uppercase">Signing Secret</label>
                                                    <input
                                                        type="password" className="form-control-v2"
                                                        value={config.signingSecret || ''}
                                                        onChange={(e) => updateField(chan.id, 'signingSecret', e.target.value)}
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-4">
                                            <button className="btn btn-primary" onClick={() => handleSaveConfig(chan.id)}>
                                                <Save size={16} className="mr-2" /> Save Changes
                                            </button>
                                            <button className="btn btn-outline" onClick={() => setActiveChannel(null)}>
                                                <X size={16} className="mr-2" /> Cancel
                                            </button>
                                            {saveStatus && (
                                                <div className={`p-2 px-4 rounded-md text-xs font-bold ${saveStatus.includes('Error') ? 'bg-danger/10 text-danger border border-danger/30' : 'bg-success/10 text-success border border-success/30'}`}>
                                                    {saveStatus}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {chan.id === 'whatsapp' && waStatus?.status === 'qr' && !isExpanded && (
                                    <div className="channel-qr-section mt-8 p-10 rounded-lg bg-white text-black text-center max-w-sm mx-auto">
                                        <div className="mb-6">
                                            <h3 className="text-xl font-bold mb-2">Link with WhatsApp</h3>
                                            <p className="text-sm text-gray-500">Scan this code with your mobile device.</p>
                                        </div>
                                        <div className="qr-wrapper bg-white p-4 inline-block rounded-lg shadow-inner">
                                            <QRCodeSVG value={waStatus.qr} size={220} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="channels-footer mt-12 p-8 glass-panel flex items-center gap-6 border border-white/5">
                <div className="p-4 bg-primary/10 rounded-full text-primary shadow-lg shadow-primary/20">
                    <ExternalLink size={28} />
                </div>
                <div className="grow">
                    <h4 className="text-lg font-bold mb-1">Custom Channel Development</h4>
                    <p className="text-muted text-sm max-w-2xl">Want to reach your users on other platforms? Our modular architecture allows you to build custom adapters in minutes.</p>
                </div>
                <button className="btn btn-outline px-6">Documentation</button>
            </div>
        </div>
    );
}
