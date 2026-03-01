import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar, TopBar } from './components';
import { Dashboard, Agents, Skills, Sessions, WebChat, Logs, Channels, Settings, ComingSoon, CronJobs } from './pages';

function App() {
  return (
    <BrowserRouter>
      <div className="flex" style={{ minHeight: '100vh', width: '100%' }}>
        <Sidebar />
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
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
