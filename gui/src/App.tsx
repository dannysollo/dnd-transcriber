import { Routes, Route, NavLink } from 'react-router-dom'
import './App.css'
import SessionsPage from './pages/SessionsPage'
import SessionView from './pages/SessionView'
import PipelinePage from './pages/PipelinePage'
import CorrectionsPage from './pages/CorrectionsPage'
import SettingsPage from './pages/SettingsPage'

const navItems = [
  { to: '/', label: 'Sessions', icon: '📜' },
  { to: '/pipeline', label: 'Pipeline', icon: '⚙️' },
  { to: '/corrections', label: 'Corrections', icon: '✏️' },
  { to: '/settings', label: 'Settings', icon: '🔧' },
]

export default function App() {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0f1117' }}>
      {/* Sidebar */}
      <nav style={{
        display: 'flex',
        flexDirection: 'column',
        width: '200px',
        flexShrink: 0,
        background: '#13151f',
        borderRight: '1px solid #1e2130',
      }}>
        {/* Logo */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid #1e2130' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#7c6cfc' }}>DnD Transcriber</div>
          <div style={{ fontSize: '11px', marginTop: '2px', color: '#475569' }}>Session Pipeline</div>
        </div>

        {/* Nav links */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '12px', flex: 1 }}>
          {navItems.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                textDecoration: 'none',
                transition: 'all 0.15s',
                background: isActive ? 'rgba(124,108,252,0.15)' : 'transparent',
                color: isActive ? '#a89cff' : '#94a3b8',
                fontWeight: isActive ? 600 : 400,
              })}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #1e2130', fontSize: '11px', color: '#334155' }}>
          v1.0
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'auto' }}>
        <Routes>
          <Route path="/" element={<SessionsPage />} />
          <Route path="/sessions/:name" element={<SessionView />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/corrections" element={<CorrectionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
