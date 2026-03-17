import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'

interface InviteInfo {
  token: string
  campaign_name: string
  campaign_slug: string
  role: string
  expired: boolean
  maxed: boolean
  valid: boolean
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const { isLoggedIn, authEnabled } = useAuth()
  const navigate = useNavigate()
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [joined, setJoined] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    fetch(`/invites/${token}`)
      .then(r => {
        if (!r.ok) throw new Error('Invite not found')
        return r.json()
      })
      .then(setInvite)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  const joinCampaign = async () => {
    if (!token) return
    setJoining(true)
    setError(null)
    try {
      const r = await fetch(`/invites/${token}/use`, { method: 'POST' })
      if (r.ok) {
        setJoined(true)
        setTimeout(() => { window.location.href = '/campaigns' }, 1500)
      } else {
        const data = await r.json()
        setError(data.detail || 'Failed to join campaign')
      }
    } finally {
      setJoining(false)
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0f1117',
    }}>
      <div style={{
        background: '#13151f', border: '1px solid #1e2130', borderRadius: '16px',
        padding: '40px 48px', maxWidth: '400px', width: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px',
        textAlign: 'center',
      }}>
        {loading && <div style={{ color: '#64748b' }}>Loading invite...</div>}

        {!loading && error && (
          <>
            <div style={{ fontSize: '32px' }}>❌</div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#f87171' }}>Invalid Invite</div>
            <div style={{ fontSize: '13px', color: '#64748b' }}>{error}</div>
          </>
        )}

        {!loading && invite && !error && (
          <>
            <div style={{ fontSize: '40px' }}>🎲</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#e2e8f0' }}>
              {invite.campaign_name}
            </div>

            {joined ? (
              <>
                <div style={{ fontSize: '32px' }}>✅</div>
                <div style={{ fontSize: '14px', color: '#4ade80' }}>
                  You've joined as <strong>{invite.role}</strong>! Redirecting...
                </div>
              </>
            ) : !invite.valid ? (
              <>
                <div style={{ fontSize: '14px', color: '#f87171' }}>
                  {invite.expired ? 'This invite has expired.' : 'This invite has reached its maximum uses.'}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                  You've been invited to join as a{' '}
                  <strong style={{ color: '#a89cff' }}>{invite.role}</strong>.
                </div>

                {authEnabled && !isLoggedIn ? (
                  <>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                      You need to log in to accept this invite.
                    </div>
                    <button
                      onClick={() => {
                        localStorage.setItem('pendingInviteToken', token ?? '')
                        window.location.href = '/auth/discord'
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        background: '#5865f2', color: '#fff', borderRadius: '10px',
                        padding: '10px 20px', border: 'none', cursor: 'pointer',
                        fontWeight: 600, fontSize: '13px',
                      }}
                    >
                      Login with Discord to Join
                    </button>
                  </>
                ) : (
                  <>
                    {error && <div style={{ fontSize: '12px', color: '#f87171' }}>{error}</div>}
                    <button
                      onClick={joinCampaign}
                      disabled={joining}
                      style={{
                        background: '#7c6cfc', border: 'none', borderRadius: '10px', color: '#fff',
                        padding: '12px 28px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                        opacity: joining ? 0.6 : 1,
                      }}
                    >
                      {joining ? 'Joining...' : 'Accept Invite'}
                    </button>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
