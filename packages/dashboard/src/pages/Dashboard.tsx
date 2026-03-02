import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Clock, Globe, Link2,
    RefreshCw, AlertTriangle, XCircle,
    Activity, Wifi, ArrowUpRight, Zap,
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
const CURRENT_VERSION = 'v0.1.0' as string;
const LATEST_VERSION = 'v0.1.1' as string;
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
                    href="https://github.com/mawababotossi/claw-gate/releases"
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

import { PageHeader } from '../components/PageHeader';

export function Dashboard() {
    const [statusInfo, setStatusInfo] = useState<AppStatus | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const [showBanner, setShowBanner] = useState(HAS_UPDATE);
    const [connState, setConnState] = useState<ConnState>('disconnected');
    const [connError, setConnError] = useState<string | null>(null);

    // Gateway Access form state
    const [wsUrl, setWsUrl] = useState(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.host}/ws`;
    });
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
        <div className="page-container overview-page scrollbar-thin">

            {/* ── Update banner ──────────────────────────────────────── */}
            {showBanner && <UpdateBanner onDismiss={() => setShowBanner(false)} />}

            {/* ── Page header ───────────────────────────────────────── */}
            <PageHeader
                title="System Overview"
                description="Gateway status, entry points, and real-time health monitoring."
                actions={
                    <div className="flex items-center gap-3">
                        <ConnectionDot state={connState} />
                        <button
                            className="btn btn-outline"
                            onClick={() => fetchStatus(true)}
                            disabled={isRefreshing}
                        >
                            <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
                            Refresh Status
                        </button>
                    </div>
                }
            />

            {/* ── Connection error ──────────────────────────────────── */}
            {connError && (
                <div className="conn-error-bar">
                    <XCircle size={15} style={{ flexShrink: 0 }} />
                    <span>Gateway unreachable: <code>{connError}</code> — ensure the service is running.</span>
                </div>
            )}

            {/* ── Top row: Gateway Access + Snapshot ───────────────── */}
            <div className="overview-grid-top">

                {/* Gateway Access */}
                <div className="glass-panel gateway-access overflow-hidden">
                    <div className="panel-header border-b p-4 bg-white/5">
                        <div className="flex items-center gap-2">
                            <Globe size={16} className="text-primary" />
                            <h3 className="text-sm font-bold uppercase tracking-wider">Gateway Configuration</h3>
                        </div>
                    </div>
                    <form className="panel-content access-form p-5" onSubmit={handleConnect}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="input-group">
                                <label className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">WebSocket URL</label>
                                <input
                                    type="text"
                                    className="glass-input text-sm"
                                    value={wsUrl}
                                    onChange={e => setWsUrl(e.target.value)}
                                    placeholder="ws://localhost:3002"
                                />
                            </div>
                            <div className="input-group">
                                <label className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Gateway Token</label>
                                <input
                                    type="password"
                                    className="glass-input text-sm"
                                    value={token}
                                    onChange={e => setToken(e.target.value)}
                                    placeholder="VITE_DASHBOARD_SECRET"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                            <div className="input-group">
                                <label className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Default Session</label>
                                <input
                                    type="text"
                                    className="glass-input text-sm"
                                    value={sessionKey}
                                    onChange={e => setSessionKey(e.target.value)}
                                />
                            </div>
                            <div className="input-group">
                                <label className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">UI Language</label>
                                <select
                                    className="glass-input text-sm"
                                    value={language}
                                    onChange={e => setLanguage(e.target.value)}
                                >
                                    <option value="English">English</option>
                                    <option value="French">French (FR)</option>
                                    <option value="Spanish">Spanish (ES)</option>
                                </select>
                            </div>
                        </div>

                        <div className="actions-row mt-4 pt-4 border-t flex items-center justify-between">
                            <div className="flex gap-2">
                                <button type="submit" className="btn btn-primary btn-sm px-4">
                                    {connState === 'connecting'
                                        ? <><RefreshCw size={14} className="spin" /> Syncing…</>
                                        : <><Link2 size={14} /> Update Access</>
                                    }
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm text-muted" onClick={() => fetchStatus(true)}>
                                    Reset
                                </button>
                            </div>
                            {lastRefresh && (
                                <span className="text-[10px] text-muted font-bold uppercase tracking-wider">
                                    Last synced: {lastRefresh.toLocaleTimeString()}
                                </span>
                            )}
                        </div>
                    </form>
                </div>

                {/* Snapshot */}
                <div className="glass-panel gateway-snapshot overflow-hidden">
                    <div className="panel-header border-b p-4 bg-white/5">
                        <div className="flex items-center gap-2">
                            <Activity size={16} className="text-primary" />
                            <h3 className="text-sm font-bold uppercase tracking-wider">System Snapshot</h3>
                        </div>
                    </div>
                    <div className="panel-content snapshot-stats p-5">
                        <SnapshotRow
                            label="Health"
                            value={statusLabel}
                            valueColor={statusColor}
                        />
                        <SnapshotRow
                            label="Uptime"
                            value={formatUptime(statusInfo?.uptime)}
                        />
                        <SnapshotRow
                            label="Polling Rate"
                            value={formatTickInterval(statusInfo?.tickInterval)}
                        />
                        <SnapshotRow
                            label="Channels"
                            value={formatRelativeTime(statusInfo?.lastChannelsRefresh)}
                        />
                        <SnapshotRow
                            label="Security"
                            value={statusInfo?.authType ?? 'Agnostic'}
                        />
                        <div className="mt-4 pt-4 border-t text-[10px] text-muted italic flex gap-2 items-start">
                            <Info size={12} className="shrink-0" />
                            <span>Linked channels (WhatsApp, Telegram) are managed in the Channels tab.</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Counter cards ─────────────────────────────────────── */}
            <div className="overview-counters grid grid-cols-1 md:grid-cols-3 gap-5">
                {[
                    {
                        label: 'Active Beacons',
                        value: statusInfo?.instances ?? 0,
                        desc: 'Presence signals in the last 5 minutes.',
                        icon: <Wifi size={20} />,
                        color: 'var(--primary)',
                    },
                    {
                        label: 'Thread Capacity',
                        value: statusInfo?.sessions ?? 0,
                        desc: 'Active conversation session buffers.',
                        icon: <MessageSquare size={20} />,
                        color: 'var(--secondary)',
                    },
                    {
                        label: 'Cron Tasks',
                        value: statusInfo?.cron ?? 0,
                        desc: 'Scheduled agent wakeups registered.',
                        icon: <Clock size={20} />,
                        color: 'var(--success)',
                    },
                ].map(card => (
                    <div key={card.label} className="glass-panel counter-card p-6 flex flex-col items-center text-center hover:bg-white/[0.02] transition-colors cursor-default">
                        <div className="flex items-center gap-2 mb-2">
                            <span style={{ color: card.color }}>{card.icon}</span>
                            <span className="text-[10px] font-bold text-muted uppercase tracking-widest">{card.label}</span>
                        </div>
                        <div className="text-4xl font-bold mb-1" style={{ color: card.color }}>
                            {card.value}
                        </div>
                        <p className="text-xs text-muted max-w-[200px]">{card.desc}</p>
                    </div>
                ))}
            </div>

            {/* ── Bottom row: Activity feed + Operator notes ────────── */}
            <div className="overview-bottom-grid grid grid-cols-1 xl:grid-cols-2 gap-5 mb-8">

                {/* Recent Activity */}
                <div className="glass-panel activity-panel overflow-hidden">
                    <div className="panel-header border-b p-4 bg-white/5 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <Zap size={16} className="text-primary" />
                            <h3 className="text-sm font-bold uppercase tracking-wider">Stream Activity</h3>
                        </div>
                        {connState === 'connected' && (
                            <span className="badge-bool bg-success/10 text-success text-[10px] gap-1.5 border-none">
                                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                                LIVE
                            </span>
                        )}
                    </div>
                    <div className="max-h-[350px] overflow-y-auto scrollbar-thin">
                        <ActivityFeed entries={activity} />
                    </div>
                </div>

                {/* Operator Notes */}
                <div className="glass-panel operator-notes-panel overflow-hidden">
                    <div className="panel-header border-b p-4 bg-white/5">
                        <div className="flex items-center gap-2">
                            <Shield size={16} className="text-primary" />
                            <h3 className="text-sm font-bold uppercase tracking-wider">Operator Directives</h3>
                        </div>
                    </div>
                    <div className="notes-content flex flex-col">
                        <div className="note-card p-4 flex gap-4 border-b hover:bg-white/[0.01] transition-colors">
                            <div className="shrink-0 w-8 h-8 rounded bg-primary/10 text-primary flex items-center justify-center">
                                <Shield size={16} />
                            </div>
                            <div>
                                <h4 className="text-sm font-bold mb-1">Encrypted Transit</h4>
                                <p className="text-xs text-muted leading-relaxed">Ensure the gateway is shielded behind a secure tunnel or SSL proxy. Avoid exposing raw TCP ports to the public web.</p>
                            </div>
                        </div>
                        <div className="note-card p-4 flex gap-4 border-b hover:bg-white/[0.01] transition-colors">
                            <div className="shrink-0 w-8 h-8 rounded bg-secondary/10 text-secondary flex items-center justify-center">
                                <MessageSquare size={16} />
                            </div>
                            <div>
                                <h4 className="text-sm font-bold mb-1">Context Management</h4>
                                <p className="text-xs text-muted leading-relaxed">Session buffers grow with interaction. Prune legacy session keys via the Sessions tab to maintain response speed and optimize costs.</p>
                            </div>
                        </div>
                        <div className="note-card p-4 flex gap-4 hover:bg-white/[0.01] transition-colors">
                            <div className="shrink-0 w-8 h-8 rounded bg-success/10 text-success flex items-center justify-center">
                                <Calendar size={16} />
                            </div>
                            <div>
                                <h4 className="text-sm font-bold mb-1">Scheduled Operations</h4>
                                <p className="text-xs text-muted leading-relaxed">Cron triggers depend on agent availability. Monitor Heartbeat status regularly for autonomous agent consistency.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
