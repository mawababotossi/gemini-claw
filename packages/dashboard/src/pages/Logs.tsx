import { useEffect, useState, useRef } from 'react';
import './Logs.css';
import { Terminal } from 'lucide-react';

interface LogMessage {
    timestamp: string;
    level: string;
    text: string;
}

export function Logs() {
    const [logs, setLogs] = useState<LogMessage[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const eventSource = new EventSource('http://localhost:3002/api/logs/stream');

        eventSource.onmessage = (event) => {
            try {
                const message: LogMessage = JSON.parse(event.data);
                setLogs(prev => {
                    const next = [...prev, message];
                    // Keep max 1000 lines to avoid memory leak
                    if (next.length > 1000) return next.slice(next.length - 1000);
                    return next;
                });
            } catch (err) {
                console.error('Failed to parse log message', err);
            }
        };

        return () => {
            eventSource.close();
        };
    }, []);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="page-container logs-page">
            <div className="page-header">
                <div>
                    <h1><Terminal size={24} className="inline-icon" /> Live Diagnostics</h1>
                    <p>Real-time backend logs stream</p>
                </div>
                <div className="header-actions">
                    <button className="primary-button" onClick={() => setLogs([])}>Clear</button>
                </div>
            </div>

            <div className="logs-terminal glass-panel">
                {logs.length === 0 ? (
                    <div className="empty-state">Waiting for logs...</div>
                ) : (
                    <div className="logs-content">
                        {logs.map((log, index) => (
                            <div key={index} className={`log-line level-${log.level.toLowerCase()}`}>
                                <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                <span className="log-level">[{log.level.toUpperCase()}]</span>
                                <span className="log-text">{log.text}</span>
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                )}
            </div>
        </div>
    );
}
