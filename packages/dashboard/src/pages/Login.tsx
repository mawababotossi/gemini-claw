import React, { useState } from 'react';
import { api } from '../services/api';
import './Login.css';

interface LoginProps {
    onLogin: () => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
    const [token, setToken] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const success = await api.login(token);
            if (success) {
                onLogin();
            } else {
                setError('Invalid API Token');
            }
        } catch (err) {
            setError('Connection failed. Is the gateway running?');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-logo">🦾</div>
                    <h1>GeminiClaw</h1>
                    <p>Enter your API token to access the dashboard</p>
                </div>

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="form-group">
                        <label htmlFor="token">Gateway API Token</label>
                        <input
                            id="token"
                            type="password"
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            placeholder="GEMINICLAW_API_TOKEN"
                            required
                        />
                    </div>

                    {error && <div className="login-error">{error}</div>}

                    <button type="submit" className="login-button" disabled={loading}>
                        {loading ? 'Authenticating...' : 'Access Dashboard'}
                    </button>
                </form>

                <div className="login-footer">
                    <p>Secure authentication via HttpOnly cookies</p>
                </div>
            </div>
        </div>
    );
};

