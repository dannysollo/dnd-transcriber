import React, { useEffect, useState } from 'react'
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import './App.css'
import SessionsPage from './pages/SessionsPage'
import SessionView from './pages/SessionView'
import CorrectionsPage from './pages/CorrectionsPage'
import LoginPage from './pages/LoginPage'
import CampaignsPage from './pages/CampaignsPage'
import CampaignSettingsPage from './pages/CampaignSettingsPage'
import InvitePage from './pages/InvitePage'
import EditQueuePage from './pages/EditQueuePage'
import LandingPage from './pages/LandingPage'
import SearchPage from './pages/SearchPage'
import ShareView from './pages/ShareView'
import SettingsPage from './pages/SettingsPage'
import { useAuth, avatarUrl } from './AuthContext'
import { useCampaign } from './CampaignContext'

// SVG icon components
const ScrollIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6" />
    <path d="M6 3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2" />
    <path d="M9 8h6M9 11h6M9 14h4" />
  </svg>
)

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="M17 17l-3.5-3.5" />
  </svg>
)

const ShieldIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 2L3 5v5c0 4.5 3.1 8.4 7 9.5C13.9 18.4 17 14.5 17 10V5L10 2z" />
  </svg>
)

const PencilIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.5 3.5a2.12 2.12 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5z" />
  </svg>
)

const GearIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="3" />
    <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" />
  </svg>
)

const EditQueueIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="14" height="3" rx="1" />
    <rect x="3" y="9" width="10" height="3" rx="1" />
    <rect x="3" y="14" width="7" height="3" rx="1" />
  </svg>
)

const navItems = [
  { to: '/', label: 'Sessions', Icon: ScrollIcon },
  { to: '/search', label: 'Search', Icon: SearchIcon },
  { to: '/campaigns', label: 'Campaigns', Icon: ShieldIcon },
  { to: '/corrections', label: 'Corrections', Icon: PencilIcon },
]


