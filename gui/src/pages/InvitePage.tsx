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
        setTimeout(() => navigate('/'), 1500)
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
      height: '100vh', background: 'var(--bg-base)',
    }}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '16px',
        padding: '40px 48px', maxWidth: '400px', width: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px',
        textAlign: 'center',
      }}>
        {loading && <div style={{ color: 'var(--ink-faint)' }}>Loading invite...</div>}

        {!loading && error && (
          <>
            <div style={{ fontSize: '38px' }}>❌</div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--rubric)' }}>Invalid Invite</div>
            <div style={{ fontSize: '16px', color: 'var(--ink-faint)' }}>{error}</div>
          </>
        )}

        {!loading && invite && !error && (
          <>
            <div style={{ fontSize: '46px' }}>🎲</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--ink)' }}>
              {invite.campaign_name}
            </div>

            {joined ? (
              <>
                <div style={{ fontSize: '38px' }}>✅</div>
                <div style={{ fontSize: '17px', color: 'var(--moss)' }}>
                  You've joined as <strong>{invite.role}</strong>! Redirecting...
                </div>
              </>
            ) : !invite.valid ? (
              <>
                <div style={{ fontSize: '17px', color: 'var(--rubric)' }}>
                  {invite.expired ? 'This invite has expired.' : 'This invite has reached its maximum uses.'}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '16px', color: 'var(--ink-soft)' }}>
                  You've been invited to join as a{' '}
                  <strong style={{ color: 'var(--accent-text)' }}>{invite.role}</strong>.
                </div>

                {authEnabled && !isLoggedIn ? (
                  <>
                    <div style={{ fontSize: '15px', color: 'var(--ink-faint)' }}>
                      You need to log in to accept this invite.
                    </div>
                    <button
                      onClick={() => {
                        localStorage.setItem('pendingInviteToken', token ?? '')
                        window.location.href = '/auth/discord'
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        background: '#5865f2', color: '#fff', borderRadius: '3px',
                        padding: '10px 20px', border: 'none', cursor: 'pointer',
                        fontWeight: 600, fontSize: '16px',
                      }}
                    >
                      Login with Discord to Join
                    </button>
                  </>
                ) : (
                  <>
                    {error && <div style={{ fontSize: '15px', color: 'var(--rubric)' }}>{error}</div>}
                    <button
                      onClick={joinCampaign}
                      disabled={joining}
                      style={{
                        background: 'var(--accent)', border: 'none', borderRadius: '3px', color: 'var(--on-rubric)',
                        padding: '12px 28px', fontSize: '17px', fontWeight: 600, cursor: 'pointer',
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
