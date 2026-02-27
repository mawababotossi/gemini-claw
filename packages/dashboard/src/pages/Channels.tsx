import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, RefreshCw, LogOut, Settings, Save, X } from 'lucide-react';
import './Channels.css';

export function Channels() {
    const [waStatus, setWaStatus] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // Config editing state
    const [showConfig, setShowConfig] = useState(false);
    const [configData, setConfigData] = useState<any>(null);
    const [formPhone, setFormPhone] = useState('');
    const [formAllowlist, setFormAllowlist] = useState('');
    const [saveStatus, setSaveStatus] = useState('');

    const fetchStatus = async () => {
        try {
            const res = await fetch(`http://${window.location.hostname}:3002/api/channels/whatsapp/status`);
            const data = await res.json();
            setWaStatus(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const fetchConfig = async () => {
        try {
            const res = await fetch(`http://${window.location.hostname}:3002/api/channels/whatsapp`);
            if (res.ok) {
                const data = await res.json();
                setConfigData(data);
                setFormPhone(data.phoneNumber || '');
                setFormAllowlist(data.allowList ? data.allowList.join(', ') : '');
            }
        } catch (err) {
            console.error('Failed to fetch config', err);
        }
    };

    useEffect(() => {
        fetchStatus();
        fetchConfig();
        const interval = setInterval(fetchStatus, 3000); // poll every 3s
        return () => clearInterval(interval);
    }, []);

    const handleLogout = async () => {
        try {
            await fetch(`http://${window.location.hostname}:3002/api/channels/whatsapp/logout`, { method: 'POST' });
            fetchStatus();
        } catch (err) {
            console.error(err);
        }
    };

    const handleSaveConfig = async () => {
        setSaveStatus('Saving...');
        // parse allowList (split by comma, trim whitespace, remove empty)
        const parsedAllowlist = formAllowlist
            .split(',')
            .map(n => n.trim())
            .filter(n => n.length > 0);

        try {
            const res = await fetch(`http://${window.location.hostname}:3002/api/channels/whatsapp`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phoneNumber: formPhone,
                    allowList: parsedAllowlist
                })
            });

            if (res.ok) {
                setSaveStatus('Config saved successfully! Restart server to apply.');
                fetchConfig();
                setTimeout(() => {
                    setSaveStatus('');
                    setShowConfig(false);
                }, 3000);
            } else {
                setSaveStatus('Error saving config.');
            }
        } catch (err) {
            console.error(err);
            setSaveStatus('Network error.');
        }
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <h1>Channels & Integrations</h1>
                <p>Manage external messaging platforms like WhatsApp and Telegram.</p>
            </div>

            <div className="channels-grid">
                <div className="glass-panel channel-card">
                    <div className="channel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <Smartphone size={24} className="text-success" />
                            <h3 style={{ margin: 0 }}>WhatsApp Adapter</h3>
                        </div>
                        <button
                            className="btn btn-icon"
                            title="Configure WhatsApp"
                            onClick={() => setShowConfig(!showConfig)}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                        >
                            <Settings size={20} />
                        </button>
                    </div>

                    {showConfig && configData ? (
                        <div className="channel-config-form" style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(0,0,0,0.1)', borderRadius: '8px' }}>
                            <h4 style={{ marginTop: 0, marginBottom: '1rem' }}>WhatsApp Configuration</h4>

                            <div className="form-group" style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Host Phone Number</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={formPhone}
                                    onChange={(e) => setFormPhone(e.target.value)}
                                    placeholder="e.g. 22898111917"
                                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                                />
                                <small style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>The number this agent is running on.</small>
                            </div>

                            <div className="form-group" style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Allowlist (comma separated)</label>
                                <textarea
                                    className="form-control"
                                    value={formAllowlist}
                                    onChange={(e) => setFormAllowlist(e.target.value)}
                                    placeholder="e.g. 22898111917, 22565858889842"
                                    rows={3}
                                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white', resize: 'vertical' }}
                                />
                                <small style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>Only these numbers can chat with the agent.</small>
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1rem' }}>
                                <button className="btn btn-primary" onClick={handleSaveConfig} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <Save size={16} /> Save Configuration
                                </button>
                                <button className="btn btn-outline" onClick={() => setShowConfig(false)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <X size={16} /> Cancel
                                </button>
                                {saveStatus && <span style={{ fontSize: '0.9rem', color: saveStatus.includes('Error') ? 'var(--error)' : 'var(--success)' }}>{saveStatus}</span>}
                            </div>
                        </div>
                    ) : (
                        <div className="channel-content" style={{ marginTop: '1rem' }}>
                            {loading ? (
                                <p>Loading status...</p>
                            ) : waStatus?.status === 'disabled' ? (
                                <p>WhatsApp channel is not enabled in backend config. Please enable it in <br /><code>geminiclaw.json</code>.</p>
                            ) : waStatus?.status === 'connected' ? (
                                <div className="status-connected">
                                    <p className="text-success" style={{ marginBottom: "1rem" }}>✅ Connected and Active</p>
                                    <button className="btn btn-outline" onClick={handleLogout}>
                                        <LogOut size={16} style={{ display: "inline-block", marginRight: "0.5rem", verticalAlign: "middle" }} />
                                        <span style={{ verticalAlign: "middle" }}>Disconnect Session</span>
                                    </button>
                                </div>
                            ) : waStatus?.status === 'qr' && waStatus?.qr ? (
                                <div className="qr-container">
                                    <p>Scan this QR Code with your mobile WhatsApp to link devices.</p>
                                    <div className="qr-box">
                                        <QRCodeSVG value={waStatus.qr} size={256} />
                                    </div>
                                    <button className="btn btn-primary mt-4" onClick={fetchStatus}>
                                        <RefreshCw size={16} style={{ display: "inline-block", marginRight: "0.5rem", verticalAlign: "middle" }} />
                                        <span style={{ verticalAlign: "middle" }}>Refresh QR</span>
                                    </button>
                                </div>
                            ) : (
                                <div className="status-waiting">
                                    <p>Status: {waStatus?.status || 'Unknown'}</p>
                                    <p className="text-secondary" style={{ marginBottom: "1rem" }}>Waiting for connection...</p>
                                    <button className="btn btn-outline mt-4" onClick={handleLogout}>
                                        Force Reset
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
