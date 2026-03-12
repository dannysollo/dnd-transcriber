import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import './App.css'
import SessionsPage from './pages/SessionsPage'
import SessionView from './pages/SessionView'
import PipelinePage from './pages/PipelinePage'
import CorrectionsPage from './pages/CorrectionsPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import CampaignsPage from './pages/CampaignsPage'
import CampaignSettingsPage from './pages/CampaignSettingsPage'
import InvitePage from './pages/InvitePage'
import { useAuth, avatarUrl } from './AuthContext'

const navItems = [
  { to: '/', label: 'Sessions', icon: '📜' },
  { to: '/campaigns', label: 'Campaigns', icon: '⚔️' },
  { to: '/pipeline', label: 'Pipeline', icon: '⚙️' },
  { to: '/corrections', label: 'Corrections', icon: '✏️' },
  { to: '/settings', label: 'Settings', icon: '🔧' },
]

export default function App() {
  const { user, isLoggedIn, authEnabled, loading } = useAuth()
  const navigate = useNavigate()

  const logout = async () => {
    await fetch('/auth/logout', { method: 'POST' })
    window.location.reload()
  }

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
          {!authEnabled && (
            <div style={{
              marginTop: '6px', fontSize: '10px', fontWeight: 600,
              color: '#fbbf24', background: 'rgba(251,191,36,0.1)',
              borderRadius: '4px', padding: '2px 6px', display: 'inline-block',
            }}>
              Dev Mode
            </div>
          )}
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

        {/* User / auth section */}
        <div style={{ padding: '12px', borderTop: '1px solid #1e2130' }}>
          {loading ? null : isLoggedIn && user ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                onClick={() => navigate('/campaigns')}
              >
                <img
                  src={avatarUrl(user)}
                  alt=""
                  style={{ width: 28, height: 28, borderRadius: '50%' }}
                />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>{user.username}</div>
                  {user.is_admin && (
                    <div style={{ fontSize: '10px', color: '#7c6cfc' }}>admin</div>
                  )}
                </div>
              </div>
              <button
                onClick={logout}
                style={{
                  background: 'transparent', border: '1px solid #2a2d3a',
                  borderRadius: '6px', color: '#64748b', padding: '4px 0',
                  fontSize: '11px', cursor: 'pointer', width: '100%',
                }}
              >
                Log out
              </button>
            </div>
          ) : authEnabled ? (
            <a
              href="/auth/discord"
              style={{
                display: 'block', textAlign: 'center',
                background: '#5865f2', color: '#fff', borderRadius: '8px',
                padding: '7px 0', textDecoration: 'none', fontSize: '12px', fontWeight: 600,
              }}
            >
              Login with Discord
            </a>
          ) : (
            <div style={{ fontSize: '11px', color: '#334155' }}>v1.0</div>
          )}
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
          <Route path="/login" element={<LoginPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/campaigns/:slug/settings" element={<CampaignSettingsPage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
        </Routes>
      </main>
    </div>
  )
}
