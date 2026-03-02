import { useEffect, useState, useRef, useMemo } from 'react';
import {
    Search, Download, RefreshCw,
    CheckCircle2, AlertTriangle, XCircle, Info,
    Bug, Activity, Zap
} from 'lucide-react';
import { PageHeader, EmptyState } from '../components';
import './Logs.css';

interface LogMessage {
    timestamp: string;
    level: string;
    text: string;
    module?: string;
}

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_CONFIG: Record<LogLevel, { label: string; color: string; icon: any }> = {
    trace: { label: 'trace', color: 'var(--text-muted)', icon: Activity },
    debug: { label: 'debug', color: 'var(--primary)', icon: Bug },
    info: { label: 'info', color: '#22d3ee', icon: Info },
    warn: { label: 'warn', color: 'var(--warning)', icon: AlertTriangle },
    error: { label: 'error', color: 'var(--danger)', icon: XCircle },
    fatal: { label: 'fatal', color: '#d946ef', icon: Zap },
};

export function Logs() {
    const [logs, setLogs] = useState<LogMessage[]>([]);
    const [filters, setFilters] = useState<Record<LogLevel, boolean>>({
        trace: false,
        debug: true,
        info: true,
        warn: true,
        error: true,
        fatal: true,
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [autoFollow, setAutoFollow] = useState(true);
    const [logFile] = useState<string>('Live Gateway Stream');

    const scrollRef = useRef<HTMLDivElement>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const secret = import.meta.env.VITE_DASHBOARD_SECRET || '';
        const eventSource = new EventSource(`/api/logs/stream?token=${secret}`);

        eventSource.onmessage = (event) => {
            try {
                const message: LogMessage = JSON.parse(event.data);
                setLogs(prev => {
                    const next = [...prev, message];
                    // Keep max 5000 lines for industrial feel but avoid crash
                    if (next.length > 5000) return next.slice(next.length - 5000);
                    return next;
                });
            } catch (err) {
                // Fallback for non-JSON logs
                const fallback: LogMessage = {
                    timestamp: new Date().toISOString(),
                    level: 'info',
                    text: event.data,
                    module: 'gateway'
                };
                setLogs(prev => [...prev.slice(-4999), fallback]);
            }
        };

        return () => {
            eventSource.close();
        };
    }, []);

    useEffect(() => {
        if (autoFollow) {
            logsEndRef.current?.scrollIntoView({ behavior: 'auto' });
        }
    }, [logs, autoFollow]);

    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            const level = log.level.toLowerCase() as LogLevel;
            if (!filters[level]) return false;
            if (searchTerm && !log.text.toLowerCase().includes(searchTerm.toLowerCase()) &&
                !(log.module && log.module.toLowerCase().includes(searchTerm.toLowerCase()))) {
                return false;
            }
            return true;
        });
    }, [logs, filters, searchTerm]);

    const toggleFilter = (level: LogLevel) => {
        setFilters(prev => ({ ...prev, [level]: !prev[level] }));
    };

    const formatTimestamp = (ts: string) => {
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' }).toUpperCase();
    };

    const handleExport = () => {
        const content = filteredLogs.map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.module ? `[${l.module}] ` : ''}${l.text}`).join('\n');
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `openclaw-logs-${new Date().toISOString().split('T')[0]}.log`;
        a.click();
    };

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        // Detect if user scrolled up
        const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
        if (autoFollow && !isAtBottom) {
            setAutoFollow(false);
        } else if (!autoFollow && isAtBottom) {
            setAutoFollow(true);
        }
    };

    return (
        <div className="page-container logs-page">
            <PageHeader
                title="System Logs"
                description="Live tail of the gateway file logs."
                actions={
                    <div className="flex gap-2">
                        <button className="btn btn-outline btn-sm" onClick={() => setLogs([])}>
                            <RefreshCw size={14} /> Clear Buffer
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={handleExport}>
                            <Download size={14} /> Export Visible
                        </button>
                    </div>
                }
            />

            <div className="glass-panel logs-viewer-panel">
                <div className="panel-header" style={{ padding: '1rem 1.25rem', borderBottom: 'none' }}>
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <Activity size={18} className="text-primary" />
                            <h3 style={{ margin: 0, fontSize: '0.9rem' }}>Live Feed</h3>
                        </div>
                        <div className="text-xs text-muted font-mono">
                            {logFile}
                        </div>
                    </div>
                </div>

                <div className="logs-toolbar p-4">
                    <div className="filter-label mb-2" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Filter
                    </div>

                    <div className="flex flex-wrap items-center gap-4 mb-4">
                        <div className="relative" style={{ flex: '1', minWidth: '200px' }}>
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                            <input
                                type="text"
                                className="search-logs-input"
                                placeholder="Search logs"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                style={{
                                    paddingLeft: '2.5rem',
                                    width: '100%',
                                    background: 'rgba(0,0,0,0.2)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 'var(--radius-md)',
                                    height: '40px',
                                    fontSize: '0.9rem'
                                }}
                            />
                        </div>

                        <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            <span style={{ fontSize: '0.8rem' }}>Auto-follow</span>
                            <input
                                type="checkbox"
                                checked={autoFollow}
                                onChange={e => setAutoFollow(e.target.checked)}
                                style={{
                                    accentColor: 'var(--primary)',
                                    width: '16px',
                                    height: '16px'
                                }}
                            />
                        </label>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {(Object.keys(LEVEL_CONFIG) as LogLevel[]).map(level => (
                            <label key={level} className={`filter-chip ${filters[level] ? 'active' : ''}`} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.35rem 0.8rem',
                                borderRadius: 'var(--radius-md)',
                                border: `1px solid ${filters[level] ? LEVEL_CONFIG[level].color : 'var(--border)'}`,
                                background: filters[level] ? `${LEVEL_CONFIG[level].color}15` : 'transparent',
                                color: filters[level] ? LEVEL_CONFIG[level].color : 'var(--text-muted)',
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}>
                                <input
                                    type="checkbox"
                                    hidden
                                    checked={filters[level]}
                                    onChange={() => toggleFilter(level)}
                                />
                                {filters[level] ? <CheckCircle2 size={14} /> : <div style={{ width: 14 }} />}
                                {level}
                            </label>
                        ))}
                    </div>
                </div>

                <div className="px-4 pb-2" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    File: <span style={{ fontFamily: 'monospace' }}>{logFile}</span>
                </div>

                <div className="logs-container" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                    <div
                        className="logs-content p-4 font-mono text-sm overflow-y-auto"
                        style={{ height: '100%' }}
                        ref={scrollRef}
                        onScroll={handleScroll}
                    >
                        {filteredLogs.length === 0 ? (
                            <EmptyState
                                icon={Search}
                                title="No logs found"
                                description={logs.length === 0
                                    ? "Waiting for incoming logs from the gateway..."
                                    : "No logs match your current search and filter criteria."}
                            />
                        ) : (
                            <div className="logs-table" style={{ display: 'flex', flexDirection: 'column' }}>
                                {filteredLogs.map((log, idx) => {
                                    const level = log.level.toLowerCase() as LogLevel;
                                    const config = LEVEL_CONFIG[level] || LEVEL_CONFIG.info;
                                    return (
                                        <div key={idx} className="log-row flex gap-4 py-1 hover:bg-white/5 transition-colors">
                                            <div className="log-time shrink-0" style={{ color: 'var(--text-muted)', width: '90px' }}>
                                                {formatTimestamp(log.timestamp)}
                                            </div>
                                            <div className="log-level shrink-0 flex items-center justify-center" style={{ width: '50px' }}>
                                                <span style={{
                                                    fontSize: '0.65rem',
                                                    fontWeight: 800,
                                                    border: `1px solid ${config.color}40`,
                                                    color: config.color,
                                                    padding: '0 0.3rem',
                                                    borderRadius: '3px',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    {level}
                                                </span>
                                            </div>
                                            <div className="log-module shrink-0 truncate" style={{ width: '150px', color: 'var(--text-secondary)' }}>
                                                {log.module || 'gateway'}
                                            </div>
                                            <div className="log-text grow break-all" style={{ color: level === 'error' || level === 'fatal' ? config.color : 'rgba(255,255,255,0.85)' }}>
                                                {log.text}
                                            </div>
                                        </div>
                                    );
                                })}
                                <div ref={logsEndRef} style={{ height: '1px' }} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
