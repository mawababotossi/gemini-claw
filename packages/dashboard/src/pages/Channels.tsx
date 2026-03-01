import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, RefreshCw, LogOut, Settings, Save, X, MessageSquare, CheckCircle2, AlertTriangle, Clock, ExternalLink, Power, Bot } from 'lucide-react';
import { api } from '../services/api';
import './Channels.css';

export function Channels() {
    const [waStatus, setWaStatus] = useState<any>(null);
    const [agents, setAgents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Config editing state
    const [showConfig, setShowConfig] = useState(false);
    const [formPhone, setFormPhone] = useState('');
    const [formAllowlist, setFormAllowlist] = useState('');
    const [formAgent, setFormAgent] = useState('main');
    const [formEnabled, setFormEnabled] = useState(false);
    const [saveStatus, setSaveStatus] = useState('');

    const fetchStatus = async () => {
        try {
            const data = await api.getWhatsAppStatus();
            setWaStatus(data);
        } catch (err) {
            console.error('Failed to fetch status', err);
        } finally {
            setLoading(false);
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

    const fetchConfig = async () => {
        try {
            const data = await api.getChannelConfig('whatsapp');
            setFormPhone(data.phoneNumber || '');
            setFormAllowlist(data.allowList ? data.allowList.join(', ') : '');
            setFormEnabled(data.enabled ?? false);
            setFormAgent(data.agent || 'main');
        } catch (err) {
            console.error('Failed to fetch config', err);
        }
    };

    useEffect(() => {
        fetchStatus();
        fetchAgents();
        fetchConfig();
        const interval = setInterval(fetchStatus, 3000); // poll every 3s
        return () => clearInterval(interval);
    }, []);

    const handleLogout = async () => {
        if (!confirm('Are you sure you want to disconnect? This will clear your WhatsApp session.')) return;
        try {
            await api.logoutWhatsApp();
            fetchStatus();
        } catch (err) {
            console.error('Logout failed', err);
            alert('Logout failed. Check console.');
        }
    };

    const handleSaveConfig = async () => {
        setSaveStatus('Saving...');
        const parsedAllowlist = formAllowlist
            .split(',')
            .map(n => n.trim())
            .filter(n => n.length > 0);

        try {
            await api.updateChannelConfig('whatsapp', {
                phoneNumber: formPhone,
                allowList: parsedAllowlist,
                enabled: formEnabled,
                agent: formAgent
            });

            setSaveStatus('Config saved! Restart server to apply changes.');
            fetchConfig();
            setTimeout(() => {
                setSaveStatus('');
                setShowConfig(false);
            }, 4000);
        } catch (err) {
            console.error('Save failed', err);
            setSaveStatus('Error saving config.');
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'connected':
                return <span className="status-badge status-connected"><CheckCircle2 size={12} /> CONNECTED</span>;
            case 'qr':
                return <span className="status-badge status-warning"><Clock size={12} /> QR READY</span>;
            case 'waiting':
                return <span className="status-badge status-warning"><Clock size={12} /> WAITING</span>;
            case 'disabled':
                return <span className="status-badge status-disabled"><Power size={12} /> DISABLED</span>;
            default:
                return <span className="status-badge status-unknown">{status?.toUpperCase() || 'UNKNOWN'}</span>;
        }
    };

    return (
        <div className="page-container channels-page">
            <div className="page-header mb-8">
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700 }}>Channels & Integrations</h1>
                    <p className="text-muted text-sm">Manage external messaging platforms like WhatsApp and Telegram.</p>
                </div>
            </div>

            <div className="glass-panel channels-list-panel">
                <div className="panel-header py-4 px-6 flex justify-between items-center bg-transparent border-b border-white/5">
                    <div>
                        <h3 className="text-lg font-bold">Active Channels</h3>
                        <span className="text-xs text-muted">Currently registered gateway adapters.</span>
                    </div>
                    <button className="btn btn-outline btn-sm" onClick={fetchStatus}>
                        <RefreshCw size={14} className="mr-2" /> Refresh Status
                    </button>
                </div>

                <div className="channels-list">
                    {/* WhatsApp Channel Row */}
                    <div className="channel-row p-6">
                        <div className="channel-row-main flex items-center justify-between">
                            <div className="flex items-center gap-6">
                                <div className="channel-icon-wrapper whatsapp p-3 rounded-lg bg-white/5 border-none">
                                    <Smartphone size={32} />
                                </div>
                                <div className="grow">
                                    <div className="flex items-center gap-3 mb-1">
                                        <h4 className="channel-name text-lg">WhatsApp Adapter</h4>
                                        {waStatus && getStatusBadge(waStatus.status)}
                                    </div>
                                    <p className="channel-desc text-muted">Persistent connection via Baileys. Handles direct and group messages.</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button className="btn btn-outline btn-sm" onClick={() => setShowConfig(!showConfig)}>
                                    <Settings size={14} className="mr-2" /> Configure
                                </button>
                                {/* Disconnect/Reset button - always show if channel is enabled (even if pairing) */}
                                {waStatus?.status !== 'disabled' && (
                                    <button className="btn btn-outline btn-sm text-danger" onClick={handleLogout}>
                                        <LogOut size={14} className="mr-2" /> {waStatus?.status === 'connected' ? 'Disconnect' : 'Reset Session'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Expandable Configuration */}
                        {showConfig && (
                            <div className="channel-expanded-config mt-6 p-6 rounded-md bg-black/30 border border-white/5 shadow-lg">
                                <div className="flex items-center justify-between mb-4">
                                    <h5 className="text-sm font-bold uppercase tracking-wider text-muted">WhatsApp Configuration</h5>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={formEnabled}
                                            onChange={(e) => setFormEnabled(e.target.checked)}
                                            style={{ width: '16px', height: '16px' }}
                                        />
                                        <span className="text-xs font-bold uppercase">Enabled</span>
                                    </label>
                                </div>

                                <div className="grid grid-cols-2 gap-6 mb-6">
                                    <div className="form-group">
                                        <label className="block text-xs font-semibold text-muted mb-2 uppercase">Host Phone Number</label>
                                        <input
                                            type="text"
                                            className="form-control-v2"
                                            value={formPhone}
                                            onChange={(e) => setFormPhone(e.target.value)}
                                            placeholder="e.g. 22898111917"
                                        />
                                        <p className="text-xs text-muted italic mt-2">The number this agent is running on.</p>
                                    </div>
                                    <div className="form-group">
                                        <label className="block text-xs font-semibold text-muted mb-2 uppercase">Allowlist (comma separated)</label>
                                        <textarea
                                            className="form-control-v2"
                                            value={formAllowlist}
                                            onChange={(e) => setFormAllowlist(e.target.value)}
                                            placeholder="e.g. 22898111917, 22565858889842"
                                            rows={2}
                                        />
                                        <p className="text-xs text-muted italic mt-2">Only these numbers can chat with the agent (leave empty for all).</p>
                                    </div>
                                    <div className="form-group">
                                        <label className="block text-xs font-semibold text-muted mb-2 uppercase">Associated Agent</label>
                                        <div className="relative flex items-center">
                                            <Bot size={16} className="absolute left-3 text-muted" />
                                            <select
                                                className="form-control-v2 pl-10"
                                                value={formAgent}
                                                onChange={(e) => setFormAgent(e.target.value)}
                                                style={{ appearance: 'none' }}
                                            >
                                                {agents.map((a: any) => (
                                                    <option key={a.name} value={a.name} style={{ background: '#1a1a1a' }}>
                                                        {a.name} ({a.model})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <p className="text-xs text-muted italic mt-2">The agent that will respond on this channel.</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <button className="btn btn-primary" onClick={handleSaveConfig}>
                                        <Save size={16} className="mr-2" /> Save Configuration
                                    </button>
                                    <button className="btn btn-outline" onClick={() => setShowConfig(false)}>
                                        <X size={16} className="mr-2" /> Cancel
                                    </button>
                                    {waStatus?.status !== 'disabled' && (
                                        <button className="btn btn-outline text-danger" onClick={handleLogout}>
                                            <LogOut size={16} className="mr-2" /> {waStatus?.status === 'connected' ? 'Disconnect' : 'Reset Session'}
                                        </button>
                                    )}
                                    {saveStatus && (
                                        <div className={`p-2 px-4 rounded-md text-xs font-bold ${saveStatus.includes('Error') ? 'bg-danger/10 text-danger border border-danger/30' : 'bg-success/10 text-success border border-success/30'}`}>
                                            {saveStatus}
                                        </div>
                                    )}
                                </div>
                                {waStatus?.status === 'qr' && (
                                    <div className="mt-4 p-3 rounded-md bg-warning/10 border border-warning/30 text-warning text-xs flex items-center gap-2">
                                        <AlertTriangle size={14} />
                                        <span>Close this configuration panel to view the QR code below.</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* QR Code Section */}
                        {waStatus?.status === 'qr' && !showConfig && (
                            <div className="channel-qr-section mt-8 p-10 rounded-lg bg-white text-black text-center max-w-sm mx-auto shadow-2xl">
                                <div className="mb-6">
                                    <h3 className="text-xl font-bold mb-2">Link with WhatsApp</h3>
                                    <p className="text-sm text-gray-500">Scan this code with your mobile device under "Linked Devices".</p>
                                </div>
                                <div className="qr-wrapper bg-white p-4 inline-block rounded-lg shadow-inner border border-gray-100">
                                    <QRCodeSVG value={waStatus.qr} size={220} />
                                </div>
                                <div className="mt-8 flex flex-col gap-3">
                                    <button className="btn btn-primary btn-block py-3" onClick={fetchStatus}>
                                        <RefreshCw size={18} className="mr-2" /> Refresh QR Code
                                    </button>
                                    <p className="text-xs text-gray-400 italic flex items-center justify-center gap-2">
                                        <Clock size={12} /> Waiting for pairing...
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Status Messages for Disabled */}
                        {!loading && waStatus?.status === 'disabled' && !showConfig && (
                            <div className="channel-status-alert mt-6 p-4 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-center gap-3">
                                <AlertTriangle size={20} className="shrink-0" />
                                <div>
                                    <p className="font-bold">WhatsApp Channel Disabled</p>
                                    <p className="text-xs opacity-80">Enable it in the settings toggle to use this channel. Restart required.</p>
                                </div>
                                <button className="btn btn-outline btn-sm ml-auto bg-danger/10 border-danger/20" onClick={() => setShowConfig(true)}>
                                    Enable Now
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Telegram Placeholder (Coming Soon) */}
                    <div className="channel-row p-6 opacity-40 grayscale transition-all hover:grayscale-0 hover:opacity-100">
                        <div className="channel-row-main flex items-center justify-between">
                            <div className="flex items-center gap-6">
                                <div className="channel-icon-wrapper telegram p-3 rounded-lg">
                                    <MessageSquare size={32} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <h4 className="channel-name text-lg">Telegram Adapter</h4>
                                        <span className="status-badge status-disabled">COMING SOON</span>
                                    </div>
                                    <p className="channel-desc text-muted">Official Bot API integration. Support for groups and inline mode.</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button className="btn btn-outline btn-sm disabled" disabled title="Coming Soon">
                                    <Settings size={14} className="mr-2" /> Configure
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="channels-footer mt-12 p-8 glass-panel flex items-center gap-6 border border-white/5">
                <div className="p-4 bg-primary/10 rounded-full text-primary shadow-lg shadow-primary/20">
                    <ExternalLink size={28} />
                </div>
                <div className="grow">
                    <h4 className="text-lg font-bold mb-1">Custom Channel Development</h4>
                    <p className="text-muted text-sm max-w-2xl">Want to reach your users on Slack, Discord, or Email? Our modular architecture allows you to build custom adapters in minutes. Check out our comprehensive documentation.</p>
                </div>
                <button className="btn btn-outline px-6">Documentation</button>
            </div>
        </div>
    );
}
