import type { ReactNode } from 'react';
import './StatCard.css';

interface StatCardProps {
    title: string;
    value: string | number;
    icon: ReactNode;
    subtitle?: string;
    trend?: {
        value: string;
        isPositive: boolean;
    };
}

export function StatCard({ title, value, icon, subtitle, trend }: StatCardProps) {
    return (
        <div className="stat-card glass-panel">
            <div className="stat-header">
                <h3 className="stat-title">{title}</h3>
                <div className="stat-icon-wrapper">
                    {icon}
                </div>
            </div>
            <div className="stat-body">
                <div className="stat-value">{value}</div>
                {subtitle && (
                    <div className="stat-subtitle" style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        {subtitle}
                    </div>
                )}
                {trend && (
                    <div className={`stat-trend ${trend.isPositive ? 'positive' : 'negative'}`}>
                        {trend.isPositive ? '↑' : '↓'} {trend.value}
                    </div>
                )}
            </div>
        </div>
    );
}
