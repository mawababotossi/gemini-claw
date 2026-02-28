import { useState, useEffect, useRef } from 'react';
import {
    Bot, RefreshCw, Save, Trash2, Settings, FileText,
    Wrench, Zap, Radio, Calendar, Plus,
    ShieldOff, AlertTriangle, CheckCircle2,
    Clock, GitBranch, Loader2
} from 'lucide-react';
import { api, type AgentConfig } from '../services/api';
import './Agents.css';

type TabType = 'overview' | 'files' | 'tools' | 'skills' | 'channels' | 'cron';

const ALL_PERMISSIONS = [
    { id: 'read_file', label: 'read_file', desc: 'Read files from the filesystem' },
    { id: 'write_file', label: 'write_file', desc: 'Write and modify files' },
    { id: 'run_shell_command', label: 'run_shell_command', desc: 'Execute shell commands' },
    { id: 'network', label: 'network', desc: 'Make network requests' },
    { id: 'getCurrentTime', label: 'getCurrentTime', desc: 'Read current date/time' },
    { id: 'readMemoryFile', label: 'readMemoryFile', desc: 'Read agent memory files' },
    { id: 'updateMemoryFile', label: 'updateMemoryFile', desc: 'Write to agent memory files' },
    { id: 'delegate_task', label: 'delegate_task', desc: 'Delegate to another agent' },
    { id: 'schedule_task', label: 'schedule_task', desc: 'Schedule a cron task' },
    { id: 'google_web_search', label: 'google_web_search', desc: 'Search the web' },
];

const CHANNEL_COLORS: Record<string, string> = {
    whatsapp: '#25D366',
    telegram: '#2AABEE',
    webchat: 'var(--primary)',
};

// ─── Small helpers ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
    const map: Record<string, { color: string; bg: string }> = {
        Healthy: { color: 'var(--success)', bg: 'rgba(16,185,129,.12)' },
        Unresponsive: { color: 'var(--warning)', bg: 'rgba(245,158,11,.12)' },
        Restarting: { color: 'var(--warning)', bg: 'rgba(245,158,11,.12)' },
        Dead: { color: 'var(--danger)', bg: 'rgba(239,68,68,.12)' },
    };
    const s = map[status ?? ''] ?? { color: 'var(--text-muted)', bg: 'rgba(255,255,255,.05)' };
    return (
        <span style={{
            fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.55rem',
            borderRadius: 'var(--radius-full)', background: s.bg, color: s.color,
            letterSpacing: '0.04em', textTransform: 'uppercase',
        }}>
            {status ?? 'Unknown'}
        </span>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            marginBottom: '0.75rem', paddingBottom: '0.5rem',
            borderBottom: '1px solid var(--border)',
        }}>
            {children}
        </div>
    );
}

function FormField({
    label, children, hint
}: { label: string; children: React.ReactNode; hint?: string }) {
    return (
        <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                {label}
            </label>
            {children}
            {hint && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>{hint}</p>}
        </div>
    );
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ opacity: 0.3, marginBottom: '1rem' }}>{icon}</div>
            <h3 style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '0.4rem' }}>{title}</h3>
            <p style={{ fontSize: '0.85rem', maxWidth: '280px' }}>{description}</p>
        </div>
    );
}

// ─── Tab: Overview ──────────────────────────────────────────────────────────

