import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar, TopBar } from './components';
import { Dashboard, Agents, Sessions, WebChat, Logs, Channels, Settings } from './pages';

function App() {
  return (
    <BrowserRouter>
      <div className="flex" style={{ minHeight: '100vh', width: '100%' }}>
        <Sidebar />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <TopBar />
          <div style={{ flex: 1 }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/chat" element={<WebChat />} />
              <Route path="/sessions" element={<Sessions />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
