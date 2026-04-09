import { useToast } from '../Toast'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { useApiUrl } from '../CampaignContext'

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
    vault_repo_url?: string | null
    vault_github_token?: string | null
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
  const { toast } = useToast()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'settings' | 'config' | 'members' | 'invites' | 'worker'>('settings')
  const apiUrl = useApiUrl()

  // Config tab state (mirrors SettingsPage)
  const [config, setConfig] = useState<Record<string, any> | null>(null)
  const [configLoading, setConfigLoading] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [configSaved, setConfigSaved] = useState(false)

  // Settings form state
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [requireApproval, setRequireApproval] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [channelId, setChannelId] = useState('')
  const [vaultRepoUrl, setVaultRepoUrl] = useState('')
  const [vaultGithubToken, setVaultGithubToken] = useState('')
  const [vaultTesting, setVaultTesting] = useState(false)
  const [vaultTestResult, setVaultTestResult] = useState<{ ok: boolean; message: string } | null>(null)
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
        setVaultRepoUrl(c.settings?.vault_repo_url ?? '')
        setVaultGithubToken(c.settings?.vault_github_token ?? '')
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

  const loadConfig = async () => {
    setConfigLoading(true)
    try {
      const r = await fetch(apiUrl('/config'))
      if (r.ok) setConfig(await r.json())
    } finally {
      setConfigLoading(false)
    }
  }

  const saveConfig = async () => {
    if (!config) return
    setConfigSaving(true)
    try {
      const r = await fetch(apiUrl('/config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      setConfigSaving(false)
      if (r.ok) {
        setConfigSaved(true)
        setTimeout(() => setConfigSaved(false), 2000)
        toast('Config saved', 'success')
      } else {
        toast('Failed to save config', 'error')
      }
    } finally {
      setConfigSaving(false)
    }
  }

  const updateConfigField = (key: string, value: any) => {
    setConfig(prev => prev ? { ...prev, [key]: value } : prev)
  }

  const updateConfigPlayer = (username: string, field: string, value: any) => {
    setConfig(prev => {
      if (!prev) return prev
      return {
        ...prev,
        players: {
          ...prev.players,
          [username]: { ...prev.players[username], [field]: value },
        },
      }
    })
  }

  const addConfigPlayer = () => {
    const username = prompt('Discord username (must match Craig audio filename):')
    if (!username) return
    setConfig(prev => {
      if (!prev) return prev
      return {
        ...prev,
        players: {
          ...prev.players,
          [username]: { name: username, character: null, role: 'player' },
        },
      }
    })
  }

  const removeConfigPlayer = (username: string) => {
    setConfig(prev => {
      if (!prev) return prev
      const players = { ...prev.players }
      delete players[username]
      return { ...prev, players }
    })
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
        toast('Failed to generate key', 'error')
      }
    } finally {
      setGeneratingKey(false)
    }
  }

  useEffect(() => { if (slug) load() }, [slug])
  useEffect(() => { if (slug && myRole === 'dm') loadWorkerKey() }, [slug, myRole])
  useEffect(() => { if (tab === 'config' && !config && !configLoading) loadConfig() }, [tab])

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
            vault_repo_url: vaultRepoUrl || null,
            vault_github_token: vaultGithubToken || null,
          },
        }),
      })
      if (r.ok) await load()
      else toast('Failed to save settings', 'error')
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
        toast('Failed to create invite', 'error')
      }
    } finally {
      setCreatingInvite(false)
    }
  }

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/invite/${token}`
    navigator.clipboard.writeText(url).then(() => toast('Invite link copied!', 'success'))
  }

  if (loading) return <div style={{ padding: '32px', color: '#64748b' }}>Loading...</div>
  if (!campaign) return <div style={{ padding: '32px', color: '#f87171' }}>Campaign not found.</div>

  return (
    <div className="page-content" style={{ padding: '32px', maxWidth: '860px' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: 700, color: '#e2e8f0' }}>
        {campaign.name}
      </h1>
      <div style={{ fontSize: '12px', color: '#475569', marginBottom: '24px' }}>/{campaign.slug}</div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0' }}>
        {(['settings', 'config', 'members', 'invites', ...(myRole === 'dm' ? ['worker'] : [])] as ('settings' | 'config' | 'members' | 'invites' | 'worker')[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '8px 16px', fontSize: '13px', fontWeight: 600,
              color: tab === t ? 'var(--accent-text)' : '#64748b',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
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
          <Field label="Obsidian Vault GitHub Repo">
            <input
              value={vaultRepoUrl}
              onChange={e => { setVaultRepoUrl(e.target.value); setVaultTestResult(null) }}
              style={inputStyle}
              placeholder="https://github.com/username/vault-repo"
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <button
                onClick={async () => {
                  setVaultTesting(true)
                  setVaultTestResult(null)
                  try {
                    // Save the current vault URL before testing so the server has the latest value
                    await fetch(`/campaigns/${campaign?.slug}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        settings: { ...campaign?.settings, vault_repo_url: vaultRepoUrl || null, vault_github_token: vaultGithubToken || null },
                      }),
                    })
                    const r = await fetch(`/campaigns/${campaign?.slug}/vault/test`, { method: 'POST' })
                    const data = await r.json()
                    setVaultTestResult(data)
                  } catch {
                    setVaultTestResult({ ok: false, message: 'Request failed' })
                  } finally {
                    setVaultTesting(false)
                  }
                }}
                disabled={vaultTesting || !vaultRepoUrl.trim()}
                style={{
                  background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)',
                  borderRadius: 6, color: '#93c5fd', padding: '4px 12px', fontSize: 12,
                  fontWeight: 600, cursor: 'pointer', opacity: (vaultTesting || !vaultRepoUrl.trim()) ? 0.5 : 1,
                }}
              >
                {vaultTesting ? 'Testing…' : 'Test Connection'}
              </button>
              {vaultTestResult && (
                <span style={{ fontSize: 12, color: vaultTestResult.ok ? '#4ade80' : '#f87171' }}>
                  {vaultTestResult.message}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
              Wiki edits will be committed and pushed to this repo.
            </div>
          </Field>
          <Field label="GitHub Token (for vault repo)">
            <input
              type="password"
              value={vaultGithubToken}
              onChange={e => setVaultGithubToken(e.target.value)}
              style={inputStyle}
              placeholder="ghp_xxxxxxxxxxxx"
              autoComplete="off"
            />
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
              Personal access token with repo write access. Stored per-campaign — each user can provide their own.
            </div>
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: '#94a3b8' }}>
            <input type="checkbox" checked={requireApproval} onChange={e => setRequireApproval(e.target.checked)} />
            Require edit approval for transcript changes
          </label>
          <button
            onClick={saveSettings}
            disabled={saving}
            style={{
              background: 'var(--accent)', border: 'none', borderRadius: '8px', color: '#fff',
              padding: '10px 20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              opacity: saving ? 0.6 : 1, alignSelf: 'flex-start',
            }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}

      {tab === 'config' && (
        <div className="page-content" style={{ maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ margin: '0', fontSize: '13px', color: '#64748b' }}>Transcription model and player configuration for this campaign</p>
            </div>
            <button
              onClick={saveConfig}
              disabled={configSaving || !config}
              style={{
                background: 'var(--accent)', border: 'none', borderRadius: '8px', color: '#fff',
                padding: '9px 20px', fontSize: '13px', fontWeight: 700,
                cursor: (configSaving || !config) ? 'wait' : 'pointer',
              }}
            >
              {configSaving ? 'Saving...' : configSaved ? '✓ Saved' : 'Save'}
            </button>
          </div>

          {configLoading ? (
            <div style={{ color: '#64748b' }}>Loading...</div>
          ) : !config ? (
            <div style={{ color: '#64748b' }}>No config found.</div>
          ) : (
            <>
              {/* Whisper / transcription */}
              <ConfigSection title="Transcription">
                <ConfigField label="Whisper Model">
                  <select
                    value={config.whisper_model || 'turbo'}
                    onChange={e => updateConfigField('whisper_model', e.target.value)}
                    style={configSelectStyle}
                  >
                    {['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3', 'turbo', 'distil-large-v3'].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </ConfigField>
                <ConfigField label="Voice Activity Detection (VAD)">
                  <ConfigToggle
                    value={config.vad ?? true}
                    onChange={v => updateConfigField('vad', v)}
                    description="Zeros out silence before Whisper — reduces hallucinations"
                  />
                </ConfigField>
                <ConfigField label="Vocabulary Prompt">
                  <textarea
                    value={config.vocab_prompt || ''}
                    onChange={e => updateConfigField('vocab_prompt', e.target.value)}
                    placeholder="Character names, spell names, locations, proper nouns… (improves transcription accuracy)"
                    rows={4}
                    style={{ ...configInputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                  />
                </ConfigField>
              </ConfigSection>

              {/* Players */}
              <ConfigSection title="Players">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 80px 32px', gap: '8px', padding: '0 4px', fontSize: '11px', fontWeight: 600, color: '#64748b', letterSpacing: '0.04em' }}>
                    <span>Discord Username</span>
                    <span>Display Name</span>
                    <span>Character</span>
                    <span>Role</span>
                    <span />
                  </div>
                  {Object.entries(config.players || {}).map(([username, info]: [string, any]) => (
                    <div key={username} style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 80px 32px',
                      gap: '8px', padding: '8px', background: 'var(--bg-surface)',
                      border: '1px solid var(--border-default)', borderRadius: '8px', alignItems: 'center',
                    }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{username}</span>
                      <input
                        value={info.name || ''}
                        onChange={e => updateConfigPlayer(username, 'name', e.target.value)}
                        style={{ ...configInputStyle, fontSize: '12px', padding: '5px 8px' }}
                      />
                      <input
                        value={info.character || ''}
                        onChange={e => updateConfigPlayer(username, 'character', e.target.value || null)}
                        placeholder="(none)"
                        style={{ ...configInputStyle, fontSize: '12px', padding: '5px 8px' }}
                      />
                      <select
                        value={info.role || 'player'}
                        onChange={e => updateConfigPlayer(username, 'role', e.target.value)}
                        style={{ ...configSelectStyle, fontSize: '12px', padding: '5px 8px' }}
                      >
                        <option value="player">Player</option>
                        <option value="dm">DM</option>
                      </select>
                      <button
                        onClick={() => removeConfigPlayer(username)}
                        title="Remove player"
                        style={{ background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={addConfigPlayer}
                    style={{
                      background: 'transparent', border: '1px dashed var(--border-default)', borderRadius: '8px',
                      color: '#475569', padding: '8px', fontSize: '12px', cursor: 'pointer', textAlign: 'center',
                    }}
                  >
                    + Add player
                  </button>
                </div>
              </ConfigSection>
            </>
          )}
        </div>
      )}

      {tab === 'members' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {members.map(m => (
            <div key={m.id} style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '10px',
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
                disabled={m.user_id === user?.id || myRole !== 'dm'}
                style={{
                  background: 'var(--bg-base)', border: '1px solid var(--border-default)', borderRadius: '6px',
                  color: '#94a3b8', padding: '4px 8px', fontSize: '12px',
                  opacity: myRole !== 'dm' ? 0.5 : 1,
                }}
              >
                <option value="spectator">Spectator</option>
                <option value="player">Player</option>
                <option value="dm">DM</option>
              </select>
              {m.user_id !== user?.id && myRole === 'dm' && (
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
            Install the worker package on the transcription machine, then paste this key into <code style={{ background: 'var(--bg-elevated)', padding: '1px 5px', borderRadius: '4px' }}>worker.yaml</code>.
          </div>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>Worker API Key</div>
            {workerKey ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <code style={{
                  flex: 1, background: 'var(--bg-base)', border: '1px solid var(--border-default)', borderRadius: '6px',
                  padding: '8px 12px', fontSize: '12px', color: 'var(--accent-text)', fontFamily: 'monospace',
                  overflowX: 'auto', whiteSpace: 'nowrap',
                }}>
                  {workerKeyVisible ? workerKey : '•'.repeat(32)}
                </code>
                <button
                  onClick={() => setWorkerKeyVisible(v => !v)}
                  style={{ background: 'transparent', border: '1px solid var(--border-default)', borderRadius: '6px', color: '#64748b', padding: '6px 10px', fontSize: '12px', cursor: 'pointer' }}
                >
                  {workerKeyVisible ? 'Hide' : 'Show'}
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(workerKey).then(() => toast('Key copied!', 'success'))}
                  style={{ background: 'rgba(124,108,252,0.1)', border: '1px solid rgba(124,108,252,0.3)', borderRadius: '6px', color: 'var(--accent-text)', padding: '6px 10px', fontSize: '12px', cursor: 'pointer' }}
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
                background: 'var(--accent)', border: 'none', borderRadius: '8px', color: '#fff',
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
            background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '12px',
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
                background: 'var(--accent)', border: 'none', borderRadius: '8px', color: '#fff',
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
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '10px',
                  padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--accent-text)' }}>{i.token}</div>
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
                      borderRadius: '6px', color: 'var(--accent-text)', padding: '4px 12px', fontSize: '12px', cursor: 'pointer',
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
  background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px',
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

// ── Config tab helpers ────────────────────────────────────────────────────────

function ConfigSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
        {title}
      </div>
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '10px', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function ConfigField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
      <label style={{ fontSize: '13px', color: '#94a3b8', width: '200px', flexShrink: 0 }}>{label}</label>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function ConfigToggle({ value, onChange, description }: { value: boolean; onChange: (v: boolean) => void; description?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: '40px', height: '22px', borderRadius: '11px',
          background: value ? 'var(--accent)' : 'var(--border-default)',
          border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s',
        }}
      >
        <span style={{
          position: 'absolute', top: '3px', left: value ? '21px' : '3px',
          width: '16px', height: '16px', borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
        }} />
      </button>
      {description && <span style={{ fontSize: '12px', color: '#64748b' }}>{description}</span>}
    </div>
  )
}

const configInputStyle: React.CSSProperties = {
  background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '7px',
  color: '#e2e8f0', padding: '7px 10px', fontSize: '13px', outline: 'none', width: '100%',
}

const configSelectStyle: React.CSSProperties = {
  background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '7px',
  color: '#e2e8f0', padding: '7px 10px', fontSize: '13px', outline: 'none', width: '100%',
}
