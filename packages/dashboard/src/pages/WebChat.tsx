import { useState, useEffect, useRef } from 'react';
import { Send, Bot, RefreshCw } from 'lucide-react';
import './WebChat.css';

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    text: string;
    thought?: string;
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
        let id = localStorage.getItem('gc_dashboard_client_id');
        if (!id) {
            id = 'db_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
            localStorage.setItem('gc_dashboard_client_id', id);
        }
        return id;
    })());

    const loadHistory = async () => {
        try {
            const resp = await fetch(`http://${window.location.hostname}:3002/api/transcripts/webchat/${clientId.current}`);
            if (resp.ok) {
                const history = await resp.json();
                setMessages(history.map((m: any, i: number) => ({
                    id: `h_${i}`,
                    role: m.role,
                    text: m.content || '',
                    thought: m.thought
                })));
            }
        } catch (err) {
            console.error("Failed to load history", err);
        }
    };

    const connect = () => {
        // Determine the gateway host. In dev, dashboard is on 5173, gateway is on 3001.
        const wsUrl = `ws://localhost:3001`; // Using the static port of the WebChat channel for now

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
                } else if (data.type === 'message' && (data.from === 'assistant' || data.from === 'user')) {
                    setIsTyping(false);
                    setMessages(prev => {
                        return [...prev, {
                            id: Date.now().toString(),
                            role: data.from === 'assistant' ? 'assistant' : 'user',
                            text: data.text,
                            thought: data.thought
                        }];
                    });
                }
            } catch (e) {
                console.error("Failed to parse WebSocket message", e);
            }
        };

        ws.onerror = () => {
            setIsConnected(false);
            // Auto-reconnect in 3s
            setTimeout(connect, 3000);
        };

        ws.onclose = () => {
            setIsConnected(false);
            if (wsRef.current === ws) {
                setTimeout(connect, 3000);
            }
        };

        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'ping', clientId: clientId.current }));
            setIsConnected(true);
        };

        wsRef.current = ws;
    };

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

        // Command handling
        if (text.startsWith('/')) {
            const command = text.toLowerCase();

            if (command === '/new') {
                handleNewSession();
                setInputMessage('');
                return;
            }

            if (command === '/status') {
                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'assistant',
                    text: `**System Status:**\n- **Client ID:** \`${clientId.current}\`\n- **Gateway Connection:** \`${isConnected ? 'Online' : 'Offline'}\`\n- **Session:** \`${messages.length} messages\``
                }]);
                setInputMessage('');
                return;
            }
        }

        // Add user message to UI immediately
        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'user',
            text
        }]);

        // Send to Gateway
        wsRef.current.send(JSON.stringify({ type: 'message', clientId: clientId.current, text }));

        // Reset input
        setInputMessage('');
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
        }
    };

    const handleNewSession = () => {
        if (!confirm('Start a new session? This will clear the current conversation from your screen.')) return;

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

    return (
        <div className="page-container chat-page">
            <div className="page-header flex justify-between items-center">
                <div>
                    <h1>Chat Interface</h1>
                    <p>Talk directly with your deployed GeminiClaw agents.</p>
                </div>
                <button className="btn btn-outline" onClick={handleNewSession}>
                    <RefreshCw size={18} style={{ marginRight: '8px' }} /> New Session
                </button>
            </div>

            <div className="chat-interface glass-panel">
                <div className="chat-messages">
                    {messages.length === 0 && (
                        <div className="empty-state">
                            <div className="agent-avatar-large">
                                <Bot size={40} />
                            </div>
                            <h2>Start a conversation</h2>
                            <p>Type a message below to test your agent configuration.</p>
                        </div>
                    )}

                    {messages.map((msg) => (
                        <div key={msg.id} className={`message-row ${msg.role}`}>
                            {msg.role === 'assistant' && (
                                <div className="message-avatar agent-avatar">
                                    <Bot size={18} />
                                </div>
                            )}
                            <div className="message-content">
                                {msg.thought && (
                                    <div className="thought-block">
                                        <div className="thought-header">Thinking...</div>
                                        {msg.thought}
                                    </div>
                                )}
                                <div className="message-bubble">
                                    {msg.text}
                                </div>
                            </div>
                            {msg.role === 'user' && (
                                <div className="message-avatar user-avatar">
                                    U
                                </div>
                            )}
                        </div>
                    ))}

                    {isTyping && (
                        <div className="message-row assistant">
                            <div className="message-avatar agent-avatar">
                                <Bot size={18} />
                            </div>
                            <div className="message-bubble typing-indicator">
                                <span></span><span></span><span></span>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                <div className="chat-input-area">
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
                        className="send-button"
                        onClick={handleSend}
                        disabled={!isConnected || !inputMessage.trim()}
                    >
                        <Send size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
}