function OverviewTab({
    formData, setFormData, models, isCreating, onSave, onReload, isSaving
}: {
    formData: AgentConfig;
    setFormData: (d: AgentConfig) => void;
    models: string[];
    isCreating: boolean;
    onSave: (e: React.FormEvent) => void;
    onReload: () => void;
    isSaving: boolean;
}) {
    const togglePermission = (id: string) => {
        const current = formData.allowedPermissions ?? [];
        const next = current.includes(id) ? current.filter(p => p !== id) : [...current, id];
        setFormData({ ...formData, allowedPermissions: next });
    };

    const granted = formData.allowedPermissions ?? [];

    return (
        <form onSubmit={onSave} className="tab-content animate-fade-in" style={{ maxWidth: '680px' }}>

            {/* Identity */}
            <SectionTitle>Identity</SectionTitle>
            <div className="form-row split-form" style={{ marginBottom: '1rem' }}>
                <FormField label="Agent Name" hint={isCreating ? 'Cannot be changed after creation.' : undefined}>
                    <input
                        className="form-input"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g. main"
                        required
                        disabled={!isCreating}
                        style={{ opacity: isCreating ? 1 : 0.6 }}
                    />
                </FormField>
                <FormField label="Base Directory">
                    <input
                        className="form-input"
                        value={formData.baseDir ?? ''}
                        onChange={e => setFormData({ ...formData, baseDir: e.target.value })}
                        placeholder="e.g. ./data/agents/main"
                    />
                </FormField>
            </div>

            {/* Models */}
            <SectionTitle>Model Selection</SectionTitle>
            <div className="form-row split-form" style={{ marginBottom: '0.75rem' }}>
                <FormField label="Primary Model">
                    <select
                        className="form-select"
                        value={formData.model}
                        onChange={e => setFormData({ ...formData, model: e.target.value })}
                        required
                    >
                        <option value="" disabled>Select a model</option>
                        {models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </FormField>
                <FormField label="Callback Model (Fallback #1)">
                    <select
                        className="form-select"
                        value={formData.modelCallback ?? ''}
                        onChange={e => setFormData({ ...formData, modelCallback: e.target.value })}
                    >
                        <option value="">None</option>
                        {models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </FormField>
            </div>
            <FormField label="Additional Fallbacks (comma-separated)" hint="Tried in order after callback fails.">
                <input
                    className="form-input"
                    value={(formData.fallbackModels ?? []).join(', ')}
                    onChange={e => setFormData({
                        ...formData,
                        fallbackModels: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    })}
                    placeholder="e.g. gemini-1.5-pro, gemini-1.5-flash"
                />
            </FormField>

            {/* Heartbeat */}
            <SectionTitle>Heartbeat</SectionTitle>
            <div className="form-row split-form" style={{ marginBottom: '1rem' }}>
                <FormField label="Enabled">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingTop: '0.4rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            <input
                                type="checkbox"
                                checked={formData.heartbeat?.enabled ?? false}
                                onChange={e => setFormData({ ...formData, heartbeat: { ...(formData.heartbeat ?? {}), enabled: e.target.checked } })}
                                style={{ accentColor: 'var(--primary)', width: '15px', height: '15px' }}
                            />
                            Active
                        </label>
                    </div>
                </FormField>
                <FormField label="Cron Expression" hint="e.g. 0 8,20 * * *">
                    <input
                        className="form-input"
                        value={formData.heartbeat?.cron ?? ''}
                        onChange={e => setFormData({ ...formData, heartbeat: { ...(formData.heartbeat ?? {}), enabled: formData.heartbeat?.enabled ?? false, cron: e.target.value } })}
                        placeholder="0 8,20 * * * (UTC)"
                        disabled={!formData.heartbeat?.enabled}
                        style={{ opacity: formData.heartbeat?.enabled ? 1 : 0.4 }}
                    />
                </FormField>
            </div>

            {/* Auth */}
            <SectionTitle>Authentication</SectionTitle>
            <div className="form-row split-form" style={{ marginBottom: '1rem' }}>
                <FormField label="Auth Type">
                    <select
                        className="form-select"
                        value={formData.authType ?? 'oauth-personal'}
                        onChange={e => setFormData({ ...formData, authType: e.target.value as any })}
                    >
                        <option value="oauth-personal">OAuth (Personal)</option>
                        <option value="gemini-api-key">Gemini API Key</option>
                        <option value="vertex-ai">Vertex AI</option>
                    </select>
                </FormField>
                <FormField label="API Key" hint="Only required for gemini-api-key auth.">
                    <input
                        className="form-input"
                        type="password"
                        value={formData.apiKey ?? ''}
                        onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
                        placeholder="Leave empty to use env variable"
                        disabled={formData.authType !== 'gemini-api-key'}
                        style={{ opacity: formData.authType === 'gemini-api-key' ? 1 : 0.4 }}
                    />
                </FormField>
            </div>

            {/* Permissions */}
            <SectionTitle>Allowed Permissions</SectionTitle>
            {granted.length === 0 && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                    padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-md)',
                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                    marginBottom: '0.75rem',
                }}>
                    <AlertTriangle size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.8rem', color: 'var(--warning)' }}>
                        No permissions granted — agent tools requiring authorization will be blocked.
                    </span>
                </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.5rem' }}>
                {ALL_PERMISSIONS.map(p => {
                    const active = granted.includes(p.id);
                    return (
                        <label key={p.id} style={{
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                            padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-md)',
                            border: `1px solid ${active ? 'rgba(99,102,241,0.3)' : 'var(--border)'}`,
                            background: active ? 'rgba(99,102,241,0.06)' : 'transparent',
                            cursor: 'pointer', transition: 'all 0.15s',
                        }}>
                            <input
                                type="checkbox"
                                checked={active}
                                onChange={() => togglePermission(p.id)}
                                style={{ accentColor: 'var(--primary)', width: '14px', height: '14px', flexShrink: 0 }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: active ? 'var(--primary)' : 'var(--text-secondary)', fontFamily: 'monospace' }}>
                                    {p.label}
                                </span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.75rem' }}>{p.desc}</span>
                            </div>
                            {active
                                ? <CheckCircle2 size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                                : <ShieldOff size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, opacity: 0.4 }} />
                            }
                        </label>
                    );
                })}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                <button type="button" className="btn btn-outline" onClick={onReload} disabled={isSaving}>
                    <RefreshCw size={14} /> Reload Config
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSaving}>
                    {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {isCreating ? 'Create Agent' : 'Save Changes'}
                </button>
            </div>
        </form>
    );
}