export default function App() {
  const { user, isLoggedIn, authEnabled, loading } = useAuth()
  const { campaigns, activeCampaign, setActiveCampaign, loading: campaignLoading } = useCampaign()
  const [campaignDropdownOpen, setCampaignDropdownOpen] = useState(false)
  const [pendingEditCount, setPendingEditCount] = useState(0)
  const [workerLastSeen, setWorkerLastSeen] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const isSessionView = location.pathname.startsWith('/sessions/')

  // Fetch worker heartbeat for DMs
  useEffect(() => {
    if (!activeCampaign || activeCampaign.role !== 'dm') { setWorkerLastSeen(null); return }
    const fetchHeartbeat = () => {
      fetch(`/campaigns/${activeCampaign.slug}/worker-key`)
        .then(r => r.ok ? r.json() : null)
        .then(data => setWorkerLastSeen(data?.last_seen ?? null))
        .catch(() => {})
    }
    fetchHeartbeat()
    const interval = setInterval(fetchHeartbeat, 60000)
    return () => clearInterval(interval)
  }, [activeCampaign?.slug, activeCampaign?.role])

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

  // Cmd+K / Ctrl+K → jump to search
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        navigate('/search')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])

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
      <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-base)' }} />
    )
  }

  if (authEnabled && !isLoggedIn) {
    // Allow invite pages to render even when logged out
    if (!window.location.pathname.startsWith('/invite/')) {
      return <LandingPage />
    }
  }

  return (
    <div className="app-shell" style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {/* Sidebar */}
      <nav className="app-sidebar" style={{
        display: 'flex',
        flexDirection: 'column',
        width: '200px',
        flexShrink: 0,
        background: 'var(--bg-surface)',
        borderRight: '1px solid color-mix(in srgb, var(--accent3) 60%, transparent)',
      }}>
        {/* Logo */}
        <div className="sidebar-logo" style={{ padding: '20px 16px 16px', borderBottom: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-heading)' }}>DnD Transcriber</div>
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
          <div className="sidebar-campaign" style={{ padding: '8px 12px', borderBottom: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)', position: 'relative' }}>
            <div
              onClick={() => setCampaignDropdownOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 10px', borderRadius: '6px', cursor: 'pointer',
                background: 'var(--accent-muted)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
              }}
            >
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '1px' }}>Campaign</div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-text)' }}>
                  {activeCampaign?.name ?? 'None'}
                </div>
                {activeCampaign?.role === 'dm' && workerLastSeen && (() => {
                  const mins = Math.floor((Date.now() - new Date(workerLastSeen).getTime()) / 60000)
                  const online = mins < 3
                  const label = online ? 'Worker online' : mins < 60 ? `Worker ${mins}m ago` : 'Worker offline'
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: online ? 'var(--success)' : 'var(--error)',
                        flexShrink: 0, display: 'inline-block',
                        boxShadow: online ? '0 0 4px var(--success)' : 'none',
                      }} />
                      <span style={{ fontSize: '10px', color: online ? 'var(--success)' : 'var(--error)' }}>{label}</span>
                    </div>
                  )
                })()}
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
                background: 'var(--bg-elevated)', border: '1px solid var(--accent3)',
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
                      color: activeCampaign?.slug === c.slug ? 'var(--accent-text)' : 'var(--text-secondary)',
                      background: activeCampaign?.slug === c.slug ? 'var(--accent-muted)' : 'transparent',
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
          {navItems.map(({ to, label, Icon }) => (
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
                transition: 'all 0.15s ease',
                background: isActive ? 'color-mix(in srgb, var(--accent2) 12%, transparent)' : 'transparent',
                color: isActive ? 'var(--accent2-text)' : 'var(--text-secondary)',
                fontWeight: isActive ? 600 : 400,
                borderLeft: isActive ? '3px solid var(--accent2)' : '3px solid transparent',
                paddingLeft: isActive ? '9px' : '9px',
              })}
            >
              <Icon />
              <span style={{ flex: 1 }}>{label}</span>
              {to === '/search' && (
                <span className="nav-shortcut-hint" style={{ fontSize: '10px', color: '#334155', fontFamily: 'monospace' }}>⌘K</span>
              )}
            </NavLink>
          ))}
          {activeCampaign?.role === 'dm' && (
            <NavLink
              to="/edit-queue"
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 9px',
                borderRadius: '8px',
                fontSize: '13px',
                textDecoration: 'none',
                transition: 'all 0.15s ease',
                background: isActive ? 'color-mix(in srgb, var(--accent2) 12%, transparent)' : 'transparent',
                color: isActive ? 'var(--accent2-text)' : 'var(--text-secondary)',
                fontWeight: isActive ? 600 : 400,
                borderLeft: isActive ? '3px solid var(--accent2)' : '3px solid transparent',
              })}
              className="sidebar-nav-item"
            >
              <EditQueueIcon />
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
          <NavLink
            to="/settings"
            className="sidebar-nav-item"
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 9px',
              borderRadius: '8px',
              fontSize: '13px',
              textDecoration: 'none',
              transition: 'all 0.15s ease',
              background: isActive ? 'color-mix(in srgb, var(--accent2) 12%, transparent)' : 'transparent',
              color: isActive ? 'var(--accent2-text)' : 'var(--text-secondary)',
              fontWeight: isActive ? 600 : 400,
              borderLeft: isActive ? '3px solid var(--accent2)' : '3px solid transparent',
            })}
          >
            <GearIcon />
            <span style={{ flex: 1 }}>Preferences</span>
          </NavLink>
        </div>

        {/* User / auth section */}
        <div className="sidebar-user" style={{ padding: '12px', borderTop: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)' }}>
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
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{user.username}</div>
                  {user.is_admin && (
                    <div style={{ fontSize: '10px', color: 'var(--accent)' }}>admin</div>
                  )}
                </div>
              </div>
              <button
                onClick={logout}
                style={{
                  background: 'transparent', border: '1px solid color-mix(in srgb, var(--accent3) 70%, transparent)',
                  borderRadius: '6px', color: 'var(--text-muted)', padding: '4px 0',
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
        {/* Mobile campaign indicator — hidden on session view (has its own header) */}
        {!isSessionView && (
          <div className="mobile-campaign-bar" style={{
            display: 'none',
            padding: '8px 16px',
            background: 'var(--bg-surface)',
            borderBottom: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)',
            fontSize: '12px',
            color: 'var(--accent-text)',
            fontWeight: 600,
          }}>
            {activeCampaign?.name ?? 'No campaign'}
          </div>
        )}
        <div className="app-routes-wrapper" style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route path="/" element={<SessionsPage />} />
          <Route path="/sessions/:name" element={<SessionView />} />
          <Route path="/corrections" element={<CorrectionsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/campaigns/:slug/settings" element={<CampaignSettingsPage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/edit-queue" element={<EditQueuePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </div>
      </main>
    </div>
  )
}

function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.4 }}>🎲</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>404 — Not Found</div>
      <div style={{ fontSize: 14, color: '#475569', marginBottom: 24 }}>This page doesn't exist or has been moved.</div>
      <button
        onClick={() => navigate('/')}
        style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#fff', padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
      >
        Back to Sessions
      </button>
    </div>
  )
}
