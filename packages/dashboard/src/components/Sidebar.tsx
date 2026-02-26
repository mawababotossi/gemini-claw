import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, MessageSquareCode, Settings, Terminal } from 'lucide-react';
import './Sidebar.css';

const navItems = [
    { path: '/', label: 'Overview', icon: LayoutDashboard },
    { path: '/agents', label: 'Agents', icon: Users },
    { path: '/chat', label: 'Chat', icon: MessageSquareCode },
    { path: '/sessions', label: 'Sessions', icon: MessageSquareCode },
    { path: '/logs', label: 'Logs', icon: Terminal },
    { path: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
    const location = useLocation();

    return (
        <aside className="sidebar glass-panel">
            <div className="sidebar-header">
                <div className="logo-glow"></div>
                <h2>GeminiClaw</h2>
                <span className="badge">v0.1.0</span>
            </div>

            <nav className="sidebar-nav">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));

                    return (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`nav-item ${isActive ? 'active' : ''}`}
                        >
                            <Icon size={20} className="nav-icon" />
                            <span>{item.label}</span>
                            {isActive && <div className="nav-indicator" />}
                        </Link>
                    );
                })}
            </nav>

        </aside>
    );
}