// ─── Tab: Files ──────────────────────────────────────────────────────────────

function FilesTab({ agentName, memory }: { agentName: string; memory: any[] }) {
    const [activeFile, setActiveFile] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (memory.length > 0 && !activeFile) {
            setActiveFile(memory[0].name);
        }
    }, [memory, activeFile]);

    useEffect(() => {
        if (activeFile) {
            loadFile(activeFile);
        }
    }, [activeFile, agentName]);

    const loadFile = async (filename: string) => {
        setIsLoading(true);
        try {
            const content = await api.getAgentMemoryContent(agentName, filename);
            setFileContent(content);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        if (!activeFile) return;
        setIsSaving(true);
        try {
            await api.updateAgentMemoryContent(agentName, activeFile, fileContent);
        } catch (err) {
            alert('Failed to save file');
        } finally {
            setIsSaving(false);
        }
    };

    const formatTimeAgo = (timestamp?: number) => {
        if (!timestamp) return '';
        const diff = Date.now() - timestamp;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return `${Math.floor(diff / 86400000)}d ago`;
    };

    if (memory.length === 0) {
        return (
            <div className="tab-content animate-fade-in" style={{ height: '100%' }}>
                <EmptyState
                    icon={<FileText size={48} />}
                    title="No memory files found"
                    description={`Agent "${agentName}" has no memory files yet. They will be created on first run.`}
                />
            </div>
        );
    }

    const activeFileData = memory.find(m => m.name === activeFile);

    return (
        <div className="tab-content animate-fade-in files-split-layout">
            <div className="files-sidebar">
                {memory.map((file: any) => (
                    <div
                        key={file.name}
                        className={`file-nav-item ${activeFile === file.name ? 'active' : ''}`}
                        onClick={() => setActiveFile(file.name)}
                    >
                        <div className="file-nav-title">{file.name}</div>
                        <div className="file-nav-meta">
                            {file.size ? `${(file.size / 1024).toFixed(1)} KB` : '0 KB'}
                            {file.mtime && ` · ${formatTimeAgo(file.mtime)}`}
                        </div>
                    </div>
                ))}
            </div>
            <div className="files-editor-panel glass-panel">
                {activeFile ? (
                    <>
                        <div className="editor-header">
                            <div>
                                <span className="editor-filename">{activeFile}</span>
                                <span className="editor-meta">
                                    {activeFileData?.size ? `${(activeFileData.size / 1024).toFixed(1)} KB` : '0 KB'}
                                    {activeFileData?.mtime && ` · modified ${formatTimeAgo(activeFileData.mtime)}`}
                                </span>
                            </div>
                            <button className="btn btn-outline" style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)' }} onClick={handleSave} disabled={isSaving || isLoading}>
                                {isSaving ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
                            </button>
                        </div>
                        <div className="editor-content-wrapper">
                            {isLoading ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
                                    <Loader2 size={24} className="animate-spin text-muted" />
                                </div>
                            ) : (
                                <textarea
                                    className="editor-textarea"
                                    value={fileContent}
                                    onChange={(e) => setFileContent(e.target.value)}
                                    spellCheck={false}
                                />
                            )}
                        </div>
                    </>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                        Select a file to view and edit
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Tab: Tools ──────────────────────────────────────────────────────────────

function ToolsTab({ agent }: { agent: AgentConfig }) {
    const allTools = ALL_PERMISSIONS;
    const granted = agent.allowedPermissions ?? [];

    return (
        <div className="tab-content animate-fade-in">
            <SectionTitle>MCP Tool Access — geminiclaw-skills</SectionTitle>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Tool access is controlled by <strong>Allowed Permissions</strong> in the Overview tab.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {allTools.map(tool => {
                    const active = granted.includes(tool.id);
                    return (
                        <div key={tool.id} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '0.7rem 1rem', borderRadius: 'var(--radius-md)',
                            background: 'var(--bg-card)',
                            border: `1px solid ${active ? 'rgba(99,102,241,0.2)' : 'var(--border)'}`,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                {active
                                    ? <CheckCircle2 size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />
                                    : <ShieldOff size={15} style={{ color: 'var(--danger)', flexShrink: 0, opacity: 0.6 }} />
                                }
                                <div>
                                    <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600, color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                        {tool.label}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.75rem' }}>{tool.desc}</span>
                                </div>
                            </div>
                            <span style={{
                                fontSize: '0.7rem', fontWeight: 600, padding: '0.2rem 0.55rem',
                                borderRadius: 'var(--radius-full)', textTransform: 'uppercase',
                                background: active ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.1)',
                                color: active ? 'var(--success)' : 'var(--danger)',
                            }}>
                                {active ? 'Allowed' : 'Blocked'}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Tab: Skills ─────────────────────────────────────────────────────────────

function SkillsTab({ availableSkills, agent }: {
    availableSkills: { native: any[]; project: any[] };
    agent: AgentConfig;
}) {
    const [search, setSearch] = useState('');
    const granted = agent.allowedPermissions ?? [];

    const filterSkills = (list: any[]) =>
        list.filter(s => s.name?.toLowerCase().includes(search.toLowerCase()) ||
            s.description?.toLowerCase().includes(search.toLowerCase()));

    const native = filterSkills(availableSkills.native);
    const project = filterSkills(availableSkills.project);

    const SkillRow = ({ skill }: { skill: any }) => {
        const isGranted = granted.includes(skill.name);
        return (
            <div style={{
                padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)',
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
            }}>
                <div style={{
                    width: 32, height: 32, borderRadius: 'var(--radius-sm)', flexShrink: 0,
                    background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1rem',
                }}>
                    {skill.icon ?? '⚡'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                        <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>{skill.name}</span>
                        <span style={{
                            fontSize: '0.67rem', fontWeight: 700, padding: '0.15rem 0.45rem',
                            borderRadius: 'var(--radius-full)', textTransform: 'uppercase',
                            background: isGranted ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
                            color: isGranted ? 'var(--success)' : 'var(--danger)',
                        }}>
                            {isGranted ? 'Active' : 'Blocked'}
                        </span>
                        {skill.missing && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--warning)' }}>
                                Missing: {skill.missing}
                            </span>
                        )}
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>{skill.description}</p>
                </div>
            </div>
        );
    };

    return (
        <div className="tab-content animate-fade-in">
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <input
                        className="form-input"
                        placeholder="Search skills..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ paddingLeft: '0.9rem' }}
                    />
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                    {native.length + project.length} shown
                </span>
            </div>

            {project.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                    <SectionTitle>Project Skills — {project.length}</SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {project.map(s => <SkillRow key={s.name} skill={s} />)}
                    </div>
                </div>
            )}

            <div>
                <SectionTitle>Native Tools — {native.length}</SectionTitle>
                {native.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {native.map(s => <SkillRow key={s.name} skill={s} />)}
                    </div>
                ) : (
                    <EmptyState
                        icon={<Zap size={40} />}
                        title="No skills found"
                        description="Try a different search term."
                    />
                )}
            </div>
        </div>
    );
}

// ─── Tab: Channels ────────────────────────────────────────────────────────────

function ChannelsTab({ sessions }: { sessions: any[] }) {
    const channelGroups: Record<string, any[]> = {};
    sessions.forEach(s => {
        const ch = s.channel ?? 'unknown';
        if (!channelGroups[ch]) channelGroups[ch] = [];
        channelGroups[ch].push(s);
    });

    if (sessions.length === 0) {
        return (
            <div className="tab-content animate-fade-in">
                <EmptyState
                    icon={<Radio size={48} />}
                    title="No active sessions"
                    description="This agent has no active channel sessions right now."
                />
            </div>
        );
    }

    return (
        <div className="tab-content animate-fade-in">
            <SectionTitle>Active Channel Sessions</SectionTitle>
            {Object.entries(channelGroups).map(([channel, chSessions]) => {
                const color = CHANNEL_COLORS[channel] ?? 'var(--primary)';
                return (
                    <div key={channel} style={{ marginBottom: '1.25rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                {channel}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>· {chSessions.length} session{chSessions.length > 1 ? 's' : ''}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            {chSessions.map((s: any) => (
                                <div key={s.key ?? s.id} style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '0.65rem 0.9rem', borderRadius: 'var(--radius-md)',
                                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                                }}>
                                    <div>
                                        <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: color }}>
                                            {s.key ?? s.peerId ?? s.id}
                                        </span>
                                        {s.label && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.6rem' }}>{s.label}</span>}
                                    </div>
                                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        {s.tokens && <span>{s.tokens.toLocaleString()} tokens</span>}
                                        {s.updated && <span>{new Date(s.updated).toLocaleTimeString()}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Tab: Cron Jobs ───────────────────────────────────────────────────────────

function CronTab({ agentName, jobs, onRemove }: {
    agentName: string;
    jobs: any[];
    onRemove: (id: string) => void;
}) {
    const STATUS_COLOR: Record<string, string> = { ok: 'var(--success)', error: 'var(--danger)', running: 'var(--warning)' };

    if (jobs.length === 0) {
        return (
            <div className="tab-content animate-fade-in">
                <EmptyState
                    icon={<Calendar size={48} />}
                    title="No scheduled tasks"
                    description={`No cron jobs are currently assigned to agent "${agentName}".`}
                />
            </div>
        );
    }

    return (
        <div className="tab-content animate-fade-in">
            <SectionTitle>Scheduled Tasks — {jobs.length}</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {jobs.map((job: any) => (
                    <div key={job.id} className="glass-panel" style={{ padding: '1rem 1.25rem' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                        {job.name ?? job.id}
                                    </span>
                                    {job.status && (
                                        <span style={{
                                            fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem',
                                            borderRadius: 'var(--radius-full)', textTransform: 'uppercase',
                                            background: `${STATUS_COLOR[job.status] ?? 'var(--text-muted)'}18`,
                                            color: STATUS_COLOR[job.status] ?? 'var(--text-muted)',
                                        }}>
                                            {job.status}
                                        </span>
                                    )}
                                </div>
                                <code style={{ fontSize: '0.78rem', color: 'var(--primary)', background: 'rgba(99,102,241,0.08)', padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-sm)' }}>
                                    {job.cron}
                                </code>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    className="btn btn-outline"
                                    style={{ padding: '0.3rem 0.8rem', fontSize: '0.78rem', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }}
                                    onClick={() => onRemove(job.id)}
                                >
                                    <Trash2 size={12} /> Remove
                                </button>
                            </div>
                        </div>
                        {job.prompt && (
                            <p style={{
                                fontSize: '0.8rem', color: 'var(--text-muted)',
                                background: 'rgba(0,0,0,0.2)', padding: '0.5rem 0.75rem',
                                borderRadius: 'var(--radius-sm)', margin: '0.5rem 0 0',
                                fontFamily: 'monospace', lineHeight: 1.5,
                                display: '-webkit-box', WebkitLineClamp: 3,
                                WebkitBoxOrient: 'vertical', overflow: 'hidden',
                            }}>
                                {job.prompt}
                            </p>
                        )}
                        {(job.next || job.last) && (
                            <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.6rem' }}>
                                {job.next && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        <Clock size={11} style={{ color: 'var(--success)' }} />
                                        Next: <span style={{ color: 'var(--text-secondary)' }}>{job.next}</span>
                                    </div>
                                )}
                                {job.last && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        <GitBranch size={11} />
                                        Last: <span style={{ color: 'var(--text-secondary)' }}>{job.last}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Agents() {
    const [agents, setAgents] = useState<AgentConfig[]>([]);
    const [models, setModels] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>('overview');
    const [formData, setFormData] = useState<AgentConfig | null>(null);
    const [availableSkills, setAvailableSkills] = useState<{ native: any[]; project: any[] }>({ native: [], project: [] });
    const [agentJobs, setAgentJobs] = useState<any[]>([]);
    const [agentMemory, setAgentMemory] = useState<any[]>([]);
    const [agentSessions, setAgentSessions] = useState<any[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const detailsRef = useRef<HTMLDivElement>(null);

    // ── Data fetching ──────────────────────────────────────────────────────

    const fetchAgents = async () => {
        try {
            setIsLoading(true);
            const data = await api.getAgents();
            setAgents(data);
            if (data.length > 0 && !selectedAgentName && !isCreating) {
                setSelectedAgentName(data[0].name);
            }
        } catch (err) {
            console.error('Failed to fetch agents', err);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchAgentDetails = async (name: string) => {
        try {
            const [jobs, memory, sessions] = await Promise.all([
                api.getAgentJobs(name).catch(() => []),
                api.getAgentMemory(name).catch(() => []),
                api.getSessions().then(all => all.filter((s: any) =>
                    s.key?.includes(`:${name}:`) || s.agent === name
                )).catch(() => []),
            ]);
            setAgentJobs(jobs);
            setAgentMemory(memory);
            setAgentSessions(sessions);
        } catch (err) {
            console.error('Failed to fetch agent details', err);
        }
    };

    useEffect(() => {
        fetchAgents();
        api.getModels().then(setModels).catch(() => { });
        api.getSkills().then(setAvailableSkills).catch(() => { });
    }, []);

    useEffect(() => {
        if (selectedAgentName) {
            const agent = agents.find(a => a.name === selectedAgentName);
            if (agent) {
                setFormData({ ...agent });
                fetchAgentDetails(agent.name);
            }
        }
    }, [selectedAgentName, agents]);

    // ── Actions ─────────────────────────────────────────────────────────────

    const handleSelectAgent = (name: string) => {
        setSelectedAgentName(name);
        setIsCreating(false);
        setActiveTab('overview');
        detailsRef.current?.scrollTo({ top: 0 });
    };

    const handleCreateNew = () => {
        setSelectedAgentName(null);
        setIsCreating(true);
        setActiveTab('overview');
        setFormData({ name: '', model: 'gemini-2.0-flash', modelCallback: '', fallbackModels: [], allowedPermissions: [] });
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData) return;
        setIsSaving(true);
        try {
            if (isCreating) {
                await api.createAgent(formData);
                setIsCreating(false);
                setSelectedAgentName(formData.name);
            } else {
                await api.updateAgent(formData.name, formData);
            }
            await fetchAgents();
        } catch (err: any) {
            alert(err.response?.data?.error ?? err.message ?? 'Failed to save agent');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (name: string) => {
        if (!confirm(`Delete agent "${name}"? This cannot be undone.`)) return;
        try {
            await api.deleteAgent(name);
            setSelectedAgentName(null);
            await fetchAgents();
        } catch (err: any) {
            alert(err.response?.data?.error ?? err.message ?? 'Failed to delete agent');
        }
    };

    const handleRemoveJob = async (jobId: string) => {
        if (!selectedAgentName || !confirm('Remove this scheduled task?')) return;
        try {
            await api.deleteAgentJob(selectedAgentName, jobId);
            const jobs = await api.getAgentJobs(selectedAgentName);
            setAgentJobs(jobs);
        } catch {
            alert('Failed to remove job');
        }
    };

    // ── Render ───────────────────────────────────────────────────────────────

    const TABS: { id: TabType; label: string; icon: React.ReactNode; badge?: number }[] = [
        { id: 'overview', label: 'Overview', icon: <Settings size={13} /> },
        { id: 'files', label: 'Files', icon: <FileText size={13} />, badge: agentMemory.length || undefined },
        { id: 'tools', label: 'Tools', icon: <Wrench size={13} /> },
        { id: 'skills', label: 'Skills', icon: <Zap size={13} /> },
        { id: 'channels', label: 'Channels', icon: <Radio size={13} />, badge: agentSessions.length || undefined },
        { id: 'cron', label: 'Cron Jobs', icon: <Calendar size={13} />, badge: agentJobs.length || undefined },
    ];

    const selectedAgent = agents.find(a => a.name === selectedAgentName);

    return (
        <div className="page-container agents-page">
            {/* ── Page header ─────────────────────────────── */}
            <div className="page-header" style={{ marginBottom: '0' }}>
                <h1>Agents</h1>
                <p>Manage agent workspaces, tools, and identities.</p>
            </div>

            {/* ── Split layout ─────────────────────────────── */}
            <div className="agents-split-layout">

                {/* Left: agent list */}
                <div className="agents-navigation glass-panel">
                    <div className="nav-header flex justify-between items-center p-3 border-b">
                        <span className="font-bold text-sm uppercase tracking-wider text-muted">
                            Agents ({agents.length})
                        </span>
                        <button
                            className="icon-btn btn-primary"
                            style={{ padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}
                            onClick={handleCreateNew}
                            title="New Agent"
                        >
                            <Plus size={14} /> New
                        </button>
                    </div>

                    <div className="agents-list">
                        {isLoading ? (
                            <div className="flex justify-center p-4">
                                <RefreshCw className="animate-spin" style={{ color: 'var(--primary)' }} size={20} />
                            </div>
                        ) : (
                            agents.map(agent => (
                                <div
                                    key={agent.name}
                                    className={`agent-nav-item ${selectedAgentName === agent.name && !isCreating ? 'active' : ''}`}
                                    onClick={() => handleSelectAgent(agent.name)}
                                >
                                    <div className="agent-avatar bg-primary-dim" style={{ color: 'var(--primary)', fontWeight: 700, fontSize: '0.95rem' }}>
                                        {agent.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="agent-nav-info overflow-hidden">
                                        <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }} className="truncate">{agent.name}</h4>
                                        <span className="text-xs truncate" style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>{agent.model}</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem', flexShrink: 0 }}>
                                        {agent.name === 'main' && (
                                            <span style={{ fontSize: '0.65rem', background: 'rgba(99,102,241,0.12)', color: 'var(--primary)', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-full)', fontWeight: 700, textTransform: 'uppercase' }}>
                                                Default
                                            </span>
                                        )}
                                        {agent.status && <StatusBadge status={agent.status} />}
                                    </div>
                                </div>
                            ))
                        )}

                        {isCreating && (
                            <div className="agent-nav-item active creating">
                                <div className="agent-avatar bg-accent-dim" style={{ color: 'var(--success)' }}>
                                    <Plus size={16} />
                                </div>
                                <div className="agent-nav-info">
                                    <h4 style={{ fontSize: '0.9rem' }}>New Agent</h4>
                                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Unsaved</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: detail panel */}
                <div className="agent-details-panel glass-panel">
                    {(selectedAgentName || isCreating) && formData ? (
                        <>
                            {/* Detail header */}
                            <div className="details-header p-4 flex justify-between items-end" style={{ background: 'rgba(0,0,0,0.15)', borderBottom: '1px solid var(--border)' }}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                                        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>
                                            {isCreating ? 'Create New Agent' : selectedAgentName}
                                        </h2>
                                        {!isCreating && selectedAgent?.name === 'main' && (
                                            <span style={{ fontSize: '0.7rem', fontWeight: 700, background: 'rgba(99,102,241,0.12)', color: 'var(--primary)', padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                Default
                                            </span>
                                        )}
                                        {!isCreating && selectedAgent?.status && <StatusBadge status={selectedAgent.status} />}
                                    </div>
                                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                                        {isCreating ? 'Configure identity and basic routing.' : 'Agent workspace and routing configuration.'}
                                        {!isCreating && selectedAgent?.model && (
                                            <span style={{ color: 'var(--primary)', marginLeft: '0.4rem', fontFamily: 'monospace' }}>
                                                · {selectedAgent.model}
                                                {(selectedAgent.fallbackModels?.length ?? 0) > 0 && ` (+${selectedAgent.fallbackModels!.length} fallback${selectedAgent.fallbackModels!.length > 1 ? 's' : ''})`}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                {!isCreating && selectedAgentName && (
                                    <button
                                        className="btn"
                                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.82rem', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: 'var(--radius-md)' }}
                                        onClick={() => handleDelete(selectedAgentName)}
                                    >
                                        <Trash2 size={13} /> Delete Agent
                                    </button>
                                )}
                            </div>

                            {/* Tab navigation */}
                            <div className="agent-tabs">
                                {TABS.map(tab => (
                                    <button
                                        key={tab.id}
                                        className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                                        onClick={() => setActiveTab(tab.id)}
                                        disabled={isCreating && tab.id !== 'overview'}
                                    >
                                        {tab.icon}
                                        {tab.label}
                                        {tab.badge !== undefined && tab.badge > 0 && (
                                            <span style={{
                                                fontSize: '0.65rem', fontWeight: 700, minWidth: '16px', height: '16px',
                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                background: 'rgba(99,102,241,0.15)', color: 'var(--primary)',
                                                borderRadius: 'var(--radius-full)', padding: '0 0.35rem',
                                            }}>
                                                {tab.badge}
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>

                            {/* Tab content */}
                            <div className="details-content-area p-5" ref={detailsRef}>
                                {activeTab === 'overview' && (
                                    <OverviewTab
                                        formData={formData}
                                        setFormData={setFormData}
                                        models={models}
                                        isCreating={isCreating}
                                        onSave={handleSave}
                                        onReload={fetchAgents}
                                        isSaving={isSaving}
                                    />
                                )}
                                {activeTab === 'files' && (
                                    <FilesTab
                                        agentName={selectedAgentName!}
                                        memory={agentMemory}
                                    />
                                )}
                                {activeTab === 'tools' && (
                                    <ToolsTab agent={formData} />
                                )}
                                {activeTab === 'skills' && (
                                    <SkillsTab availableSkills={availableSkills} agent={formData} />
                                )}
                                {activeTab === 'channels' && (
                                    <ChannelsTab sessions={agentSessions} />
                                )}
                                {activeTab === 'cron' && (
                                    <CronTab
                                        agentName={selectedAgentName!}
                                        jobs={agentJobs}
                                        onRemove={handleRemoveJob}
                                    />
                                )}
                            </div>
                        </>
                    ) : (
                        <EmptyState
                            icon={<Bot size={64} />}
                            title="No Agent Selected"
                            description="Select an agent from the list to view and edit its configuration, or create a new one."
                        />
                    )}
                </div>
            </div>

        </div>
    );
}
