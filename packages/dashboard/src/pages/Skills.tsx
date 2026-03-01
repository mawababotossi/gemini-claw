/**
 * @license Apache-2.0
 * GeminiClaw Dashboard — Skills Page (Refonte v2)
 *
 * Changements majeurs vs v1 :
 * - Vue unifiée : native / prompt / mcp dans un seul flux de liste
 * - Scoping par agent : filtre par agent sélectionné
 * - Désactivation manuelle (toggle) via POST /api/skills/:name/disable|enable
 * - Assignation skill ↔ agent via PATCH /api/agents/:name/skills
 * - Badge "assigned" par agent
 * - Modale de config enrichie (affiche les binaires manquants + liens)
 * - Compteurs par catégorie dans les accordion headers
 * - Recherche unifiée cross-catégories
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../services/api';
import type { AgentConfig, SkillManifest } from '../services/api';
import {
    RefreshCw, Wrench, Terminal, Puzzle,
    CheckCircle2, AlertCircle, XCircle,
    Settings, X, Save, ChevronDown, ChevronRight,
    Power, PowerOff, Download, Search, Bot, Link
} from 'lucide-react';
import './Skills.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KIND_META: Record<SkillManifest['kind'], { label: string; icon: React.ReactNode; color: string }> = {
    native: { label: 'Native', icon: <Wrench size={11} />, color: 'var(--primary)' },
    mcp: { label: 'MCP', icon: <Puzzle size={11} />, color: 'var(--accent)' },
    prompt: { label: 'Prompt', icon: <Terminal size={11} />, color: '#a78bfa' },
};

const STATUS_META: Record<SkillManifest['status'], { label: string; color: string; icon: React.ReactNode }> = {
    enabled: { label: 'Eligible', color: 'var(--success)', icon: <CheckCircle2 size={12} /> },
    disabled: { label: 'Blocked', color: 'var(--danger)', icon: <XCircle size={12} /> },
    'needs-config': { label: 'Needs Config', color: 'var(--warning)', icon: <AlertCircle size={12} /> },
    'needs-install': { label: 'Needs Install', color: '#f97316', icon: <Download size={12} /> },
};

function kindIcon(kind: SkillManifest['kind']) {
    const m = KIND_META[kind];
    return (
        <span className="skill-kind-badge" style={{ '--kind-color': m.color } as React.CSSProperties}>
            {m.icon} {m.label}
        </span>
    );
}

function statusBadge(status: SkillManifest['status']) {
    const m = STATUS_META[status];
    return (
        <span className="skill-status-badge" style={{ '--status-color': m.color } as React.CSSProperties}>
            {m.icon} {m.label}
        </span>
    );
}

// ─── Accordion Section ────────────────────────────────────────────────────────

function SkillSection({
    title, icon, count, defaultOpen = true, children
}: {
    title: string;
    icon: React.ReactNode;
    count: number;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="skill-section">
            <button className="skill-section-header" onClick={() => setOpen(o => !o)}>
                <span className="skill-section-icon">{icon}</span>
                <span className="skill-section-title">{title}</span>
                <span className="skill-section-count">{count}</span>
                <span className="skill-section-chevron">
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
            </button>
            {open && <div className="skill-section-body">{children}</div>}
        </div>
    );
}

// ─── Skill Row ────────────────────────────────────────────────────────────────

interface SkillRowProps {
    skill: SkillManifest;
    agents: AgentConfig[];
    selectedAgent: string | null;
    onConfigure: (skill: SkillManifest) => void;
    onInstall: (name: string) => void;
    onToggleDisable: (name: string, currentlyDisabled: boolean) => void;
    onToggleAssign: (skillName: string, agentName: string, currentlyAssigned: boolean) => void;
    isInstalling: boolean;
}

function SkillRow({
    skill, agents, selectedAgent, onConfigure, onInstall,
    onToggleDisable, onToggleAssign, isInstalling
}: SkillRowProps) {
    const [expanded, setExpanded] = useState(false);

    const effectiveStatus: SkillManifest['status'] = skill.manuallyDisabled ? 'disabled' : skill.status;
    const isBlocked = effectiveStatus === 'disabled' || effectiveStatus === 'needs-config' || effectiveStatus === 'needs-install';

    // Check if assigned to the currently-filtered agent
    const isAssigned = selectedAgent
        ? (skill.assignedAgents ?? []).includes(selectedAgent)
        : false;

    const showAssignToggle = selectedAgent && skill.kind !== 'native';

    return (
        <div className={`skill-row ${isBlocked ? 'skill-row--blocked' : ''} ${isAssigned ? 'skill-row--assigned' : ''}`}>
            {/* Accent bar for assigned skills */}
            {isAssigned && <div className="skill-row-accent" />}

            <div className="skill-row-main" onClick={() => setExpanded(e => !e)}>
                {/* Icon */}
                <div className="skill-row-icon" style={{
                    background: isBlocked ? 'rgba(255,255,255,0.04)' : `${KIND_META[skill.kind].color}18`
                }}>
                    <span style={{ fontSize: '1rem' }}>{skill.icon || (skill.kind === 'native' ? '🛠️' : skill.kind === 'mcp' ? '🔌' : '📖')}</span>
                </div>

                {/* Info */}
                <div className="skill-row-info">
                    <div className="skill-row-nameline">
                        <span className="skill-row-name">{skill.name}</span>
                        {kindIcon(skill.kind)}
                        {statusBadge(effectiveStatus)}
                        {isAssigned && selectedAgent && (
                            <span className="skill-assigned-tag">
                                <Bot size={10} /> {selectedAgent}
                            </span>
                        )}
                    </div>
                    <p className="skill-row-desc">{skill.description}</p>
                    {/* Missing deps inline */}
                    {(skill.missingEnv?.length ?? 0) > 0 && (
                        <p className="skill-row-missing">
                            Missing env: {skill.missingEnv!.map(k => <code key={k}>{k}</code>)}
                        </p>
                    )}
                    {(skill.missingBins?.length ?? 0) > 0 && (
                        <p className="skill-row-missing">
                            Missing binaries: {skill.missingBins!.map(b => <code key={b}>{b}</code>)}
                        </p>
                    )}
                </div>

                {/* Actions */}
                <div className="skill-row-actions" onClick={e => e.stopPropagation()}>
                    {/* Assign to agent toggle */}
                    {showAssignToggle && effectiveStatus === 'enabled' && (
                        <button
                            className={`btn btn-xs ${isAssigned ? 'btn-outline' : 'btn-primary'}`}
                            onClick={() => onToggleAssign(skill.name, selectedAgent!, isAssigned)}
                            title={isAssigned ? `Remove from ${selectedAgent}` : `Assign to ${selectedAgent}`}
                        >
                            <Bot size={11} />
                            {isAssigned ? 'Unassign' : 'Assign'}
                        </button>
                    )}

                    {/* Config button */}
                    {effectiveStatus === 'needs-config' && (
                        <button className="btn btn-xs btn-warning" onClick={() => onConfigure(skill)}>
                            <Settings size={11} /> Configure
                        </button>
                    )}

                    {/* Install button */}
                    {effectiveStatus === 'needs-install' && (
                        <button
                            className="btn btn-xs btn-primary"
                            onClick={() => onInstall(skill.name)}
                            disabled={isInstalling}
                        >
                            {isInstalling ? <RefreshCw size={11} className="spin" /> : <Download size={11} />}
                            Install
                        </button>
                    )}

                    {/* Enable / Disable manual toggle (only for enabled or manually disabled) */}
                    {(effectiveStatus === 'enabled' || skill.manuallyDisabled) && skill.kind !== 'native' && (
                        <button
                            className={`btn btn-xs ${skill.manuallyDisabled ? 'btn-success' : 'btn-ghost btn-danger'}`}
                            onClick={() => onToggleDisable(skill.name, !!skill.manuallyDisabled)}
                            title={skill.manuallyDisabled ? 'Re-enable skill' : 'Disable skill'}
                        >
                            {skill.manuallyDisabled ? <Power size={11} /> : <PowerOff size={11} />}
                            {skill.manuallyDisabled ? 'Enable' : 'Disable'}
                        </button>
                    )}

                    {/* Expand chevron */}
                    <button className="btn btn-xs btn-ghost" onClick={() => setExpanded(e => !e)}>
                        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                </div>
            </div>

            {/* Expanded detail */}
            {expanded && (
                <div className="skill-row-detail">
                    {/* Assigned agents list */}
                    {(skill.assignedAgents?.length ?? 0) > 0 && (
                        <div className="skill-detail-block">
                            <span className="skill-detail-label">Assigned to</span>
                            <div className="skill-detail-tags">
                                {skill.assignedAgents!.map(a => (
                                    <span key={a} className="skill-agent-chip">
                                        <Bot size={10} /> {a}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Required env vars (even if present) */}
                    {(skill.requiredEnv?.length ?? 0) > 0 && (
                        <div className="skill-detail-block">
                            <span className="skill-detail-label">Environment variables</span>
                            <div className="skill-env-list">
                                {skill.requiredEnv!.map(e => (
                                    <div key={e.key} className="skill-env-row">
                                        <code className={`skill-env-key ${skill.missingEnv?.includes(e.key) ? 'missing' : 'present'}`}>
                                            {e.key}
                                        </code>
                                        {e.description && <span className="skill-env-desc">{e.description}</span>}
                                        {e.url && (
                                            <a href={e.url} target="_blank" rel="noopener noreferrer" className="skill-env-link">
                                                <Link size={10} /> Get key
                                            </a>
                                        )}
                                        <span className={`skill-env-status ${skill.missingEnv?.includes(e.key) ? 'missing' : 'ok'}`}>
                                            {skill.missingEnv?.includes(e.key) ? '✗ missing' : '✓ set'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* MCP parameters */}
                    {skill.parameters && (
                        <div className="skill-detail-block">
                            <span className="skill-detail-label">Parameters</span>
                            <pre className="skill-detail-json">
                                {JSON.stringify(skill.parameters, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Config Modal ─────────────────────────────────────────────────────────────

function ConfigModal({
    skill,
    onClose,
    onSave,
    isSaving
}: {
    skill: SkillManifest;
    onClose: () => void;
    onSave: (envVars: Record<string, string>) => void;
    isSaving: boolean;
}) {
    const [envVars, setEnvVars] = useState<Record<string, string>>(() => {
        const init: Record<string, string> = {};
        skill.requiredEnv?.forEach(e => { init[e.key] = ''; });
        return init;
    });

    const allFilled = skill.requiredEnv?.every(e => envVars[e.key]?.trim()) ?? true;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-card" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="modal-title-group">
                        <Settings size={16} className="text-warning" />
                        <span>Configure <strong>{skill.name}</strong></span>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
                </div>

                <div className="modal-body">
                    <p className="modal-hint">
                        Enter the required API keys and environment variables.
                        These will be saved to your <code>.env</code> file and applied immediately.
                    </p>

                    {skill.requiredEnv?.map(env => (
                        <div key={env.key} className="modal-field">
                            <label className="modal-field-label">
                                <span>{env.key}</span>
                                {env.url && (
                                    <a href={env.url} target="_blank" rel="noopener noreferrer" className="modal-get-key">
                                        <Link size={10} /> Get key
                                    </a>
                                )}
                            </label>
                            {env.description && <p className="modal-field-desc">{env.description}</p>}
                            <input
                                type={env.secret !== false ? 'password' : 'text'}
                                className="form-input"
                                placeholder={`Enter ${env.key}...`}
                                value={envVars[env.key] ?? ''}
                                onChange={e => setEnvVars(v => ({ ...v, [env.key]: e.target.value }))}
                                autoComplete="off"
                            />
                        </div>
                    ))}
                </div>

                <div className="modal-footer">
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button
                        className="btn btn-primary"
                        onClick={() => onSave(envVars)}
                        disabled={!allFilled || isSaving}
                    >
                        {isSaving ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}
                        Save & Apply
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Install Result Toast ──────────────────────────────────────────────────────

function InstallToast({ result, onClose }: {
    result: { name: string; success: boolean; output: string };
    onClose: () => void;
}) {
    return (
        <div className={`install-toast ${result.success ? 'success' : 'error'}`}>
            <div className="install-toast-header">
                {result.success
                    ? <CheckCircle2 size={16} className="text-success" />
                    : <XCircle size={16} className="text-danger" />}
                <span>{result.success ? 'Installed' : 'Failed'}: <strong>{result.name}</strong></span>
                <button className="btn btn-xs btn-ghost ml-auto" onClick={onClose}><X size={14} /></button>
            </div>
            <pre className="install-toast-output">{result.output}</pre>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Skills() {
    // Data
    const [manifests, setManifests] = useState<SkillManifest[]>([]);
    const [agents, setAgents] = useState<AgentConfig[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Filters
    const [search, setSearch] = useState('');
    const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

    // UI state
    const [isInstalling, setIsInstalling] = useState<string | null>(null);
    const [installResult, setInstallResult] = useState<{ name: string; success: boolean; output: string } | null>(null);
    const [configSkill, setConfigSkill] = useState<SkillManifest | null>(null);
    const [isConfiguring, setIsConfiguring] = useState(false);

    // ── Fetch ──────────────────────────────────────────────────────────────────

    const fetchAll = useCallback(async () => {
        setIsLoading(true);
        try {
            const [skillsData, agentsData] = await Promise.all([
                api.getSkillManifests(selectedAgent ?? undefined),
                api.getAgents(),
            ]);
            setManifests(skillsData);
            setAgents(agentsData);
        } catch (err) {
            console.error('Failed to fetch skills/agents', err);
        } finally {
            setIsLoading(false);
        }
    }, [selectedAgent]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // ── Filtered / grouped ────────────────────────────────────────────────────

    const { native, mcp, prompt } = useMemo(() => {
        const q = search.toLowerCase().trim();
        const filtered = manifests.filter(s =>
            !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
        );
        return {
            native: filtered.filter(s => s.kind === 'native'),
            mcp: filtered.filter(s => s.kind === 'mcp'),
            prompt: filtered.filter(s => s.kind === 'prompt'),
        };
    }, [manifests, search]);

    const totalVisible = native.length + mcp.length + prompt.length;

    // ── Handlers ──────────────────────────────────────────────────────────────

    const handleInstall = async (name: string) => {
        setIsInstalling(name);
        setInstallResult(null);
        try {
            const result = await api.installSkill(name);
            setInstallResult({ name, ...result });
            if (result.success) await fetchAll();
        } catch (err: any) {
            setInstallResult({ name, success: false, output: err.message });
        } finally {
            setIsInstalling(null);
        }
    };

    const handleSaveConfig = async (envVars: Record<string, string>) => {
        if (!configSkill) return;
        setIsConfiguring(true);
        try {
            await api.configureSkill(configSkill.name, envVars);
            setConfigSkill(null);
            await fetchAll();
        } catch (err) {
            console.error('Failed to configure skill', err);
        } finally {
            setIsConfiguring(false);
        }
    };

    const handleToggleDisable = async (name: string, currentlyDisabled: boolean) => {
        try {
            if (currentlyDisabled) {
                await api.enableSkill(name);
            } else {
                await api.disableSkill(name);
            }
            // Optimistic update
            setManifests(prev => prev.map(s =>
                s.name === name ? { ...s, manuallyDisabled: !currentlyDisabled } : s
            ));
        } catch (err) {
            console.error('Failed to toggle skill', err);
            await fetchAll(); // rollback
        }
    };

    const handleToggleAssign = async (skillName: string, agentName: string, currentlyAssigned: boolean) => {
        // Get current agent skills
        const agent = agents.find(a => a.name === agentName);
        if (!agent) return;
        const current = agent.skills ?? [];
        const updated = currentlyAssigned
            ? current.filter(s => s !== skillName)
            : [...current, skillName];
        try {
            await api.updateAgentSkills(agentName, updated);
            // Optimistic update on manifests
            setManifests(prev => prev.map(s => {
                if (s.name !== skillName) return s;
                const assigned = s.assignedAgents ?? [];
                return {
                    ...s,
                    assignedAgents: currentlyAssigned
                        ? assigned.filter(a => a !== agentName)
                        : [...assigned, agentName]
                };
            }));
            // Also update local agents
            setAgents(prev => prev.map(a =>
                a.name === agentName ? { ...a, skills: updated } : a
            ));
        } catch (err) {
            console.error('Failed to update agent skills', err);
            await fetchAll();
        }
    };

    const rowProps = (skill: SkillManifest) => ({
        skill,
        agents,
        selectedAgent,
        onConfigure: setConfigSkill,
        onInstall: handleInstall,
        onToggleDisable: handleToggleDisable,
        onToggleAssign: handleToggleAssign,
        isInstalling: isInstalling === skill.name,
    });

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <div className="page-container skills-page">
            {/* Header */}
            <div className="skills-header">
                <div>
                    <h1 className="skills-title">Skills & Tools</h1>
                    <p className="skills-subtitle">Manage skill availability and API key injection.</p>
                </div>
                <button className="btn btn-outline btn-sm" onClick={fetchAll} disabled={isLoading}>
                    <RefreshCw size={14} className={isLoading ? 'spin' : ''} />
                    Refresh
                </button>
            </div>

            {/* Toolbar */}
            <div className="skills-toolbar">
                {/* Search */}
                <div className="skills-search-wrap">
                    <Search size={14} className="skills-search-icon" />
                    <input
                        className="skills-search"
                        placeholder="Search skills..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                    {search && (
                        <button className="skills-search-clear" onClick={() => setSearch('')}>
                            <X size={12} />
                        </button>
                    )}
                </div>

                {/* Agent filter */}
                <div className="skills-agent-filter">
                    <Bot size={14} className="text-muted" />
                    <select
                        className="form-select"
                        value={selectedAgent ?? ''}
                        onChange={e => setSelectedAgent(e.target.value || null)}
                    >
                        <option value="">All agents</option>
                        {agents.map(a => (
                            <option key={a.name} value={a.name}>{a.name}</option>
                        ))}
                    </select>
                </div>

                {/* Count */}
                <span className="skills-count">
                    {totalVisible} skill{totalVisible !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Install result */}
            {installResult && (
                <InstallToast result={installResult} onClose={() => setInstallResult(null)} />
            )}

            {/* Content */}
            {isLoading ? (
                <div className="skills-loading">
                    <RefreshCw size={32} className="spin text-primary" />
                </div>
            ) : (
                <div className="skills-list">

                    {/* Prompt Skills (OpenClaw / SKILL.md) */}
                    {prompt.length > 0 && (
                        <SkillSection
                            title="Prompt Skills"
                            icon={<Terminal size={16} />}
                            count={prompt.length}
                            defaultOpen
                        >
                            <p className="skill-section-desc">
                                Prompt-driven instructions injected into the agent's system prompt.
                                Assign them per agent to control which skills each agent can use.
                            </p>
                            {prompt.map(s => <SkillRow key={s.name} {...rowProps(s)} />)}
                        </SkillSection>
                    )}

                    {/* MCP / Project Skills */}
                    {mcp.length > 0 && (
                        <SkillSection
                            title="MCP Skills"
                            icon={<Puzzle size={16} />}
                            count={mcp.length}
                            defaultOpen
                        >
                            <p className="skill-section-desc">
                                JavaScript functions exposed as MCP tools. Callable by the agent during ReAct loops.
                            </p>
                            {mcp.map(s => <SkillRow key={s.name} {...rowProps(s)} />)}
                        </SkillSection>
                    )}

                    {/* Native Tools */}
                    {native.length > 0 && (
                        <SkillSection
                            title="Native Tools"
                            icon={<Wrench size={16} />}
                            count={native.length}
                            defaultOpen={false}
                        >
                            <p className="skill-section-desc">
                                Built-in tools provided by the Gemini CLI core runtime. Always available, not configurable.
                            </p>
                            {native.map(s => <SkillRow key={s.name} {...rowProps(s)} />)}
                        </SkillSection>
                    )}

                    {totalVisible === 0 && (
                        <div className="skills-empty">
                            <Search size={32} className="skills-empty-icon" />
                            <p>No skills match your search.</p>
                            <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear search</button>
                        </div>
                    )}
                </div>
            )}

            {/* Config Modal */}
            {configSkill && (
                <ConfigModal
                    skill={configSkill}
                    onClose={() => setConfigSkill(null)}
                    onSave={handleSaveConfig}
                    isSaving={isConfiguring}
                />
            )}
        </div>
    );
}
