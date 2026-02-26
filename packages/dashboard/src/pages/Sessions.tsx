export function Sessions() {
    return (
        <div className="page-container">
            <div className="page-header">
                <h1>Active Sessions</h1>
                <p>Monitor real-time conversations across all channels.</p>
            </div>

            <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <p>Live session monitoring will be implemented in the next iteration. (Requires WebSocket connection to Gateway)</p>
            </div>
        </div>
    );
}
