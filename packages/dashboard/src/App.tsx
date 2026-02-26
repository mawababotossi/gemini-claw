import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar, TopBar } from './components';
import { Dashboard, Agents, Sessions, WebChat, Logs } from './pages';

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
              <Route path="/logs" element={<Logs />} />
              <Route path="/settings" element={<div className="page-container"><div className="page-header"><h1>Settings</h1><p>Not implemented yet.</p></div></div>} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
