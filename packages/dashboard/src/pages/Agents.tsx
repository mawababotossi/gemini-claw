import { useState, useEffect, useRef } from 'react';
import {
    Bot, RefreshCw, Save, Trash2, Settings, FileText,
    Wrench, Zap, Radio, Calendar, Plus,
    ShieldOff, AlertTriangle, CheckCircle2,
    Clock, GitBranch, Loader2
} from 'lucide-react';
import { api, type AgentConfig } from '../services/api';
import { useProviders, type ProviderMetadata } from '../hooks/useProviders';
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
import { PageHeader } from '../components/PageHeader';

// ─── Small helpers ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
    const map: Record<string, string> = {
        Healthy: 'status-healthy',
        Unresponsive: 'status-warning',
        Restarting: 'status-warning',
        Dead: 'status-danger',
    };
    const statusClass = map[status ?? ''] ?? 'status-unknown';
    return (
        <span className={`status-badge ${statusClass}`}>
            {status ?? 'Unknown'}
        </span>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div className="section-title">
            {children}
        </div>
    );
}

function FormField({
    label, children, hint
}: { label: string; children: React.ReactNode; hint?: string }) {
    return (
        <div className="form-field">
            <label className="form-field-label">
                {label}
            </label>
            {children}
            {hint && <p className="form-field-hint">{hint}</p>}
        </div>
    );
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
    return (
        <div className="empty-state">
            <div className="empty-state-icon">{icon}</div>
            <h3 className="empty-state-title">{title}</h3>
            <p className="empty-state-description">{description}</p>
        </div>
    );
}

// ─── ACP Providers (static — these are CLI binaries, not API providers) ──────

const ACP_PROVIDERS = [
    {
        id: 'gemini',
        label: 'Gemini CLI',
        hint: 'gemini --experimental-acp',
        defaultAuthType: 'gemini-api-key',
        authTypes: ['gemini-api-key', 'oauth-personal', 'vertex-ai'],
    },
    {
        id: 'claude-code',
        label: 'Claude Code',
        hint: 'claude --acp',
        defaultAuthType: 'claude-api-key',
        authTypes: ['claude-api-key'],
    },
    {
        id: 'codex',
        label: 'Codex CLI',
        hint: 'codex --acp',
        defaultAuthType: 'openai-api-key',
        authTypes: ['openai-api-key'],
    },
];

// ─── Tab: Overview ──────────────────────────────────────────────────────────

