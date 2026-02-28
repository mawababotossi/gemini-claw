import { useState, useEffect } from 'react';
import { Bot, RefreshCw, Edit2, Plus, X, Save, Trash2, Calendar, History, FileText } from 'lucide-react';
import { api, type AgentConfig } from '../services/api';
import './Agents.css';

export function Agents() {
    const [agents, setAgents] = useState<AgentConfig[]>([]);
    const [models, setModels] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
    const [formData, setFormData] = useState<AgentConfig>({
        name: '',
        model: 'gemini-2.0-flash',
        modelCallback: 'gemini-1.5-flash',
        fallbackModels: ['gemini-1.5-pro'],
        allowedPermissions: []
    });
    const [availableSkills, setAvailableSkills] = useState<{ native: any[], project: any[] }>({ native: [], project: [] });

    const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
    const [agentJobs, setAgentJobs] = useState<any[]>([]);
    const [agentMemory, setAgentMemory] = useState<any[]>([]);
    const [viewingJournal, setViewingJournal] = useState<{ name: string, content: string } | null>(null);

    const fetchAgents = async () => {
        try {
            setIsLoading(true);
            const data = await api.getAgents();
            setAgents(data);
        } catch (err) {
            console.error('Failed to fetch agents', err);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchModels = async () => {
        try {
            const data = await api.getModels();
            setModels(data);
        } catch (err) {
            console.error('Failed to fetch models', err);
        }
    };

    const fetchSkills = async () => {
        try {
            const data = await api.getSkills();
            setAvailableSkills(data);
        } catch (err) {
            console.error('Failed to fetch skills', err);
        }
    };

    useEffect(() => {
        fetchAgents();
        fetchModels();
        fetchSkills();
    }, []);

    const handleOpenModal = (agent?: AgentConfig) => {
        if (agent) {
            setEditingAgent(agent);
            setFormData({ ...agent });
        } else {
            setEditingAgent(null);
            setFormData({
                name: '',
                model: 'gemini-2.0-flash',
                modelCallback: 'gemini-1.5-flash',
                fallbackModels: ['gemini-1.5-pro'],
                allowedPermissions: []
            });
        }
        setIsModalOpen(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingAgent) {
                await api.updateAgent(editingAgent.name, formData);
            } else {
                await api.createAgent(formData);
            }
            setIsModalOpen(false);
            fetchAgents();
        } catch (err: any) {
            const msg = err.response?.data?.error || err.message || 'Failed to save agent';
            alert(`Error: ${msg}`);
        }
    };

    const handleDelete = async (name: string) => {
        if (!confirm(`Are you sure you want to delete agent "${name}"?`)) return;
        try {
            await api.deleteAgent(name);
            fetchAgents();
        } catch (err: any) {
            const msg = err.response?.data?.error || err.message || 'Failed to delete agent';
            alert(`Error: ${msg}`);
        }
    };

    const toggleExpand = async (name: string) => {
        if (expandedAgent === name) {
            setExpandedAgent(null);
            return;
        }
        setExpandedAgent(name);
        setAgentJobs([]);
        setAgentMemory([]);
        try {
            const [jobs, memory] = await Promise.all([
                api.getAgentJobs(name),
                api.getAgentMemory(name)
            ]);
            setAgentJobs(jobs);
            setAgentMemory(memory);
        } catch (err) {
            console.error('Failed to fetch agent details', err);
        }
    };

    const handleViewJournal = async (agentName: string, filename: string) => {
        try {
            const content = await api.getAgentMemoryContent(agentName, filename);
            setViewingJournal({ name: filename, content });
        } catch (err) {
            alert('Failed to load journal content');
        }
    };

    const removeJob = async (agentName: string, jobId: string) => {
        if (!confirm('Remove this scheduled task?')) return;
        try {
            await api.deleteAgentJob(agentName, jobId);
            const jobs = await api.getAgentJobs(agentName);
            setAgentJobs(jobs);
        } catch (err) {
            alert('Failed to remove job');
        }
    };

    return (
        <div className="page-container">
            <div className="page-header flex justify-between items-center">
                <div>
                    <h1>Agents Configuration</h1>
                    <p>Manage your AI agents and their capabilities.</p>
                </div>
                <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                    <Plus size={18} /> New Agent
                </button>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-20">
                    <RefreshCw className="animate-spin text-primary" size={40} />
                </div>
            ) : (
                <div className="agents-grid">
                    {agents.map((agent) => (
                        <div key={agent.name} className={`agent-card glass-card ${expandedAgent === agent.name ? 'expanded' : ''}`}>
                            <div className="agent-header flex justify-between items-center">
                                <div className="flex items-center gap-4 cursor-pointer" onClick={() => toggleExpand(agent.name)}>
                                    <div className="status-indicator-ring active">
                                        <Bot size={24} />
                                    </div>
                                    <div>
                                        <h3>{agent.name}</h3>
                                        <span className="status-badge active">Active</span>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button className="icon-btn" onClick={() => handleOpenModal(agent)}>
                                        <Edit2 size={16} />
                                    </button>
                                    <button className="icon-btn text-danger" onClick={() => handleDelete(agent.name)}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>

                            <div className="agent-body">
                                <div className="info-row">
                                    <span className="label">Model</span>
                                    <span className="value">{agent.model}</span>
                                </div>
                                <div className="info-row">
                                    <span className="label">Location</span>
                                    <span className="value text-sm text-muted" title={agent.baseDir}>{agent.baseDir}</span>
                                </div>
                                <div className="info-row">
                                    <span className="label">Capabilities</span>
                                    <div className="skills-list">
                                        {agent.allowedPermissions?.length ? agent.allowedPermissions.map(perm => {
                                            const isNative = availableSkills.native.some(s => s.name === perm);
                                            return (
                                                <span key={perm} className={`skill-chip ${isNative ? 'native' : 'project'}`}>
                                                    {isNative ? '🛠️' : '🧩'} {perm}
                                                </span>
                                            );
                                        }) : <span className="text-muted">No skills enabled</span>}
                                    </div>
                                </div>

                                {expandedAgent === agent.name && (
                                    <div className="agent-details-sections mt-4 animate-fade-in">
                                        <div className="details-section">
                                            <h4><Calendar size={14} className="inline mr-1" /> Scheduled Tasks (Cron)</h4>
                                            <div className="jobs-list">
                                                {agentJobs.length > 0 ? agentJobs.map(job => (
                                                    <div key={job.id} className="job-item flex justify-between items-center">
                                                        <div>
                                                            <code className="text-xs">{job.cron}</code>
                                                            <p className="text-sm truncate" style={{ maxWidth: '200px' }}>{job.prompt}</p>
                                                        </div>
                                                        <button className="icon-btn text-danger" onClick={() => removeJob(agent.name, job.id)}>
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                )) : <p className="text-muted text-sm">No active tasks.</p>}
                                            </div>
                                        </div>

                                        <div className="details-section mt-4">
                                            <h4><History size={14} className="inline mr-1" /> Daily Memory Journals</h4>
                                            <div className="journals-list">
                                                {agentMemory.length > 0 ? agentMemory.map(file => (
                                                    <div key={file.name} className="journal-item flex justify-between items-center cursor-pointer" onClick={() => handleViewJournal(agent.name, file.name)}>
                                                        <div className="flex items-center gap-2">
                                                            <FileText size={14} />
                                                            <span className="text-sm">{file.name}</span>
                                                        </div>
                                                        <span className="text-xs text-muted">{(file.size / 1024).toFixed(1)} KB</span>
                                                    </div>
                                                )) : <p className="text-muted text-sm">No journals recorded.</p>}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="agent-footer flex justify-between items-center">
                                <button className="btn btn-outline" onClick={() => toggleExpand(agent.name)} style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}>
                                    {expandedAgent === agent.name ? 'Hide Details' : 'Show Details'}
                                </button>
                                <span className="text-muted text-sm">Persistent instance</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {viewingJournal && (
                <div className="modal-overlay">
                    <div className="modal-content glass-panel" style={{ maxWidth: '800px' }}>
                        <div className="modal-header">
                            <h2>Journal: {viewingJournal.name}</h2>
                            <button className="close-btn" onClick={() => setViewingJournal(null)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto', background: '#111', padding: '1rem', borderRadius: '8px' }}>
                            <pre className="text-xs whitespace-pre-wrap">{viewingJournal.content}</pre>
                        </div>
                    </div>
                </div>
            )}

            {isModalOpen && (
                <div className="modal-overlay">
                    <div className="modal-content glass-panel">
                        <div className="modal-header">
                            <h2>{editingAgent ? 'Edit Agent' : 'Create New Agent'}</h2>
                            <button className="close-btn" onClick={() => setIsModalOpen(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSave}>
                            <div className="form-group">
                                <label>Agent Name</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. coder-agent"
                                    required
                                    disabled={!!editingAgent}
                                />
                            </div>
                            <div className="form-group">
                                <label>Model ID</label>
                                <select
                                    value={formData.model}
                                    onChange={e => setFormData({ ...formData, model: e.target.value })}
                                    required
                                >
                                    <option value="" disabled>Select a model</option>
                                    {models.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                    Choisissez parmi les modèles configurés dans geminiclaw.json.
                                </p>
                            </div>
                            <div className="form-group">
                                <label>Model Callback (Fallback #1)</label>
                                <select
                                    value={formData.modelCallback}
                                    onChange={e => setFormData({ ...formData, modelCallback: e.target.value })}
                                >
                                    <option value="">No callback</option>
                                    {models.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                    Modèle de secours immédiat en cas d'erreur du modèle principal.
                                </p>
                            </div>

                            <div className="form-group">
                                <label style={{ marginBottom: '1rem', display: 'block' }}>Agent Capabilities (Permissions)</label>

                                <div className="skills-selectors-grid">
                                    <div className="skill-category">
                                        <h5 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>🛠️ Native (Gemini CLI)</h5>
                                        <div className="checkbox-group">
                                            {availableSkills.native.map(skill => (
                                                <label key={skill.name} className="checkbox-label" title={skill.description}>
                                                    <input
                                                        type="checkbox"
                                                        checked={formData.allowedPermissions?.includes(skill.name)}
                                                        onChange={(e) => {
                                                            const perms = formData.allowedPermissions || [];
                                                            if (e.target.checked) {
                                                                setFormData({ ...formData, allowedPermissions: [...perms, skill.name] });
                                                            } else {
                                                                setFormData({ ...formData, allowedPermissions: perms.filter(p => p !== skill.name) });
                                                            }
                                                        }}
                                                    />
                                                    <span className="checkbox-text">{skill.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="skill-category">
                                        <h5 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>🧩 Project Skills (Internal)</h5>
                                        <div className="checkbox-group">
                                            {availableSkills.project.map(skill => (
                                                <label key={skill.name} className="checkbox-label" title={skill.description}>
                                                    <input
                                                        type="checkbox"
                                                        checked={formData.allowedPermissions?.includes(skill.name)}
                                                        onChange={(e) => {
                                                            const perms = formData.allowedPermissions || [];
                                                            if (e.target.checked) {
                                                                setFormData({ ...formData, allowedPermissions: [...perms, skill.name] });
                                                            } else {
                                                                setFormData({ ...formData, allowedPermissions: perms.filter(p => p !== skill.name) });
                                                            }
                                                        }}
                                                    />
                                                    <span className="checkbox-text">{skill.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    <Save size={18} /> {editingAgent ? 'Update Agent' : 'Create Agent'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
