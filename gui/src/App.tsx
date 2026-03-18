import React, { useEffect, useState } from 'react'
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
import EditQueuePage from './pages/EditQueuePage'
import LandingPage from './pages/LandingPage'
import SearchPage from './pages/SearchPage'
import ShareView from './pages/ShareView'
import { useAuth, avatarUrl } from './AuthContext'
import { useCampaign } from './CampaignContext'

const navItems = [
  { to: '/', label: 'Sessions', icon: '📜' },
  { to: '/search', label: 'Search', icon: '🔍' },
  { to: '/campaigns', label: 'Campaigns', icon: '⚔️' },
  { to: '/corrections', label: 'Corrections', icon: '✏️' },
  { to: '/settings', label: 'Settings', icon: '🔧' },
]

export default function App() {
  const { user, isLoggedIn, authEnabled, loading } = useAuth()
  const { campaigns, activeCampaign, setActiveCampaign, loading: campaignLoading } = useCampaign()
  const [campaignDropdownOpen, setCampaignDropdownOpen] = useState(false)
  const [pendingEditCount, setPendingEditCount] = useState(0)
  const navigate = useNavigate()

  // Fetch pending edit count for DMs
  useEffect(() => {
    if (!activeCampaign || activeCampaign.role !== 'dm') {
      setPendingEditCount(0)
      return
    }
    const fetchCount = () => {
      fetch(`/campaigns/${activeCampaign.slug}/edits?count=true`)
        .then(r => r.ok ? r.json() : { count: 0 })
        .then(data => setPendingEditCount(data.count ?? 0))
        .catch(() => {})
    }
    fetchCount()
    const interval = setInterval(fetchCount, 30000)
    return () => clearInterval(interval)
  }, [activeCampaign?.slug, activeCampaign?.role])

  const logout = async () => {
    await fetch('/auth/logout', { method: 'POST' })
    window.location.reload()
  }

  // After login, check if there's a pending invite to redirect to
  React.useEffect(() => {
    if (isLoggedIn) {
      const pendingToken = localStorage.getItem('pendingInviteToken')
      if (pendingToken) {
        localStorage.removeItem('pendingInviteToken')
        navigate(`/invite/${pendingToken}`)
      }
    }
  }, [isLoggedIn])

  // Share links are fully public — render outside the auth shell
  if (window.location.pathname.startsWith('/share/')) {
    return (
      <Routes>
        <Route path="/share/:token" element={<ShareView />} />
      </Routes>
    )
  }

  if (loading || campaignLoading) {
    return (
      <div style={{ display: 'flex', height: '100vh', background: '#0f1117' }} />
    )
  }

  if (authEnabled && !isLoggedIn) {
    // Allow invite pages to render even when logged out
    if (!window.location.pathname.startsWith('/invite/')) {
      return <LandingPage />
    }
  }

  return (
    <div className="app-shell" style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0f1117' }}>
      {/* Sidebar */}
      <nav className="app-sidebar" style={{
        display: 'flex',
        flexDirection: 'column',
        width: '200px',
        flexShrink: 0,
        background: '#13151f',
        borderRight: '1px solid #1e2130',
      }}>
        {/* Logo */}
        <div className="sidebar-logo" style={{ padding: '20px 16px 16px', borderBottom: '1px solid #1e2130' }}>
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

        {/* Campaign selector */}
        {!campaignLoading && campaigns.length > 0 && (
          <div className="sidebar-campaign" style={{ padding: '8px 12px', borderBottom: '1px solid #1e2130', position: 'relative' }}>
            <div
              onClick={() => setCampaignDropdownOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 10px', borderRadius: '6px', cursor: 'pointer',
                background: 'rgba(124,108,252,0.08)', border: '1px solid rgba(124,108,252,0.2)',
              }}
            >
              <div>
                <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '1px' }}>Campaign</div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#a89cff' }}>
                  {activeCampaign?.name ?? 'None'}
                </div>
              </div>
              {campaigns.length > 1 && (
                <span style={{ fontSize: '10px', color: '#475569' }}>
                  {campaignDropdownOpen ? '▲' : '▼'}
                </span>
              )}
            </div>

            {campaignDropdownOpen && campaigns.length > 1 && (
              <div style={{
                position: 'absolute', left: '12px', right: '12px', top: '100%',
                background: '#1a1d2e', border: '1px solid #2a2d3a',
                borderRadius: '6px', zIndex: 100, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}>
                {campaigns.map(c => (
                  <div
                    key={c.slug}
                    onClick={() => {
                      setActiveCampaign(c)
                      setCampaignDropdownOpen(false)
                    }}
                    style={{
                      padding: '8px 12px', fontSize: '12px', cursor: 'pointer',
                      color: activeCampaign?.slug === c.slug ? '#a89cff' : '#94a3b8',
                      background: activeCampaign?.slug === c.slug ? 'rgba(124,108,252,0.12)' : 'transparent',
                    }}
                  >
                    {c.name}
                    <span style={{ fontSize: '10px', color: '#475569', marginLeft: '6px' }}>
                      [{c.role}]
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Nav links */}
        <div className="sidebar-nav" style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '12px', flex: 1 }}>
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
          {activeCampaign?.role === 'dm' && (
            <NavLink
              to="/edit-queue"
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
              <span>📝</span>
              <span style={{ flex: 1 }}>Edit Queue</span>
              {pendingEditCount > 0 && (
                <span style={{
                  fontSize: '10px', fontWeight: 700,
                  background: 'rgba(251,191,36,0.2)', color: '#fbbf24',
                  border: '1px solid rgba(251,191,36,0.4)',
                  borderRadius: '10px', padding: '1px 6px', minWidth: '18px', textAlign: 'center',
                }}>
                  {pendingEditCount}
                </span>
              )}
            </NavLink>
          )}
        </div>

        {/* User / auth section */}
        <div className="sidebar-user" style={{ padding: '12px', borderTop: '1px solid #1e2130' }}>
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
      <main className="app-main" style={{ flex: 1, overflow: 'auto' }}>
        {/* Mobile campaign indicator */}
        <div className="mobile-campaign-bar" style={{
          display: 'none',
          padding: '8px 16px',
          background: '#13151f',
          borderBottom: '1px solid #1e2130',
          fontSize: '12px',
          color: '#a89cff',
          fontWeight: 600,
        }}>
          {activeCampaign?.name ?? 'No campaign'}
        </div>
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
          <Route path="/edit-queue" element={<EditQueuePage />} />
          <Route path="/search" element={<SearchPage />} />
        </Routes>
      </main>
    </div>
  )
}
