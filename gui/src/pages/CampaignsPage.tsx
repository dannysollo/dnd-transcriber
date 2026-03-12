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
}

export default function CampaignsPage() {
  const { user, isLoggedIn, authEnabled } = useAuth()
  const navigate = useNavigate()
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
        alert(err.detail || 'Error creating campaign')
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
    <div style={{ padding: '32px', maxWidth: '900px' }}>
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
              onClick={() => navigate(`/campaigns/${c.slug}/settings`)}
              style={{
                background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '10px',
                padding: '16px 20px', cursor: 'pointer', transition: 'border-color 0.15s',
                display: 'flex', alignItems: 'center', gap: '12px',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#7c6cfc')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2d3a')}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0' }}>{c.name}</div>
                {c.description && (
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{c.description}</div>
                )}
                <div style={{ fontSize: '11px', color: '#334155', marginTop: '4px' }}>/{c.slug}</div>
              </div>
              <div style={{ fontSize: '12px', color: '#475569' }}>
                {new Date(c.created_at).toLocaleDateString()}
              </div>
              <span style={{ color: '#475569', fontSize: '14px' }}>→</span>
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
