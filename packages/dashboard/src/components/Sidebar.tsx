import { Link, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    Users,
    MessageSquareCode,
    Settings,
    Terminal,
    Smartphone,
    Wrench,
    MessagesSquare,
    Wifi,
    Clock,
    Monitor,
    LogOut
} from 'lucide-react';
import { api } from '../services/api';
import './Sidebar.css';

export const navGroups = [
    {
        label: 'CHAT',
        items: [
            { path: '/chat', label: 'Chat', icon: MessageSquareCode },
        ],
    },
    {
        label: 'CONTROL',
        items: [
            { path: '/', label: 'Overview', icon: LayoutDashboard },
            { path: '/channels', label: 'Channels', icon: Smartphone },
            { path: '/instances', label: 'Instances', icon: Wifi },
            { path: '/sessions', label: 'Sessions', icon: MessagesSquare },
            { path: '/cron', label: 'Cron Jobs', icon: Clock },
        ],
    },
    {
        label: 'AGENT',
        items: [
            { path: '/agents', label: 'Agents', icon: Users },
            { path: '/skills', label: 'Skills', icon: Wrench },
            { path: '/nodes', label: 'Nodes', icon: Monitor },
        ],
    },
    {
        label: 'SETTINGS',
        items: [
            { path: '/settings', label: 'Config', icon: Settings },
            { path: '/logs', label: 'Logs', icon: Terminal },
        ],
    },
];

export function Sidebar({ onLogout }: { onLogout: () => void }) {
    const location = useLocation();

    const handleLogout = async () => {
        await api.logout();
        onLogout();
    };

    return (
        <aside className="sidebar glass-panel">
            <div className="sidebar-header">
                <div className="logo-glow"></div>
                <h2>GeminiClaw</h2>
                <span className="badge">v0.1.0</span>
            </div>

            <nav className="sidebar-nav">
                {navGroups.map((group) => (
                    <div key={group.label} className="nav-group">
                        <div className="nav-group-label">{group.label}</div>
                        {group.items.map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));

                            return (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    className={`nav-item ${isActive ? 'active' : ''}`}
                                >
                                    <Icon size={18} className="nav-icon" />
                                    <span>{item.label}</span>
                                    {isActive && <div className="nav-indicator" />}
                                </Link>
                            );
                        })}
                    </div>
                ))}
            </nav>

            <div className="sidebar-footer">
                <button className="nav-item logout-button" onClick={handleLogout}>
                    <LogOut size={18} className="nav-icon" />
                    <span>Logout</span>
                </button>
            </div>
        </aside>
    );
}
