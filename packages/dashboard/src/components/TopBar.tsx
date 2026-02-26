import { useState, useEffect } from 'react';
import { Bell, Search } from 'lucide-react';
import { api } from '../services/api';
import './TopBar.css';

export function TopBar() {
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        let mounted = true;
        const checkStatus = async () => {
            try {
                await api.getStatus();
                if (mounted) setIsConnected(true);
            } catch {
                if (mounted) setIsConnected(false);
            }
        };
        checkStatus();
        const interval = setInterval(checkStatus, 3000);
        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, []);

    return (
        <header className="topbar">
            <div className="search-bar glass-card">
                <Search size={18} className="search-icon" />
                <input type="text" placeholder="Search sessions, agents..." />
            </div>

            <div className="topbar-actions">
                <div className={`connection-status ${isConnected ? 'online' : 'offline'}`} style={{ marginRight: '1rem' }}>
                    <div className="status-dot"></div>
                    {isConnected ? 'Connected' : 'Reconnecting...'}
                </div>
                <button className="icon-btn glass-card">
                    <Bell size={18} />
                    <span className="notification-badge"></span>
                </button>
                <div className="user-profile glass-card">
                    <div className="avatar">A</div>
                    <span>Admin</span>
                </div>
            </div>
        </header>
    );
}
