import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar, TopBar } from './components';
import { Dashboard, Agents, Skills, Sessions, WebChat, Logs, Channels, Settings, ComingSoon, CronJobs, Login } from './pages';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    localStorage.getItem('isAuthenticated') === 'true'
  );

  const handleLogin = () => {
    localStorage.setItem('isAuthenticated', 'true');
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('isAuthenticated');
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login onLogin={handleLogin} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <div className="flex" style={{ minHeight: '100vh', width: '100%' }}>
        <Sidebar onLogout={handleLogout} />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <TopBar />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/skills" element={<Skills />} />
              <Route path="/chat" element={<WebChat />} />
              <Route path="/sessions" element={<Sessions />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/settings" element={<Settings />} />

              {/* Coming Soon / Placeholder Routes */}
              <Route path="/instances" element={<ComingSoon title="Instances" description="Monitor and manage active OpenClaw instances." />} />
              <Route path="/cron" element={<CronJobs />} />
              <Route path="/nodes" element={<ComingSoon title="Nodes" description="Visualize agent and skill connectivity." />} />
              <Route path="/usage" element={<ComingSoon title="Usage" description="Track token usage and operational costs." />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
