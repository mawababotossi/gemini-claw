import { useState, useEffect } from 'react';
import {
    Clock,
    Calendar,
    Trash2,
    RefreshCw,
    Play,
    AlertCircle,
    Bot,
    MessageSquare,
    Loader2
} from 'lucide-react';
import { api } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import './Agents.css'; // Reusing some Agent styles for consistency

export function CronJobs() {
    const [jobs, setJobs] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const fetchJobs = async () => {
        setIsRefreshing(true);
        try {
            const data = await (api as any).getJobs();
            setJobs(data);
        } catch (err) {
            console.error('Failed to fetch jobs', err);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        fetchJobs();
    }, []);

    const handleRemove = async (agentName: string, jobId: string) => {
        if (!confirm('Are you sure you want to remove this scheduled task?')) return;
        try {
            await api.deleteAgentJob(agentName, jobId);
            await fetchJobs();
        } catch (err) {
            alert('Failed to remove job');
        }
    };

    const formatDelivery = (target: any) => {
        if (!target) return 'Global (Broadcast)';
        return `${target.channel} -> ${target.peerId}`;
    };

    return (
        <div className="page-container animate-fade-in">
            <PageHeader
                title="Cron Jobs"
                description="Monitor and manage all scheduled recurring tasks across your agents."
                actions={
                    <button className="btn btn-outline" onClick={fetchJobs} disabled={isRefreshing}>
                        <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                }
            />

            <div className="page-content" style={{ marginTop: '1.5rem' }}>
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 opacity-50">
                        <Loader2 size={40} className="animate-spin text-primary mb-4" />
                        <p>Loading scheduled tasks...</p>
                    </div>
                ) : jobs.length === 0 ? (
                    <div className="empty-state glass-panel">
                        <div className="empty-state-icon">
                            <Calendar size={48} />
                        </div>
                        <h3 className="empty-state-title">No scheduled tasks found</h3>
                        <p className="empty-state-description">
                            Either no cron jobs are configured in geminiclaw.json, or no agents have scheduled dynamic tasks.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        {jobs.map((job) => (
                            <div key={`${job.agentName}-${job.id}`} className="glass-panel p-5 hover-glow transition-all">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 rounded-lg bg-primary-dim text-primary">
                                            <Bot size={24} />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className="text-lg font-bold text-primary">{job.agentName}</h3>
                                                <span className="badge badge-secondary">{job.id}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <code className="monospace px-2 py-0.5 rounded text-xs bg-primary-dim text-primary border border-primary/20">
                                                    {job.cron}
                                                </code>
                                                <div className="flex items-center gap-1.5 text-xs text-muted">
                                                    <MessageSquare size={12} />
                                                    <span>{formatDelivery(job.target)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            className="btn btn-sm btn-outline text-danger hover:bg-danger/10"
                                            onClick={() => handleRemove(job.agentName, job.id)}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>

                                <div className="p-4 rounded-lg bg-dark/50 border border-border/50 relative group">
                                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Play size={14} className="text-primary cursor-pointer" />
                                    </div>
                                    <p className="monospace text-sm text-secondary whitespace-pre-wrap">
                                        {job.prompt}
                                    </p>
                                </div>

                                <div className="mt-4 flex gap-4 border-t border-border/20 pt-4">
                                    {job.next && (
                                        <div className="flex items-center gap-2 text-xs text-muted">
                                            <Clock size={12} className="text-success" />
                                            <span>Next Run:</span>
                                            <span className="text-secondary">{job.next}</span>
                                        </div>
                                    )}
                                    {job.last && (
                                        <div className="flex items-center gap-2 text-xs text-muted">
                                            <AlertCircle size={12} className="text-primary" />
                                            <span>Last Result:</span>
                                            <span className="text-secondary">{job.last.substring(0, 100)}...</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
