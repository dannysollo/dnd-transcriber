import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../AuthContext'

interface Campaign {
  id: number
  slug: string
  name: string
  description: string | null
  owner_id: number
  settings: {
    require_edit_approval?: boolean
    discord_webhook_url?: string | null
    discord_channel_id?: string | null
  }
}

interface Member {
  id: number
  user_id: number
  username: string
  discord_id: string
  avatar: string | null
  role: string
  joined_at: string
}

interface Invite {
  id: number
  token: string
  role: string
  expires_at: string | null
  max_uses: number | null
  use_count: number
  created_at: string
}

export default function CampaignSettingsPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user } = useAuth()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'settings' | 'members' | 'invites' | 'worker'>('settings')

  // Settings form state
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [requireApproval, setRequireApproval] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [channelId, setChannelId] = useState('')
  const [saving, setSaving] = useState(false)

  // Worker state
  const [workerKey, setWorkerKey] = useState<string | null>(null)
  const [workerLastSeen, setWorkerLastSeen] = useState<string | null>(null)
  const [workerKeyVisible, setWorkerKeyVisible] = useState(false)
  const [generatingKey, setGeneratingKey] = useState(false)
  const [myRole, setMyRole] = useState<string | null>(null)

  // Invite form state
  const [inviteRole, setInviteRole] = useState('player')
  const [inviteDays, setInviteDays] = useState('')
  const [inviteMaxUses, setInviteMaxUses] = useState('')
  const [creatingInvite, setCreatingInvite] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [cResp, mResp, iResp] = await Promise.all([
        fetch(`/campaigns/${slug}`),
        fetch(`/campaigns/${slug}/members`),
        fetch(`/campaigns/${slug}/invites`),
      ])
      if (cResp.ok) {
        const c = await cResp.json()
        setCampaign(c)
        setEditName(c.name)
        setEditDesc(c.description ?? '')
        setRequireApproval(c.settings?.require_edit_approval ?? false)
        setWebhookUrl(c.settings?.discord_webhook_url ?? '')
        setChannelId(c.settings?.discord_channel_id ?? '')
      }
      if (mResp.ok) {
        const ms = await mResp.json()
        setMembers(ms)
        const me = ms.find((m: Member) => m.user_id === user?.id)
        if (me) setMyRole(me.role)
      }
      if (iResp.ok) setInvites(await iResp.json())
    } finally {
      setLoading(false)
    }
  }

  const loadWorkerKey = async () => {
    const r = await fetch(`/campaigns/${slug}/worker-key`)
    if (r.ok) {
      const data = await r.json()
      setWorkerKey(data.api_key)
      setWorkerLastSeen(data.last_seen)
    }
  }

  const generateWorkerKey = async () => {
    setGeneratingKey(true)
    try {
      const r = await fetch(`/campaigns/${slug}/worker-key`, { method: 'POST' })
      if (r.ok) {
        const data = await r.json()
        setWorkerKey(data.api_key)
        setWorkerKeyVisible(true)
      } else {
        alert('Failed to generate key')
      }
    } finally {
      setGeneratingKey(false)
    }
  }

  useEffect(() => { if (slug) load() }, [slug])
  useEffect(() => { if (slug && myRole === 'dm') loadWorkerKey() }, [slug, myRole])

  const saveSettings = async () => {
    if (!campaign) return
    setSaving(true)
    try {
      const r = await fetch(`/campaigns/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          description: editDesc || null,
          settings: {
            ...campaign.settings,
            require_edit_approval: requireApproval,
            discord_webhook_url: webhookUrl || null,
            discord_channel_id: channelId || null,
          },
        }),
      })
      if (r.ok) await load()
      else alert('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const changeRole = async (userId: number, role: string) => {
    await fetch(`/campaigns/${slug}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    load()
  }

  const removeMember = async (userId: number) => {
    if (!confirm('Remove this member?')) return
    await fetch(`/campaigns/${slug}/members/${userId}`, { method: 'DELETE' })
    load()
  }

  const createInvite = async () => {
    setCreatingInvite(true)
    try {
      const body: Record<string, unknown> = { role: inviteRole }
      if (inviteDays) body.expires_in_days = parseInt(inviteDays)
      if (inviteMaxUses) body.max_uses = parseInt(inviteMaxUses)
      const r = await fetch(`/campaigns/${slug}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.ok) {
        setInviteRole('player'); setInviteDays(''); setInviteMaxUses('')
        load()
      } else {
        alert('Failed to create invite')
      }
    } finally {
      setCreatingInvite(false)
    }
  }

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/invite/${token}`
    navigator.clipboard.writeText(url).then(() => alert('Invite link copied!'))
  }

  if (loading) return <div style={{ padding: '32px', color: '#64748b' }}>Loading...</div>
  if (!campaign) return <div style={{ padding: '32px', color: '#f87171' }}>Campaign not found.</div>

  return (
    <div style={{ padding: '32px', maxWidth: '860px' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: 700, color: '#e2e8f0' }}>
        {campaign.name}
      </h1>
      <div style={{ fontSize: '12px', color: '#475569', marginBottom: '24px' }}>/{campaign.slug}</div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid #1e2130', paddingBottom: '0' }}>
        {(['settings', 'members', 'invites', ...(myRole === 'dm' ? ['worker'] : [])] as ('settings' | 'members' | 'invites' | 'worker')[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '8px 16px', fontSize: '13px', fontWeight: 600,
              color: tab === t ? '#a89cff' : '#64748b',
              borderBottom: tab === t ? '2px solid #7c6cfc' : '2px solid transparent',
              marginBottom: '-1px',
              textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '480px' }}>
          <Field label="Campaign Name">
            <input value={editName} onChange={e => setEditName(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Description">
            <input value={editDesc} onChange={e => setEditDesc(e.target.value)} style={inputStyle} placeholder="Optional" />
          </Field>
          <Field label="Discord Webhook URL">
            <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} style={inputStyle} placeholder="https://discord.com/api/webhooks/..." />
          </Field>
          <Field label="Discord Channel ID">
            <input value={channelId} onChange={e => setChannelId(e.target.value)} style={inputStyle} placeholder="123456789" />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: '#94a3b8' }}>
            <input type="checkbox" checked={requireApproval} onChange={e => setRequireApproval(e.target.checked)} />
            Require edit approval for transcript changes
          </label>
          <button
            onClick={saveSettings}
            disabled={saving}
            style={{
              background: '#7c6cfc', border: 'none', borderRadius: '8px', color: '#fff',
              padding: '10px 20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              opacity: saving ? 0.6 : 1, alignSelf: 'flex-start',
            }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}

      {tab === 'members' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {members.map(m => (
            <div key={m.id} style={{
              background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '10px',
              padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px',
            }}>
              {m.avatar && (
                <img
                  src={`https://cdn.discordapp.com/avatars/${m.discord_id}/${m.avatar}.png?size=32`}
                  style={{ width: 32, height: 32, borderRadius: '50%' }}
                  alt=""
                />
              )}
              <div style={{ flex: 1, fontSize: '14px', color: '#e2e8f0', fontWeight: 500 }}>
                {m.username}
              </div>
              <select
                value={m.role}
                onChange={e => changeRole(m.user_id, e.target.value)}
                disabled={m.user_id === user?.id}
                style={{
                  background: '#0f1117', border: '1px solid #2a2d3a', borderRadius: '6px',
                  color: '#94a3b8', padding: '4px 8px', fontSize: '12px',
                }}
              >
                <option value="spectator">Spectator</option>
                <option value="player">Player</option>
                <option value="dm">DM</option>
              </select>
              {m.user_id !== user?.id && (
                <button
                  onClick={() => removeMember(m.user_id)}
                  style={{
                    background: 'transparent', border: '1px solid rgba(248,113,113,0.3)',
                    borderRadius: '6px', color: '#f87171', padding: '4px 10px', fontSize: '12px', cursor: 'pointer',
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'worker' && myRole === 'dm' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '540px' }}>
          <div style={{ fontSize: '13px', color: '#94a3b8', lineHeight: '1.5' }}>
            Install the worker package on the transcription machine, then paste this key into <code style={{ background: '#1a1d27', padding: '1px 5px', borderRadius: '4px' }}>worker.yaml</code>.
          </div>
          <div style={{ background: '#13151f', border: '1px solid #2a2d3a', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>Worker API Key</div>
            {workerKey ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <code style={{
                  flex: 1, background: '#0f1117', border: '1px solid #2a2d3a', borderRadius: '6px',
                  padding: '8px 12px', fontSize: '12px', color: '#a89cff', fontFamily: 'monospace',
                  overflowX: 'auto', whiteSpace: 'nowrap',
                }}>
                  {workerKeyVisible ? workerKey : '•'.repeat(32)}
                </code>
                <button
                  onClick={() => setWorkerKeyVisible(v => !v)}
                  style={{ background: 'transparent', border: '1px solid #2a2d3a', borderRadius: '6px', color: '#64748b', padding: '6px 10px', fontSize: '12px', cursor: 'pointer' }}
                >
                  {workerKeyVisible ? 'Hide' : 'Show'}
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(workerKey).then(() => alert('Key copied!'))}
                  style={{ background: 'rgba(124,108,252,0.1)', border: '1px solid rgba(124,108,252,0.3)', borderRadius: '6px', color: '#a89cff', padding: '6px 10px', fontSize: '12px', cursor: 'pointer' }}
                >
                  Copy
                </button>
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: '#64748b' }}>No key generated yet.</div>
            )}
            <button
              onClick={generateWorkerKey}
              disabled={generatingKey}
              style={{
                background: '#7c6cfc', border: 'none', borderRadius: '8px', color: '#fff',
                padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                opacity: generatingKey ? 0.6 : 1, alignSelf: 'flex-start',
              }}
            >
              {generatingKey ? 'Generating...' : workerKey ? 'Rotate Key' : 'Generate Key'}
            </button>
          </div>
          <div style={{ fontSize: '12px', color: '#475569' }}>
            Last worker heartbeat: {workerLastSeen ? (() => {
              const ms = Date.now() - new Date(workerLastSeen).getTime()
              const mins = Math.floor(ms / 60000)
              return mins < 1 ? 'just now' : `${mins} minute${mins === 1 ? '' : 's'} ago`
            })() : 'Never'}
          </div>
        </div>
      )}

      {tab === 'invites' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Create invite form */}
          <div style={{
            background: '#13151f', border: '1px solid #2a2d3a', borderRadius: '12px',
            padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>Create Invite Link</div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <Field label="Role to grant">
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                  <option value="spectator">Spectator</option>
                  <option value="player">Player</option>
                  <option value="dm">DM</option>
                </select>
              </Field>
              <Field label="Expires in (days, optional)">
                <input
                  type="number" value={inviteDays} onChange={e => setInviteDays(e.target.value)}
                  placeholder="Never" style={{ ...inputStyle, width: '120px' }} min="1"
                />
              </Field>
              <Field label="Max uses (optional)">
                <input
                  type="number" value={inviteMaxUses} onChange={e => setInviteMaxUses(e.target.value)}
                  placeholder="Unlimited" style={{ ...inputStyle, width: '120px' }} min="1"
                />
              </Field>
            </div>
            <button
              onClick={createInvite}
              disabled={creatingInvite}
              style={{
                background: '#7c6cfc', border: 'none', borderRadius: '8px', color: '#fff',
                padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                opacity: creatingInvite ? 0.6 : 1, alignSelf: 'flex-start',
              }}
            >
              Generate Link
            </button>
          </div>

          {/* Invite list */}
          {invites.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#64748b' }}>No invite links yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {invites.map(i => (
                <div key={i.id} style={{
                  background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '10px',
                  padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', fontFamily: 'monospace', color: '#a89cff' }}>{i.token}</div>
                    <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>
                      Role: <strong style={{ color: '#94a3b8' }}>{i.role}</strong>
                      {' · '}Uses: {i.use_count}{i.max_uses ? `/${i.max_uses}` : ''}
                      {i.expires_at && ` · Expires: ${new Date(i.expires_at).toLocaleDateString()}`}
                    </div>
                  </div>
                  <button
                    onClick={() => copyInviteLink(i.token)}
                    style={{
                      background: 'rgba(124,108,252,0.1)', border: '1px solid rgba(124,108,252,0.3)',
                      borderRadius: '6px', color: '#a89cff', padding: '4px 12px', fontSize: '12px', cursor: 'pointer',
                    }}
                  >
                    Copy Link
                  </button>
                </div>
              ))}
            </div>
          )}
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
