import { useState, useEffect } from 'react';
import { Users, Activity, MessageSquareCode, ShieldCheck, Key } from 'lucide-react';
import { StatCard } from '../components';
import { api, type AppStatus } from '../services/api';
import './Dashboard.css';

export function Dashboard() {
    const [statusInfo, setStatusInfo] = useState<AppStatus | null>(null);

    useEffect(() => {
        api.getStatus().then(setStatusInfo).catch(console.error);
    }, []);
    return (
        <div className="page-container">
            <div className="page-header">
                <h1>Overview</h1>
                <p>Monitor your GeminiClaw gateway performance and activity.</p>
            </div>

            <div className="stats-grid">
                <StatCard
                    title="Active Sessions"
                    value="24"
                    icon={<MessageSquareCode size={24} />}
                    trend={{ value: "12% vs last hour", isPositive: true }}
                />
                <StatCard
                    title="Total Agents"
                    value="3"
                    icon={<Users size={24} />}
                />
                <StatCard
                    title="API Requests"
                    value="1,248"
                    icon={<Activity size={24} />}
                    trend={{ value: "5% vs last hour", isPositive: false }}
                />
                <StatCard
                    title="System Status"
                    value={statusInfo?.status || "Loading..."}
                    icon={<ShieldCheck size={24} />}
                />
                <StatCard
                    title="Auth Method"
                    value={statusInfo?.authType || "Unknown"}
                    subtitle={statusInfo?.accountHint}
                    icon={<Key size={24} />}
                />
            </div>

            <div className="dashboard-content">
                <div className="glass-panel recent-activity">
                    <h3>Recent Activity</h3>
                    <div className="activity-list">
                        <div className="activity-item">
                            <div className="activity-icon bg-primary"></div>
                            <div className="activity-details">
                                <p><strong>Session started</strong> on WebChat</p>
                                <span>2 minutes ago</span>
                            </div>
                        </div>
                        <div className="activity-item">
                            <div className="activity-icon bg-secondary"></div>
                            <div className="activity-details">
                                <p><strong>Agent 'main'</strong> called skill 'getCurrentTime'</p>
                                <span>5 minutes ago</span>
                            </div>
                        </div>
                        <div className="activity-item">
                            <div className="activity-icon bg-success"></div>
                            <div className="activity-details">
                                <p><strong>Gateway connected</strong> to Telegram</p>
                                <span>1 hour ago</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="glass-panel quick-actions">
                    <h3>Quick Actions</h3>
                    <div className="actions-grid">
                        <button className="btn btn-outline">Restart Gateway</button>
                        <button className="btn btn-primary">Refresh Auth Tokens</button>
                        <button className="btn btn-outline">View Logs</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
