import { useState, useEffect, useRef } from 'react';
import { Send, RefreshCw, Sparkles, ChevronDown } from 'lucide-react';
import { api } from '../services/api';
import './WebChat.css';

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    text: string;
    thought?: string;
    timestamp: string;
}

export function WebChat() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [isTyping, setIsTyping] = useState(false);

    const wsRef = useRef<WebSocket | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Initialize persistent client ID
    const clientId = useRef<string>((() => {
        // If we are in the dashboard (environment secret exists), we use a fixed 'dashboard_owner' ID
        // so that all WhatsApp activity is mirrored and persistent across browser sessions.
        const DASHBOARD_SECRET = import.meta.env.VITE_DASHBOARD_SECRET || '';
        if (DASHBOARD_SECRET) {
            return 'dashboard_owner';
        }

        let id = localStorage.getItem('gc_dashboard_client_id');
        if (!id) {
            id = 'db_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
            localStorage.setItem('gc_dashboard_client_id', id);
        }
        return id;
    })());

    const loadHistory = async () => {
        try {
            const history = await api.getTranscript('webchat', clientId.current);
            setMessages(history.map((m: any, i: number) => ({
                id: `h_${i}_${Date.now()}`,
                role: m.role,
                text: m.content || '',
                thought: (typeof m.thought === 'string' && m.thought.trim().length > 0)
                    ? m.thought
                    : undefined,
                timestamp: m.timestamp || new Date().toISOString()
            })));
        } catch (err) {
            console.error("Failed to load history", err);
        }
    };

    const connect = () => {
        const wsUrl = `ws://${window.location.hostname}:3001`;

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'ping', clientId: clientId.current }));
            setIsConnected(true);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'typing') {
                    setIsTyping(true);
                } else if (data.type === 'paused') {
                    setIsTyping(false);
                } else if (data.type === 'message' && (data.from === 'assistant' || data.from === 'user')) {
                    setIsTyping(false);
                    setMessages(prev => [
                        ...prev,
                        {
                            id: Date.now().toString() + Math.random(),
                            role: data.from === 'assistant' ? 'assistant' : 'user',
                            text: data.text,
                            thought: data.thought,
                            timestamp: new Date().toISOString()
                        }
                    ]);
                }
            } catch (e) {
                console.error("Failed to parse WebSocket message", e);
            }
        };

        ws.onerror = () => {
            setIsConnected(false);
            setTimeout(connect, 3000);
        };

        ws.onclose = () => {
            setIsConnected(false);
            if (wsRef.current === ws) {
                setTimeout(connect, 3000);
            }
        };

        wsRef.current = ws;
    };

    function ThoughtBlock({ thought }: { thought: string }) {
        const [expanded, setExpanded] = useState(false);
        const preview = thought.slice(0, 120).replace(/\n/g, ' ');
        const hasMore = thought.length > 120;

        return (
            <div className="thought-container">
                <button
                    className="thought-label thought-toggle"
                    onClick={() => setExpanded(e => !e)}
                    aria-expanded={expanded}
                >
                    <Sparkles size={12} />
                    <span>Thinking</span>
                    <span className="thought-token-count">
                        ~{Math.round(thought.length / 4)} tokens
                    </span>
                    <ChevronDown size={12} className={`thought-chevron ${expanded ? 'expanded' : ''}`} />
                </button>
                <div className="thought-text">
                    {expanded ? thought : (hasMore ? preview + '…' : thought)}
                </div>
            </div>
        );
    }

    useEffect(() => {
        loadHistory();
        connect();
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    const handleSend = () => {
        const text = inputMessage.trim();
        if (!text || !isConnected || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        if (text.startsWith('/')) {
            const command = text.toLowerCase();
            if (command === '/new') {
                handleNewSession();
                setInputMessage('');
                return;
            }
        }

        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'user',
            text,
            timestamp: new Date().toISOString()
        }]);

        const DASHBOARD_SECRET = import.meta.env.VITE_DASHBOARD_SECRET || '';
        wsRef.current.send(JSON.stringify({
            type: 'message',
            clientId: clientId.current,
            text,
            secret: DASHBOARD_SECRET
        }));

        setInputMessage('');
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
        }
    };

    const handleNewSession = () => {
        if (!confirm('Start a new session? This will clear the current conversation.')) return;

        const newId = 'db_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
        localStorage.setItem('gc_dashboard_client_id', newId);
        clientId.current = newId;

        setMessages([]);
        if (wsRef.current) {
            wsRef.current.close();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputMessage(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
    };

    const formatTime = (ts: string) => {
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="page-container chat-page">
            <div className="page-header flex justify-between items-center" style={{ marginBottom: '1.5rem' }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700 }}>Chat</h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Talk directly with your deployed GeminiClaw agents.</p>
                </div>
            </div>

            <div className="chat-layout-wrapper glass-panel">
                <div className="chat-sidebar-info">
                    <div className="session-info-card p-4">
                        <div className="badge badge-primary mb-3">ACTIVE SESSION</div>
                        <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>ID: {clientId.current}</h4>
                        <div className={`connection-status-tag ${isConnected ? 'online' : 'offline'}`}>
                            <div className="status-dot"></div>
                            {isConnected ? 'Connected' : 'Connecting...'}
                        </div>
                    </div>

                    <div className="chat-actions-sidebar p-4 border-t border-white/5">
                        <button className="btn btn-outline btn-block btn-sm" onClick={handleNewSession}>
                            <RefreshCw size={14} style={{ marginRight: '8px' }} /> New Session
                        </button>
                    </div>
                </div>

                <div className="chat-main-area">
                    <div className="chat-messages-container">
                        {messages.length === 0 && !isTyping && (
                            <div className="chat-welcome-state">
                                <div className="welcome-icon">
                                    <Sparkles size={40} className="text-primary" />
                                </div>
                                <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>GeminiClaw Chat</h2>
                                <p style={{ maxWidth: '400px', margin: '0 auto', color: 'var(--text-muted)' }}>
                                    Your personal gateway to AI agents. Type a message below to begin your adventure.
                                </p>
                            </div>
                        )}

                        <div className="messages-list">
                            {messages.map((msg) => (
                                <div key={msg.id} className={`chat-message-row ${msg.role}`}>
                                    <div className="chat-message-avatar">
                                        {msg.role === 'assistant' ? (
                                            <div className="avatar assistant-avatar-gradient">
                                                <span>A</span>
                                            </div>
                                        ) : (
                                            <div className="avatar user-avatar-gradient">
                                                <span>U</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="chat-message-body">
                                        <div className="chat-message-header">
                                            <span className="sender-name">{msg.role === 'assistant' ? 'Assistant' : 'You'}</span>
                                            <span className="message-time">{formatTime(msg.timestamp)}</span>
                                        </div>

                                        {msg.thought && <ThoughtBlock thought={msg.thought} />}

                                        <div className="message-bubble-v2">
                                            {msg.text}
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {isTyping && (
                                <div className="chat-message-row assistant">
                                    <div className="chat-message-avatar">
                                        <div className="avatar assistant-avatar-gradient">
                                            <span>A</span>
                                        </div>
                                    </div>
                                    <div className="chat-message-body">
                                        <div className="typing-v2">
                                            <span></span><span></span><span></span>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                    </div>

                    <div className="chat-input-bar-container">
                        <div className="chat-input-wrapper">
                            <textarea
                                ref={inputRef}
                                placeholder={isConnected ? "Message GeminiClaw..." : "Connecting..."}
                                value={inputMessage}
                                onChange={handleInput}
                                onKeyDown={handleKeyDown}
                                disabled={!isConnected}
                                rows={1}
                            />
                            <button
                                className={`chat-send-btn ${inputMessage.trim() ? 'active' : ''}`}
                                onClick={handleSend}
                                disabled={!isConnected || !inputMessage.trim()}
                            >
                                <Send size={20} />
                            </button>
                        </div>
                        <div className="chat-input-hint">
                            Press Enter to send, Shift + Enter for new line.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