function OverviewTab({
    formData, setFormData, models, providers, isCreating, onSave, onTriggerHeartbeat, isTriggeringHeartbeat
}: {
    formData: AgentConfig;
    setFormData: (d: AgentConfig) => void;
    models: string[];
    providers: ProviderMetadata[];
    isCreating: boolean;
    onSave: (e: React.FormEvent) => void;
    onTriggerHeartbeat: () => void;
    isTriggeringHeartbeat: boolean;
}) {
    const acpProvider = ACP_PROVIDERS.find(p => p.id === (formData.provider || 'gemini')) ?? ACP_PROVIDERS[0];
    // Filter models from API providers matching the selected ACP provider type
    // e.g. gemini → google provider models, claude-code → anthropic models
    const providerTypeMap: Record<string, string> = { gemini: 'google', 'claude-code': 'anthropic', codex: 'openai' };
    const matchingApiProvider = providers.find(p => p.type === providerTypeMap[acpProvider.id]);
    const availableModels = matchingApiProvider?.models?.length ? matchingApiProvider.models : models;
    const availableAuthTypes = acpProvider.authTypes;

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
            <div className="form-row split-form">
                <FormField label="Agent Name" hint={isCreating ? 'Cannot be changed after creation.' : undefined}>
                    <input
                        className="form-input"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g. main"
                        required
                        disabled={!isCreating}
                    />
                </FormField>
                <FormField label="Agentic Coding Provider" hint={acpProvider.hint}>
                    <select
                        className="form-select"
                        value={formData.provider || 'gemini'}
                        onChange={e => {
                            const pId = e.target.value;
                            const acp = ACP_PROVIDERS.find(p => p.id === pId) ?? ACP_PROVIDERS[0];
                            // Pick models from the matching API provider
                            const pTypeMap: Record<string, string> = { gemini: 'google', 'claude-code': 'anthropic', codex: 'openai' };
                            const matchingApi = providers.find(p => p.type === pTypeMap[pId]);
                            setFormData({
                                ...formData,
                                provider: pId,
                                model: matchingApi?.models?.[0] || '',
                                authType: acp.defaultAuthType as any,
                            });
                        }}
                    >
                        {ACP_PROVIDERS.map(p => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                    </select>
                </FormField>
            </div>
            <FormField label="Base Directory">
                <input
                    className="form-input"
                    value={formData.baseDir ?? ''}
                    onChange={e => setFormData({ ...formData, baseDir: e.target.value })}
                    placeholder="e.g. ./data/agents/main"
                />
            </FormField>

            {/* Models */}
            <SectionTitle>Model Selection</SectionTitle>
            <div className="form-row split-form">
                <FormField label="Primary Model">
                    <select
                        className="form-select"
                        value={formData.model}
                        onChange={e => setFormData({ ...formData, model: e.target.value })}
                        required
                    >
                        <option value="" disabled>Select a model</option>
                        {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </FormField>
                <FormField label="Callback Model (Fallback #1)">
                    <select
                        className="form-select"
                        value={formData.modelCallback ?? ''}
                        onChange={e => setFormData({ ...formData, modelCallback: e.target.value })}
                    >
                        <option value="">None</option>
                        {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
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

            {/* Auth */}
            <SectionTitle>Authentication</SectionTitle>
            <div className="form-row split-form">
                <FormField label="Auth Type">
                    <select
                        className="form-select"
                        value={formData.authType || availableAuthTypes[0]}
                        onChange={e => setFormData({ ...formData, authType: e.target.value as any })}
                    >
                        {availableAuthTypes.map(at => (
                            <option key={at} value={at}>
                                {at === 'oauth-personal' ? 'OAuth (Personal)' :
                                    at === 'gemini-api-key' ? 'Gemini API Key' :
                                        at === 'claude-api-key' ? 'Claude API Key' :
                                            at === 'openai-api-key' ? 'OpenAI API Key' : at}
                            </option>
                        ))}
                    </select>
                </FormField>
                <FormField label="API Key" hint="Optional if set via environment variables.">
                    <input
                        className="form-input"
                        type="password"
                        value={formData.apiKey ?? ''}
                        onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
                        placeholder="Leave empty to use env variable"
                        disabled={formData.authType === 'oauth-personal'}
                    />
                </FormField>
            </div>

            {/* Heartbeat */}
            <SectionTitle>Heartbeat</SectionTitle>
            <div className="form-row split-form">
                <FormField label="Enabled">
                    <div style={{ padding: '0.4rem 0' }}>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.heartbeat?.enabled ?? false}
                                onChange={e => setFormData({ ...formData, heartbeat: { ...(formData.heartbeat ?? {}), enabled: e.target.checked } })}
                                className="permission-checkbox"
                            />
                            <span style={{ fontSize: 'var(--text-sm)' }}>Active</span>
                        </label>
                    </div>
                </FormField>
                <FormField label="Cron Expression" hint="e.g. 0 8,20 * * *">
                    <div className="flex gap-2">
                        <input
                            className="form-input"
                            value={formData.heartbeat?.cron ?? ''}
                            onChange={e => setFormData({ ...formData, heartbeat: { ...(formData.heartbeat ?? {}), enabled: formData.heartbeat?.enabled ?? false, cron: e.target.value } })}
                            placeholder="0 8,20 * * * (UTC)"
                            disabled={!formData.heartbeat?.enabled}
                        />
                        {!isCreating && (
                            <button
                                type="button"
                                className="btn btn-sm btn-outline gap-2"
                                onClick={onTriggerHeartbeat}
                                disabled={isTriggeringHeartbeat || !formData.heartbeat?.enabled}
                                title="Trigger Heartbeat Now"
                            >
                                {isTriggeringHeartbeat ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                                <span className="hide-mobile">Run Now</span>
                            </button>
                        )}
                    </div>
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
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>
                        No permissions granted — agent tools requiring authorization will be blocked.
                    </span>
                </div>
            )}
            <div className="permissions-list">
                {ALL_PERMISSIONS.map(p => {
                    const active = granted.includes(p.id);
                    return (
                        <label key={p.id} className={`permission-item ${active ? 'active' : ''}`}>
                            <input
                                type="checkbox"
                                checked={active}
                                onChange={() => togglePermission(p.id)}
                                className="permission-checkbox"
                            />
                            <div className="permission-info">
                                <span className="permission-name">
                                    {p.label}
                                </span>
                                <span className="permission-desc">{p.desc}</span>
                            </div>
                            {active
                                ? <CheckCircle2 size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                                : <ShieldOff size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, opacity: 0.4 }} />
                            }
                        </label>
                    );
                })}
            </div>

            {/* MCP Servers */}
            <SectionTitle>MCP Servers</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {(formData.mcpServers ?? []).map((srv: any, i: number) => (
                    <div key={i} style={{
                        display: 'grid', gridTemplateColumns: '1fr 90px 1fr auto', gap: '0.5rem',
                        alignItems: 'center',
                        padding: '0.6rem 0.75rem',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                    }}>
                        <input
                            className="form-input"
                            placeholder="name"
                            value={srv.name ?? ''}
                            onChange={e => {
                                const servers = [...(formData.mcpServers ?? [])];
                                servers[i] = { ...servers[i], name: e.target.value };
                                setFormData({ ...formData, mcpServers: servers });
                            }}
                        />
                        <select
                            className="form-select"
                            value={srv.type ?? 'sse'}
                            onChange={e => {
                                const servers = [...(formData.mcpServers ?? [])];
                                servers[i] = { ...servers[i], type: e.target.value };
                                setFormData({ ...formData, mcpServers: servers });
                            }}
                        >
                            <option value="sse">SSE</option>
                            <option value="stdio">stdio</option>
                        </select>
                        <input
                            className="form-input"
                            placeholder="URL or command"
                            value={srv.url ?? ''}
                            onChange={e => {
                                const servers = [...(formData.mcpServers ?? [])];
                                servers[i] = { ...servers[i], url: e.target.value };
                                setFormData({ ...formData, mcpServers: servers });
                            }}
                        />
                        <button
                            type="button"
                            className="btn-icon text-danger"
                            onClick={() => {
                                const servers = (formData.mcpServers ?? []).filter((_: any, j: number) => j !== i);
                                setFormData({ ...formData, mcpServers: servers });
                            }}
                            title="Remove"
                        >
                            <Trash2 size={15} />
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}
                    onClick={() => {
                        const servers = [...(formData.mcpServers ?? []), { name: '', type: 'sse', url: '', headers: [] }];
                        setFormData({ ...formData, mcpServers: servers });
                    }}
                >
                    <Plus size={13} /> Add MCP Server
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
            <div className="tab-content animate-fade-in" style={{ height: '100%', display: 'flex' }}>
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
                            <button className="btn btn-sm btn-outline" onClick={handleSave} disabled={isSaving || isLoading}>
                                {isSaving ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
                            </button>
                        </div>
                        <div className="editor-content-wrapper">
                            {isLoading ? (
                                <div className="empty-state" style={{ height: '100%', opacity: 0.5 }}>
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
                    <div className="empty-state" style={{ height: '100%', opacity: 0.5 }}>
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
            <SectionTitle>MCP Tool Access — clawgate-skills</SectionTitle>
            <p className="text-sm text-muted mb-4">
                Tool access is controlled by <strong>Allowed Permissions</strong> in the Overview tab.
            </p>
            <div className="skills-grid">
                {allTools.map(tool => {
                    const active = granted.includes(tool.id);
                    return (
                        <div key={tool.id} className="skill-row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                            <div className="flex items-center gap-3">
                                {active
                                    ? <CheckCircle2 size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />
                                    : <ShieldOff size={15} style={{ color: 'var(--danger)', flexShrink: 0, opacity: 0.6 }} />
                                }
                                <div>
                                    <span className="permission-name" style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                        {tool.label}
                                    </span>
                                    <span className="permission-desc">{tool.desc}</span>
                                </div>
                            </div>
                            <span className={`status-badge ${active ? 'status-healthy' : 'status-danger'}`}>
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

function SkillsTab({ availableSkills, agent, onToggleSkill }: {
    availableSkills: { native: any[]; project: any[]; prompt: any[] };
    agent: AgentConfig;
    onToggleSkill: (skillName: string, isPrompt?: boolean) => void;
}) {
    const [search, setSearch] = useState('');
    const granted = agent.allowedPermissions ?? [];
    const enabledSkills = agent.skills ?? [];

    const filterSkills = (list: any[]) =>
        list.filter(s => s.name?.toLowerCase().includes(search.toLowerCase()) ||
            s.description?.toLowerCase().includes(search.toLowerCase()));

    const native = filterSkills(availableSkills.native);
    const project = filterSkills(availableSkills.project);
    const prompt = filterSkills(availableSkills.prompt || []);

    const SkillRow = ({ skill, isPrompt }: { skill: any; isPrompt?: boolean }) => {
        const isGranted = isPrompt ? enabledSkills.includes(skill.name) : granted.includes(skill.name);
        // Prompt skills can only be toggled if status is 'enabled'
        // Native/Project skills can always be toggled (they update allowedPermissions)
        const canToggle = !isPrompt || skill.status === 'enabled';

        return (
            <div
                className={`skill-item-interactive ${isGranted ? 'active' : ''} ${!canToggle ? 'disabled' : ''}`}
                onClick={() => canToggle && onToggleSkill(skill.name, isPrompt)}
                style={{
                    padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                    cursor: canToggle ? 'pointer' : 'default',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    overflow: 'hidden',
                    opacity: (!canToggle && !isGranted) ? 0.6 : 1
                }}
            >
                {isGranted && <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: 'var(--primary)' }} />}

                <div style={{
                    width: 32, height: 32, borderRadius: 'var(--radius-sm)', flexShrink: 0,
                    background: isPrompt ? 'rgba(236,72,153,0.1)' : 'rgba(99,102,241,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1rem',
                }}>
                    {skill.icon ?? (isPrompt ? '🦞' : '⚡')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                        <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>{skill.name}</span>
                        <span style={{
                            fontSize: '0.67rem', fontWeight: 700, padding: '0.15rem 0.45rem',
                            borderRadius: 'var(--radius-full)', textTransform: 'uppercase',
                            background: isGranted ? 'rgba(16,185,129,.1)' : (canToggle ? 'rgba(239,68,68,.1)' : 'rgba(156,163,175,.1)'),
                            color: isGranted ? 'var(--success)' : (canToggle ? 'var(--danger)' : 'var(--text-muted)'),
                        }}>
                            {isGranted ? 'Active' : (canToggle ? 'Disabled' : 'Unavailable')}
                        </span>
                        {isPrompt && skill.status !== 'enabled' && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--warning)', fontStyle: 'italic' }}>
                                ({skill.status === 'needs-config' ? 'Needs Config' : 'Needs Install'})
                            </span>
                        )}
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>{skill.description}</p>
                    {isPrompt && skill.status !== 'enabled' && (
                        <p style={{ fontSize: '10px', color: skill.status === 'needs-config' ? 'var(--warning)' : 'var(--danger)', marginTop: '4px', opacity: 0.8 }}>
                            {skill.reason}
                        </p>
                    )}
                </div>
                {canToggle && (
                    <div style={{ alignSelf: 'center' }}>
                        <input
                            type="checkbox"
                            checked={isGranted}
                            onChange={() => { }}
                            className="permission-checkbox"
                            style={{ pointerEvents: 'none' }}
                        />
                    </div>
                )}
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
                    {native.length + project.length + prompt.length} shown
                </span>
            </div>

            {prompt.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                    <SectionTitle>OpenClaw Skills — {prompt.length}</SectionTitle>
                    <p className="text-xs text-muted mb-3">These skills are prompt-driven. Click to enable/disable for this agent.</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {prompt.map(s => <SkillRow key={s.name} skill={s} isPrompt />)}
                    </div>
                </div>
            )}

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
                    <div key={channel} className="mb-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                            <span className="nav-group-label" style={{ padding: 0 }}>
                                {channel}
                            </span>
                            <span className="text-xs text-muted">· {chSessions.length} session{chSessions.length > 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                            {chSessions.map((s: any) => (
                                <div key={s.key ?? s.id} className="skill-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <span className="permission-name" style={{ color: color }}>
                                            {s.key ?? s.peerId ?? s.id}
                                        </span>
                                        {s.label && <span className="permission-desc" style={{ marginLeft: '0.6rem' }}>{s.label}</span>}
                                    </div>
                                    <div className="flex gap-4 text-xs text-muted">
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
            <div className="flex flex-col gap-3">
                {jobs.map((job: any) => (
                    <div key={job.id} className="glass-panel p-4">
                        <div className="flex items-start justify-between mb-2">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-base font-bold text-primary">
                                        {job.name ?? job.id}
                                    </span>
                                    {job.status && (
                                        <span className={`status-badge ${STATUS_COLOR[job.status] ? 'status-' + job.status : 'status-unknown'}`}>
                                            {job.status}
                                        </span>
                                    )}
                                </div>
                                <code className="monospace px-2 py-0.5 rounded text-xs bg-primary-dim text-primary">
                                    {job.cron}
                                </code>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    className="btn btn-sm btn-danger"
                                    onClick={() => onRemove(job.id)}
                                >
                                    <Trash2 size={12} /> Remove
                                </button>
                            </div>
                        </div>
                        {job.prompt && (
                            <p className="monospace text-xs text-muted p-3 rounded bg-dark" style={{ lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                {job.prompt}
                            </p>
                        )}
                        {(job.next || job.last) && (
                            <div className="flex gap-4 mt-3">
                                {job.next && (
                                    <div className="flex items-center gap-1.5 text-xs text-muted">
                                        <Clock size={11} className="text-success" />
                                        Next: <span className="text-secondary">{job.next}</span>
                                    </div>
                                )}
                                {job.last && (
                                    <div className="flex items-center gap-1.5 text-xs text-muted">
                                        <GitBranch size={11} />
                                        Last: <span className="text-secondary">{job.last}</span>
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
    const [availableSkills, setAvailableSkills] = useState<{ native: any[]; project: any[]; prompt: any[] }>({ native: [], project: [], prompt: [] });
    const [agentJobs, setAgentJobs] = useState<any[]>([]);
    const [agentMemory, setAgentMemory] = useState<any[]>([]);
    const [agentSessions, setAgentSessions] = useState<any[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [isTriggeringHeartbeat, setIsTriggeringHeartbeat] = useState(false);
    const { providers } = useProviders();
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
        const defaultProvider = providers[0]?.id || 'gemini';
        const defaultModel = providers[0]?.models?.[0] || 'gemini-2.0-flash';
        const defaultAuth = providers[0]?.authType?.[0] || 'oauth-personal';

        setSelectedAgentName(null);
        setIsCreating(true);
        setActiveTab('overview');
        setFormData({
            name: '',
            provider: defaultProvider,
            model: defaultModel,
            modelCallback: '',
            fallbackModels: [],
            allowedPermissions: [],
            skills: [],
            authType: defaultAuth
        });
    };

    const handleTriggerHeartbeat = async () => {
        if (!selectedAgentName || isTriggeringHeartbeat) return;
        setIsTriggeringHeartbeat(true);
        try {
            const result = await api.triggerAgentHeartbeat(selectedAgentName);
            if (result.success) {
                // We could show a toast here if we had a toast system
                console.log('Heartbeat triggered successfully:', result.message);
                alert(result.message); // Simple alert for now as fallback
            } else {
                alert(`Heartbeat failed: ${result.message}`);
            }
        } catch (err: any) {
            console.error('Failed to trigger heartbeat', err);
            alert(`Error triggering heartbeat: ${err.message}`);
        } finally {
            setIsTriggeringHeartbeat(false);
        }
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
        <div className="agents-page">
            <PageHeader
                title="AI Agents"
                description="Manage your AI personas, identities, and operational capabilities."
                actions={
                    <button className="btn btn-primary" onClick={handleCreateNew}>
                        <Plus size={16} /> Create Agent
                    </button>
                }
            />

            {/* ── Split layout ─────────────────────────────── */}
            <div className="agents-split-layout">

                {/* Left: agent list */}
                <div className="agents-navigation glass-panel">
                    <div className="nav-header p-4 border-b">
                        <SectionTitle>All Agents — {agents.length}</SectionTitle>
                    </div>

                    <div className="agents-list">
                        {isLoading ? (
                            <div className="flex justify-center p-6">
                                <Loader2 className="animate-spin text-muted" size={24} />
                            </div>
                        ) : (
                            agents.map(agent => (
                                <div
                                    key={agent.name}
                                    className={`agent-nav-item ${selectedAgentName === agent.name && !isCreating ? 'active' : ''}`}
                                    onClick={() => handleSelectAgent(agent.name)}
                                >
                                    <div className="agent-avatar bg-primary-dim text-primary font-bold">
                                        {agent.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="agent-nav-info overflow-hidden">
                                        <h4 className="truncate">{agent.name}</h4>
                                        <span className="text-xs truncate text-muted monospace">{agent.model}</span>
                                    </div>
                                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                        {agent.name === 'main' && (
                                            <span className="badge-bool" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--primary)' }}>
                                                Default
                                            </span>
                                        )}
                                        <StatusBadge status={agent.status} />
                                    </div>
                                </div>
                            ))
                        )}

                        {isCreating && (
                            <div className="agent-nav-item active creating">
                                <div className="agent-avatar bg-accent-dim text-success">
                                    <Plus size={18} />
                                </div>
                                <div className="agent-nav-info">
                                    <h4>New Agent</h4>
                                    <span className="text-xs text-muted">Configuring...</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: detail panel */}
                <div className="agent-details-panel glass-panel">
                    {(selectedAgentName || isCreating) && formData ? (
                        <>
                            {/* Detail Panel Header */}
                            <div className="nav-header p-4 flex justify-between items-end border-b" style={{ background: 'rgba(0,0,0,0.1)' }}>
                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, margin: 0 }}>
                                            {isCreating ? 'Create New Agent' : selectedAgentName}
                                        </h2>
                                        {!isCreating && selectedAgent?.name === 'main' && (
                                            <span className="badge-bool" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--primary)' }}>
                                                Default Agent
                                            </span>
                                        )}
                                        {!isCreating && <StatusBadge status={selectedAgent?.status} />}
                                    </div>
                                    <p className="text-sm text-muted">
                                        {isCreating ? 'Configure identity and basic routing.' : 'Agent workspace and routing configuration.'}
                                        {!isCreating && selectedAgent?.model && (
                                            <span className="text-primary ml-2 monospace">
                                                · {selectedAgent.model}
                                                {(selectedAgent.fallbackModels?.length ?? 0) > 0 && ` (+${selectedAgent.fallbackModels!.length} fallback${selectedAgent.fallbackModels!.length > 1 ? 's' : ''})`}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button className="btn btn-sm btn-outline" onClick={fetchAgents} disabled={isSaving}>
                                        <RefreshCw size={13} className={isSaving ? "animate-spin" : ""} />
                                    </button>
                                    <button
                                        className="btn btn-sm btn-primary gap-2"
                                        onClick={handleSave}
                                        disabled={isSaving}
                                    >
                                        {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                                        {isCreating ? 'Create' : 'Save'}
                                    </button>
                                    {!isCreating && selectedAgentName && (
                                        <button
                                            className="btn btn-sm btn-ghost text-danger p-2"
                                            onClick={() => handleDelete(selectedAgentName)}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Tab navigation */}
                            <div className="agent-tabs">
                                {TABS.map(tab => (
                                    <button
                                        key={tab.id}
                                        className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                                        onClick={() => setActiveTab(tab.id as TabType)}
                                        disabled={isCreating && tab.id !== 'overview'}
                                    >
                                        <span className="flex items-center gap-2">
                                            {tab.icon}
                                            <span>{tab.label}</span>
                                            {tab.badge !== undefined && tab.badge > 0 && (
                                                <span className="badge-bool" style={{ padding: '0 0.35rem', minWidth: '1.2rem' }}>
                                                    {tab.badge}
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                ))}
                            </div>

                            {/* Tab content */}
                            <div className="details-content-area p-5" ref={detailsRef}>
                                {activeTab === 'overview' && (
                                    <OverviewTab
                                        formData={formData!}
                                        setFormData={setFormData}
                                        models={models}
                                        providers={providers}
                                        isCreating={isCreating}
                                        onSave={handleSave}
                                        onTriggerHeartbeat={handleTriggerHeartbeat}
                                        isTriggeringHeartbeat={isTriggeringHeartbeat}
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
                                {activeTab === 'skills' && formData && (
                                    <SkillsTab
                                        availableSkills={availableSkills}
                                        agent={formData}
                                        onToggleSkill={(skillName, isPrompt) => {
                                            if (isPrompt) {
                                                const current = formData.skills ?? [];
                                                const next = current.includes(skillName)
                                                    ? current.filter(s => s !== skillName)
                                                    : [...current, skillName];
                                                setFormData({ ...formData, skills: next });
                                            } else {
                                                const current = formData.allowedPermissions ?? [];
                                                const next = current.includes(skillName)
                                                    ? current.filter(p => p !== skillName)
                                                    : [...current, skillName];
                                                setFormData({ ...formData, allowedPermissions: next });
                                            }
                                        }}
                                    />
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
