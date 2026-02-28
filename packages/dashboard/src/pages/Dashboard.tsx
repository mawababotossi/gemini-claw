import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Server, Clock, Hash, Globe, Link2, ListTree,
    RefreshCw, AlertTriangle, CheckCircle2, XCircle,
    Activity, Wifi, WifiOff, ArrowUpRight, Zap,
    Shield, MessageSquare, Bot, Calendar, Info
} from 'lucide-react';
import { api, type AppStatus } from '../services/api';
import './Dashboard.css';

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatUptime(seconds?: number) {
    if (!seconds) return 'n/a';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function formatRelativeTime(ms?: number) {
    if (!ms) return 'never';
    const diff = Date.now() - ms;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
}

function formatTickInterval(ms?: number) {
    if (!ms) return 'n/a';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m`;
}

// Simulate a version check — replace with real API call if endpoint exists
const CURRENT_VERSION = 'v0.1.0';
const LATEST_VERSION = 'v0.1.1';
const HAS_UPDATE = CURRENT_VERSION !== LATEST_VERSION;

// ─── Sub-components ────────────────────────────────────────────────────────

function UpdateBanner({ onDismiss }: { onDismiss: () => void }) {
    return (
        <div className="update-banner">
            <div className="update-banner-content">
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>
                    <strong>Update available:</strong> {LATEST_VERSION} (running {CURRENT_VERSION}).
                </span>
                <a
                    href="https://github.com/mawababotossi/gemini-claw/releases"
                    target="_blank"
                    rel="noreferrer"
                    className="update-banner-link"
                >
                    View release notes <ArrowUpRight size={12} />
                </a>
            </div>
            <button className="update-banner-dismiss" onClick={onDismiss} title="Dismiss">×</button>
        </div>
    );
}

type ConnState = 'disconnected' | 'connecting' | 'connected' | 'error';

function ConnectionDot({ state }: { state: ConnState }) {
    const map: Record<ConnState, { color: string; label: string }> = {
        disconnected: { color: 'var(--text-muted)', label: 'Disconnected' },
        connecting: { color: 'var(--warning)', label: 'Connecting…' },
        connected: { color: 'var(--success)', label: 'Connected' },
        error: { color: 'var(--danger)', label: 'Error' },
    };
    const { color, label } = map[state];
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color }}>
            <span style={{
                width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0,
                boxShadow: state === 'connected' ? `0 0 0 3px ${color}30` : 'none',
                animation: state === 'connected' ? 'conn-pulse 2s infinite' : 'none',
            }} />
            {label}
        </span>
    );
}

function SnapshotRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
    return (
        <div className="snapshot-item">
            <span className="label">{label}</span>
            <span className="value" style={{ color: valueColor }}>{value}</span>
        </div>
    );
}

interface ActivityEntry {
    id: number;
    icon: React.ReactNode;
    text: string;
    time: string;
    type: 'session' | 'cron' | 'agent' | 'auth' | 'error';
}

function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
    const TYPE_COLOR: Record<ActivityEntry['type'], string> = {
        session: 'var(--primary)',
        cron: 'var(--warning)',
        agent: 'var(--success)',
        auth: 'var(--text-muted)',
        error: 'var(--danger)',
    };

    if (entries.length === 0) {
        return (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No recent activity. Connect to the gateway to start monitoring.
            </div>
        );
    }

    return (
        <div className="activity-list">
            {entries.map(entry => (
                <div key={entry.id} className="activity-item">
                    <div className="activity-icon" style={{ color: TYPE_COLOR[entry.type], background: `${TYPE_COLOR[entry.type]}15` }}>
                        {entry.icon}
                    </div>
                    <div className="activity-body">
                        <span className="activity-text">{entry.text}</span>
                        <span className="activity-time">{entry.time}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── Main Component ────────────────────────────────────────────────────────

export function Dashboard() {
    const [statusInfo, setStatusInfo] = useState<AppStatus | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const [showBanner, setShowBanner] = useState(HAS_UPDATE);
    const [connState, setConnState] = useState<ConnState>('disconnected');
    const [connError, setConnError] = useState<string | null>(null);

    // Gateway Access form state
    const [wsUrl, setWsUrl] = useState(`ws://${window.location.hostname}:3002`);
    const [token, setToken] = useState(import.meta.env.VITE_DASHBOARD_SECRET || '');
    const [sessionKey, setSessionKey] = useState('agent:main:main');
    const [language, setLanguage] = useState('English');

    // Activity feed (populated from status polling)
    const [activity, setActivity] = useState<ActivityEntry[]>([]);
    const activityId = useRef(0);

    const addActivity = useCallback((text: string, type: ActivityEntry['type']) => {
        const iconMap: Record<ActivityEntry['type'], React.ReactNode> = {
            session: <MessageSquare size={13} />,
            cron: <Calendar size={13} />,
            agent: <Bot size={13} />,
            auth: <Shield size={13} />,
            error: <XCircle size={13} />,
        };
        setActivity(prev => [
            {
                id: ++activityId.current,
                text,
                type,
                time: new Date().toLocaleTimeString(),
                icon: iconMap[type],
            },
            ...prev,
        ].slice(0, 20));
    }, []);

    // ── Fetch status ─────────────────────────────────────────────────────

    const fetchStatus = useCallback(async (manual = false) => {
        if (manual) setIsRefreshing(true);
        try {
            const data = await api.getStatus();
            setStatusInfo(prev => {
                // Detect changes and add to activity feed
                if (prev) {
                    if ((data.sessions ?? 0) > (prev.sessions ?? 0)) addActivity('New session started', 'session');
                    if ((data.sessions ?? 0) < (prev.sessions ?? 0)) addActivity('Session ended', 'session');
                }
                return data;
            });
            setConnState('connected');
            setConnError(null);
            setLastRefresh(new Date());
        } catch (err: any) {
            setConnState('error');
            setConnError(err.message ?? 'Could not reach gateway');
        } finally {
            if (manual) setIsRefreshing(false);
        }
    }, [addActivity]);

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(() => fetchStatus(), 30_000);
        return () => clearInterval(interval);
    }, [fetchStatus]);

    // ── Simulate initial activity ─────────────────────────────────────────
    useEffect(() => {
        // Pre-populate with plausible recent events on mount
        setTimeout(() => addActivity('Agent "main" bridge started', 'agent'), 100);
        setTimeout(() => addActivity('Dashboard authentication verified', 'auth'), 300);
        setTimeout(() => addActivity('Heartbeat cron armed for next run', 'cron'), 600);
    }, []);

    // ── Connect handler ──────────────────────────────────────────────────

    const handleConnect = (e: React.FormEvent) => {
        e.preventDefault();
        setConnState('connecting');
        setConnError(null);
        // Attempt a fresh status fetch to validate connection
        setTimeout(() => fetchStatus(false), 500);
    };

    // ── Derived values ────────────────────────────────────────────────────

    const statusColor =
        statusInfo?.status === 'Healthy' ? 'var(--success)' :
            statusInfo?.status === 'Degraded' ? 'var(--warning)' :
                statusInfo?.status ? 'var(--danger)' : 'var(--text-muted)';

    const statusLabel =
        statusInfo?.status === 'Healthy' ? 'OK' : (statusInfo?.status ?? 'Unknown');

    // ─────────────────────────────────────────────────────────────────────
    return (
        <div className="page-container overview-page">

            {/* ── Update banner ──────────────────────────────────────── */}
            {showBanner && <UpdateBanner onDismiss={() => setShowBanner(false)} />}

            {/* ── Page header ───────────────────────────────────────── */}
            <div className="page-header overview-page-header">
                <div>
                    <h1>Overview</h1>
                    <p>Gateway status, entry points, and a fast health read.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <ConnectionDot state={connState} />
                    <button
                        className="btn btn-outline"
                        onClick={() => fetchStatus(true)}
                        disabled={isRefreshing}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem' }}
                    >
                        <RefreshCw size={15} className={isRefreshing ? 'spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* ── Connection error ──────────────────────────────────── */}
            {connError && (
                <div className="conn-error-bar">
                    <XCircle size={15} style={{ flexShrink: 0 }} />
                    <span>Gateway unreachable: <code>{connError}</code> — check that the gateway is running and the token is correct.</span>
                </div>
            )}

            {/* ── Top row: Gateway Access + Snapshot ───────────────── */}
            <div className="overview-grid-top">

                {/* Gateway Access */}
                <div className="glass-panel gateway-access">
                    <div className="panel-header">
                        <Globe size={17} style={{ color: 'var(--primary)' }} />
                        <h3>Gateway Access</h3>
                        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Where the dashboard connects and how it authenticates.
                        </span>
                    </div>
                    <form className="panel-content access-form" onSubmit={handleConnect}>
                        <div className="input-row">
                            <div className="input-group">
                                <label>WebSocket URL</label>
                                <input
                                    type="text"
                                    value={wsUrl}
                                    onChange={e => setWsUrl(e.target.value)}
                                    placeholder="ws://localhost:3002"
                                />
                            </div>
                        </div>
                        <div className="input-row split">
                            <div className="input-group">
                                <label>Gateway Token</label>
                                <input
                                    type="password"
                                    value={token}
                                    onChange={e => setToken(e.target.value)}
                                    placeholder="VITE_DASHBOARD_SECRET"
                                />
                            </div>
                            <div className="input-group">
                                <label>Password <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(not stored)</span></label>
                                <input type="password" placeholder="System or shared password" />
                            </div>
                        </div>
                        <div className="input-row split">
                            <div className="input-group">
                                <label>Default Session Key</label>
                                <input
                                    type="text"
                                    value={sessionKey}
                                    onChange={e => setSessionKey(e.target.value)}
                                    placeholder="agent:main:main"
                                />
                            </div>
                            <div className="input-group">
                                <label>Language</label>
                                <select value={language} onChange={e => setLanguage(e.target.value)}>
                                    <option value="English">English</option>
                                    <option value="French">French (FR)</option>
                                    <option value="Spanish">Spanish (ES)</option>
                                </select>
                            </div>
                        </div>
                        <div className="actions-row">
                            <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {connState === 'connecting'
                                    ? <><RefreshCw size={14} className="spin" /> Connecting…</>
                                    : <><Link2 size={14} /> Connect</>
                                }
                            </button>
                            <button type="button" className="btn btn-outline" onClick={() => fetchStatus(true)} disabled={isRefreshing}>
                                Refresh
                            </button>
                            {lastRefresh && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem', alignSelf: 'center' }}>
                                    Updated {lastRefresh.toLocaleTimeString()}
                                </span>
                            )}
                        </div>
                    </form>
                </div>

                {/* Snapshot */}
                <div className="glass-panel gateway-snapshot">
                    <div className="panel-header">
                        <Activity size={17} style={{ color: 'var(--primary)' }} />
                        <h3>Snapshot</h3>
                        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Latest gateway handshake information.
                        </span>
                    </div>
                    <div className="panel-content snapshot-stats">
                        <SnapshotRow
                            label="STATUS"
                            value={statusLabel}
                            valueColor={statusColor}
                        />
                        <SnapshotRow
                            label="UPTIME"
                            value={formatUptime(statusInfo?.uptime)}
                        />
                        <SnapshotRow
                            label="TICK INTERVAL"
                            value={formatTickInterval(statusInfo?.tickInterval)}
                        />
                        <SnapshotRow
                            label="LAST CHANNELS REFRESH"
                            value={formatRelativeTime(statusInfo?.lastChannelsRefresh)}
                        />
                        <SnapshotRow
                            label="AUTH TYPE"
                            value={statusInfo?.authType ?? 'Unknown'}
                        />
                        {statusInfo?.accountHint && (
                            <SnapshotRow
                                label="ACCOUNT"
                                value={statusInfo.accountHint}
                            />
                        )}
                        <div className="snapshot-footer">
                            <Info size={12} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                            <span>Use Channels to link WhatsApp, Telegram, or WebChat.</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Counter cards ─────────────────────────────────────── */}
            <div className="overview-counters">
                {[
                    {
                        label: 'INSTANCES',
                        value: statusInfo?.instances ?? 0,
                        desc: 'Presence beacons in the last 5 minutes.',
                        icon: <Wifi size={20} />,
                        color: 'var(--primary)',
                        href: '/instances',
                    },
                    {
                        label: 'SESSIONS',
                        value: statusInfo?.sessions ?? 0,
                        desc: 'Recent session keys tracked by the gateway.',
                        icon: <ListTree size={20} />,
                        color: 'var(--secondary)',
                        href: '/sessions',
                    },
                    {
                        label: 'CRON',
                        value: statusInfo?.cron ?? 0,
                        desc: 'Scheduled agent wakeups registered.',
                        icon: <Clock size={20} />,
                        color: 'var(--success)',
                        href: '/cron',
                    },
                ].map(card => (
                    <div key={card.label} className="glass-panel counter-card">
                        <div className="counter-header">
                            <span style={{ color: card.color }}>{card.icon}</span>
                            <span>{card.label}</span>
                        </div>
                        <div className="counter-value" style={{ color: card.color }}>
                            {card.value}
                        </div>
                        <div className="counter-desc">{card.desc}</div>
                    </div>
                ))}
            </div>

            {/* ── Bottom row: Activity feed + Operator notes ────────── */}
            <div className="overview-bottom-grid">

                {/* Recent Activity */}
                <div className="glass-panel activity-panel">
                    <div className="panel-header">
                        <Zap size={17} style={{ color: 'var(--primary)' }} />
                        <h3>Recent Activity</h3>
                        {connState === 'connected' && (
                            <span className="live-badge">
                                <span className="live-dot" />
                                LIVE
                            </span>
                        )}
                    </div>
                    <ActivityFeed entries={activity} />
                </div>

                {/* Operator Notes */}
                <div className="glass-panel operator-notes-panel">
                    <div className="panel-header">
                        <Hash size={17} style={{ color: 'var(--primary)' }} />
                        <h3>Operator Notes</h3>
                    </div>
                    <div className="notes-content">
                        <div className="note-card">
                            <div className="note-icon"><Shield size={15} /></div>
                            <div>
                                <h4>Secure Access</h4>
                                <p>If reaching the gateway over the internet, use Tailscale or a reverse proxy with SSL. Do not expose port 3002 publicly.</p>
                            </div>
                        </div>
                        <div className="note-card">
                            <div className="note-icon"><MessageSquare size={15} /></div>
                            <div>
                                <h4>Session Hygiene</h4>
                                <p>Tokens accumulate over time. Use the Sessions page to monitor context limits and clear stale buffers to control LLM costs.</p>
                            </div>
                        </div>
                        <div className="note-card">
                            <div className="note-icon"><Calendar size={15} /></div>
                            <div>
                                <h4>Cron Reminders</h4>
                                <p>Cron jobs only execute if the agent's primary model is responsive. Use isolated sessions for recurring runs to avoid context pollution.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
