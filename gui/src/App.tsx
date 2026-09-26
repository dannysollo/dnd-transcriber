import React, { useEffect, useState } from 'react'
import { CoverWordmark } from './Brand'
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom'
import Sheet, { SheetItem } from './Sheet'
import { MoreIcon } from './Icons'
import DesktopWorker from './DesktopWorker'
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
import QuotesPage from './pages/QuotesPage'
import { useAuth, avatarUrl } from './AuthContext'
import { useCampaign } from './CampaignContext'

const APP_VERSION = "1.0.0"

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

const QuotesNavIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 17c0-5 1.5-8 5-10M13 17c0-5 1.5-8 5-10" /><circle cx="6.5" cy="15.5" r="2.5" /><circle cx="15.5" cy="15.5" r="2.5" />
  </svg>
)

const navItems = [
  { to: '/', label: 'Sessions', Icon: ScrollIcon },
  { to: '/quotes', label: 'Quotes', Icon: QuotesNavIcon },
  { to: '/search', label: 'Search', Icon: SearchIcon },
  { to: '/campaigns', label: 'Campaign', Icon: ShieldIcon },   // points at the active campaign's settings, see campaignHref
  { to: '/corrections', label: 'Corrections', Icon: PencilIcon },
]


export default function App() {
  const { user, isLoggedIn, authEnabled, loading } = useAuth()
  const { campaigns, activeCampaign, setActiveCampaign, loading: campaignLoading } = useCampaign()
  const [campaignDropdownOpen, setCampaignDropdownOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [pendingEditCount, setPendingEditCount] = useState(0)
  const [workerLastSeen, setWorkerLastSeen] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const isSessionView = location.pathname.startsWith('/sessions/')
  const campaignHref = activeCampaign ? `/campaigns/${activeCampaign.slug}/settings` : '/campaigns'

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
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        {campaigns.length > 0 && (
          <>
            <div className="sheet-section">Campaign</div>
            {campaigns.map(c => (
              <SheetItem key={c.slug} active={activeCampaign?.slug === c.slug}
                onClick={() => { setActiveCampaign(c); setMoreOpen(false); navigate('/') }}
                note={activeCampaign?.slug === c.slug ? `current, ${c.role}` : c.role}>
                {c.name}
              </SheetItem>
            ))}
            {activeCampaign && (
              <SheetItem onClick={() => { setMoreOpen(false); navigate(`/campaigns/${activeCampaign.slug}/settings`) }}
                note="Settings, people, stats">
                Campaign settings
              </SheetItem>
            )}
            <SheetItem onClick={() => { setMoreOpen(false); navigate('/campaigns') }}>All campaigns, or start one</SheetItem>
          </>
        )}
        <div className="sheet-section">Tools</div>
        <SheetItem onClick={() => { setMoreOpen(false); navigate('/corrections') }} note="Word rules and patterns">Corrections</SheetItem>
        {activeCampaign?.role === 'dm' && (
          <SheetItem onClick={() => { setMoreOpen(false); navigate('/edit-queue') }}
            note={pendingEditCount > 0 ? `${pendingEditCount} waiting for review` : 'Nothing waiting'}>
            Edit Queue
          </SheetItem>
        )}
        <SheetItem onClick={() => { setMoreOpen(false); navigate('/settings') }} note="Reading light and more">Preferences</SheetItem>
        {isLoggedIn && user && (
          <>
            <div className="sheet-section">Signed in as {user.username}</div>
            <SheetItem onClick={() => { setMoreOpen(false); logout() }}>Log out</SheetItem>
          </>
        )}
      </Sheet>

      {/* Sidebar */}
      <nav className="app-sidebar journal-cover" aria-label="Main" style={{
        display: 'flex',
        flexDirection: 'column',
        width: '232px',
        flexShrink: 0,
      }}>
        {/* Title, as stamped on the cover */}
        <div className="sidebar-logo" style={{ padding: '28px 24px 18px' }}>
          <CoverWordmark>
            {!authEnabled && (
              <div style={{ marginTop: '6px', fontSize: '14px', color: 'var(--cover-ink-soft)' }}>
                Development build, v{APP_VERSION}
              </div>
            )}
          </CoverWordmark>
        </div>

        {/* Campaign: the book this cover belongs to */}
        {!campaignLoading && campaigns.length > 0 && (
          <div className="sidebar-campaign" style={{ margin: '0 16px 18px', position: 'relative' }}>
            <button
              type="button"
              onClick={() => setCampaignDropdownOpen(o => !o)}
              aria-haspopup="listbox"
              aria-expanded={campaignDropdownOpen}
              style={{
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px',
                width: '100%', textAlign: 'left', padding: '10px 8px',
                background: 'none', border: 'none',
                borderTop: '1px solid var(--gilt)', borderBottom: '1px solid var(--gilt)',
                cursor: 'pointer',
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '14px', color: 'var(--cover-ink-soft)' }}>Campaign</span>
                <span style={{ display: 'block', fontSize: '18px', color: 'var(--cover-ink)', lineHeight: 1.25 }}>
                  {activeCampaign?.name ?? 'None chosen'}
                </span>
                {activeCampaign?.role === 'dm' && workerLastSeen && (() => {
                  const mins = Math.floor((Date.now() - new Date(workerLastSeen).getTime()) / 60000)
                  const online = mins < 3
                  const label = online ? 'Worker online' : mins < 60 ? `Worker seen ${mins}m ago` : 'Worker offline'
                  return (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: '14px', color: 'var(--cover-ink-soft)' }}>
                      <span aria-hidden style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: online ? 'var(--moss)' : 'transparent',
                        border: online ? 'none' : '1px solid var(--cover-ink-soft)',
                      }} />
                      {label}
                    </span>
                  )
                })()}
              </span>
              {(
                <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ marginTop: 22, color: 'var(--cover-ink-soft)', transform: campaignDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              )}
            </button>

            {campaignDropdownOpen && (
              <div role="listbox" style={{
                position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)',
                background: 'var(--page-raised)', color: 'var(--ink)',
                border: '1px solid var(--rule-strong)', borderRadius: '3px',
                zIndex: 100, overflow: 'hidden', boxShadow: 'var(--shadow)',
              }}>
                {campaigns.map(c => {
                  const on = activeCampaign?.slug === c.slug
                  return (
                    <button
                      key={c.slug}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => {
                        setActiveCampaign(c); setCampaignDropdownOpen(false)
                        // On a campaign's settings page, switching follows to the new campaign's.
                        if (/^\/campaigns\/[^/]+/.test(location.pathname)) navigate(`/campaigns/${c.slug}/settings`)
                      }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px', fontSize: '16px', cursor: 'pointer', border: 'none',
                        color: on ? 'var(--rubric)' : 'var(--ink)',
                        background: on ? 'color-mix(in srgb, var(--rubric) 8%, transparent)' : 'transparent',
                      }}
                    >
                      {c.name}
                      <span style={{ fontSize: '14px', color: 'var(--ink-faint)', marginLeft: '6px' }}>{c.role}</span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => { setCampaignDropdownOpen(false); navigate('/campaigns') }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: '15px',
                    cursor: 'pointer', border: 'none', borderTop: '1px solid var(--rule)',
                    color: 'var(--ink-soft)', background: 'transparent',
                  }}
                >
                  All campaigns, or start one
                </button>
              </div>
            )}
          </div>
        )}

        {/* Contents */}
        <div className="sidebar-nav" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {navItems.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              // "Campaign" opens the active campaign's settings (the list lives in the selector above).
              to={to === '/campaigns' ? campaignHref : to}
              end={to === '/'}
              // A session page is still inside "Sessions"; any /campaigns page is inside "Campaign".
              className={({ isActive }) => 'cover-link' + (to === '/campaigns' || to === '/corrections' ? ' nav-secondary' : '') + (isActive || (to === '/' && isSessionView) || (to === '/campaigns' && location.pathname.startsWith('/campaigns')) ? ' active' : '')}
            >
              <Icon />
              <span style={{ flex: 1 }}>{label}</span>
              {to === '/search' && (
                <kbd className="nav-shortcut-hint">Ctrl K</kbd>
              )}
            </NavLink>
          ))}
          {activeCampaign?.role === 'dm' && (
            <NavLink to="/edit-queue" className="cover-link sidebar-nav-item nav-secondary">
              <EditQueueIcon />
              <span style={{ flex: 1 }}>Edit Queue</span>
              {pendingEditCount > 0 && (
                <span aria-label={`${pendingEditCount} pending`} style={{
                  fontSize: '14px', fontVariantNumeric: 'lining-nums',
                  background: 'var(--gilt)', color: 'var(--cover)',
                  borderRadius: '3px', padding: '0 7px', minWidth: '20px', textAlign: 'center',
                }}>
                  {pendingEditCount}
                </span>
              )}
            </NavLink>
          )}
          <NavLink to="/settings" className="cover-link sidebar-nav-item nav-secondary">
            <GearIcon />
            <span style={{ flex: 1 }}>Preferences</span>
          </NavLink>
          {/* Phones: the bar keeps Sessions, Quotes and Search; the rest live under More. */}
          <button type="button" className="cover-link sidebar-nav-item nav-more" onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog" aria-expanded={moreOpen}>
            <MoreIcon size={18} />
            <span style={{ flex: 1 }}>More{activeCampaign?.role === 'dm' && pendingEditCount > 0 ? ` (${pendingEditCount})` : ''}</span>
          </button>
        </div>

        <DesktopWorker />

        {/* Owner's name, inside the back cover */}
        <div className="sidebar-user" style={{ padding: '16px 24px 22px', borderTop: '1px solid color-mix(in srgb, var(--gilt) 45%, transparent)' }}>
          {loading ? null : isLoggedIn && user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                onClick={() => navigate('/campaigns')}
                title="Your campaigns"
                style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', flex: 1, minWidth: 0, textAlign: 'left' }}
              >
                <img src={avatarUrl(user)} alt="" style={{ width: 28, height: 28, borderRadius: '50%', boxShadow: '0 0 0 1px var(--gilt)' }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '16px', color: 'var(--cover-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.username}</span>
                  {user.is_admin && <span style={{ display: 'block', fontSize: '13px', color: 'var(--cover-ink-soft)' }}>admin</span>}
                </span>
              </button>
              <button
                type="button"
                onClick={logout}
                style={{ background: 'none', border: 'none', color: 'var(--cover-ink-soft)', fontSize: '15px', cursor: 'pointer', padding: '2px 0', textDecoration: 'underline', textUnderlineOffset: 3 }}
              >
                Log out
              </button>
            </div>
          ) : authEnabled ? (
            <a
              href="/auth/discord"
              style={{
                display: 'block', textAlign: 'center',
                background: '#5865f2', color: '#fff', borderRadius: '3px',
                padding: '7px 0', textDecoration: 'none', fontSize: '16px',
              }}
            >
              Log in with Discord
            </a>
          ) : null}
        </div>
      </nav>

      {/* Main content */}
      {/* Session view pins its header/tabs and scrolls only its content pane,
          so main must be a height-bounded flex column there (mobile CSS does
          this for every page). Other pages scroll main itself. */}
      <main className="app-main" style={isSessionView
        ? { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--page)' }
        : { flex: 1, overflow: 'auto', background: 'var(--page)' }}>
        {/* Mobile campaign indicator — hidden on session view (has its own header) */}
        {!isSessionView && (
          <div className="mobile-campaign-bar" style={{
            display: 'none',
            padding: '8px 16px',
            background: 'var(--page)',
            borderBottom: '1px solid var(--rule)',
            fontSize: '15px',
            fontVariant: 'small-caps',
            letterSpacing: '0.04em',
            color: 'var(--ink-soft)',
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
          <Route path="/campaigns/:slug" element={<CampaignRedirect />} />
          <Route path="/sessions" element={<Navigate to="/" replace />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/edit-queue" element={<EditQueuePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/quotes" element={<QuotesPage />} />
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
      <div style={{ fontSize: 34, color: 'var(--ink)', marginBottom: 8 }}>This page isn't in the journal</div>
      <div style={{ fontSize: 17, color: 'var(--ink-soft)', marginBottom: 24 }}>The link may be old, or the page was moved.</div>
      <button
        onClick={() => navigate('/')}
        style={{ background: 'var(--accent)', border: 'none', borderRadius: 3, color: 'var(--on-rubric)', padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
      >
        Back to Sessions
      </button>
    </div>
  )
}

/** /campaigns/<slug> has no page of its own; its settings page is the campaign's home. */
function CampaignRedirect() {
  const { slug } = useParams()
  return <Navigate to={`/campaigns/${slug}/settings`} replace />
}
