import { useToast } from '../Toast'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'

interface Campaign {
  id: number
  slug: string
  name: string
  description: string | null
  owner_id: number
  data_path: string
  settings: Record<string, unknown>
  created_at: string
  role?: string
  session_count?: number
  member_count?: number
}

export default function CampaignsPage() {
  const { user, isLoggedIn, authEnabled } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/campaigns')
      if (r.ok) setCampaigns(await r.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const createCampaign = async () => {
    if (!slug.trim() || !name.trim()) return
    setCreating(true)
    try {
      const r = await fetch('/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug.trim(), name: name.trim(), description: description.trim() || null }),
      })
      if (r.ok) {
        setShowCreate(false)
        setSlug(''); setName(''); setDescription('')
        load()
      } else {
        const err = await r.json()
        toast(err.detail || 'Error creating campaign', 'error')
      }
    } finally {
      setCreating(false)
    }
  }

  if (authEnabled && !isLoggedIn) {
    return (
      <div style={{ padding: '32px', color: '#64748b' }}>
        Please <a href="/auth/discord" style={{ color: '#7c6cfc' }}>log in</a> to view campaigns.
      </div>
    )
  }

  return (
    <div className="page-content" style={{ padding: '32px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#e2e8f0' }}>Campaigns</h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            {user ? `Campaigns for ${user.username}` : 'All campaigns'}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(v => !v)}
          style={{
            background: '#7c6cfc', border: 'none', borderRadius: '8px', color: '#fff',
            padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
          }}
        >
          + New Campaign
        </button>
      </div>

      {showCreate && (
        <div style={{
          background: '#13151f', border: '1px solid #2a2d3a', borderRadius: '12px',
          padding: '24px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px',
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>New Campaign</div>
          <Field label="Slug (URL-safe, e.g. as-above-so-below)">
            <input
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="my-campaign"
              style={inputStyle}
            />
          </Field>
          <Field label="Name">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="As Above So Below" style={inputStyle} />
          </Field>
          <Field label="Description (optional)">
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="A dark fantasy campaign..." style={inputStyle} />
          </Field>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={createCampaign}
              disabled={creating || !slug.trim() || !name.trim()}
              style={{
                background: '#7c6cfc', border: 'none', borderRadius: '8px', color: '#fff',
                padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                opacity: (creating || !slug.trim() || !name.trim()) ? 0.5 : 1,
              }}
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              style={{
                background: 'transparent', border: '1px solid #2a2d3a', borderRadius: '8px',
                color: '#94a3b8', padding: '8px 16px', fontSize: '13px', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', fontSize: '14px' }}>Loading...</div>
      ) : campaigns.length === 0 ? (
        <div style={{
          background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '12px',
          padding: '48px', textAlign: 'center', color: '#64748b',
        }}>
          No campaigns yet. Create one above.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {campaigns.map(c => (
            <div
              key={c.id}
              style={{
                background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '10px',
                padding: '16px 20px', transition: 'border-color 0.15s',
                display: 'flex', alignItems: 'center', gap: '12px',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#3a3d4a')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2d3a')}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>{c.name}</div>
                {c.description && (
                  <div style={{ fontSize: '12px', color: '#64748b', marginBottom: 4 }}>{c.description}</div>
                )}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', color: '#334155' }}>/{c.slug}</span>
                  {c.session_count !== undefined && (
                    <span style={{ fontSize: '11px', color: '#475569' }}>📜 {c.session_count} session{c.session_count !== 1 ? 's' : ''}</span>
                  )}
                  {c.member_count !== undefined && (
                    <span style={{ fontSize: '11px', color: '#475569' }}>👥 {c.member_count} member{c.member_count !== 1 ? 's' : ''}</span>
                  )}
                  {c.role && (
                    <span style={{ fontSize: '10px', color: '#475569', background: 'rgba(255,255,255,0.04)', border: '1px solid #2a2d3a', borderRadius: 4, padding: '1px 6px' }}>{c.role}</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <button
                  onClick={() => navigate('/')}
                  style={{
                    background: 'rgba(124,108,252,0.1)', border: '1px solid rgba(124,108,252,0.25)',
                    borderRadius: 7, color: '#a89cff', padding: '5px 12px', fontSize: '12px',
                    fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Sessions
                </button>
                <button
                  onClick={() => navigate(`/campaigns/${c.slug}/settings`)}
                  style={{
                    background: 'transparent', border: '1px solid #2a2d3a',
                    borderRadius: 7, color: '#64748b', padding: '5px 12px', fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Settings
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '8px',
  color: '#e2e8f0', padding: '8px 12px', fontSize: '13px', outline: 'none', width: '100%',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  )
}
