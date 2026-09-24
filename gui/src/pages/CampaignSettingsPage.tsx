import { useToast } from '../Toast'
import CampaignStats from './CampaignStats'
import { CloseIcon } from '../Icons'
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'settings' | 'config' | 'people' | 'stats' | 'worker'>('settings')

  // Config tab state (mirrors SettingsPage)
  const [config, setConfig] = useState<Record<string, any> | null>(null)
  const [configLoading, setConfigLoading] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [configSaved, setConfigSaved] = useState(false)
  const [vocabScraping, setVocabScraping] = useState(false)
  const [vocabScrapeError, setVocabScrapeError] = useState<string | null>(null)

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
      const r = await fetch(`/campaigns/${slug}/config`)
      if (r.ok) setConfig(await r.json())
    } finally {
      setConfigLoading(false)
    }
  }

  const saveConfig = async () => {
    if (!config) return
    setConfigSaving(true)
    try {
      const r = await fetch(`/campaigns/${slug}/config`, {
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
  // `config` (which includes `players`) was never reset or re-fetched on a
  // slug change — this effect's dependency array was [tab] only, and its
  // `!config` guard (meant to avoid a redundant re-fetch on unrelated
  // re-renders) meant that once loaded for one campaign, switching to a
  // DIFFERENT campaign and opening its Config tab kept showing the first
  // campaign's stale config (players included) instead of fetching fresh —
  // a real bug, not just a missing-players-on-a-new-campaign issue: it
  // could just as easily show and let you edit/save someone else's
  // corrections/vocab onto the wrong campaign. Clearing `config` on slug
  // change AND fetching on slug change (not just tab change) fixes both
  // the stale-display and the accidental-cross-campaign-save cases.
  useEffect(() => { setConfig(null); setConfigSaved(false) }, [slug])
  useEffect(() => { if (tab === 'config') loadConfig() }, [tab, slug])

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

  const exportCampaignData = () => {
    // Plain navigation rather than fetch+blob: the export endpoint returns
    // a real file download (Content-Disposition: attachment), and the
    // browser/WebView2 handles that natively — no need to juggle blobs.
    setExporting(true)
    window.location.href = `/campaigns/${slug}/export`
    setTimeout(() => setExporting(false), 3000)
  }

  const deleteCampaign = async () => {
    if (!campaign || deleteConfirmText !== campaign.slug) return
    setDeleting(true)
    try {
      const r = await fetch(`/campaigns/${slug}`, { method: 'DELETE' })
      if (r.ok) {
        toast(`"${campaign.name}" deleted.`, 'success')
        navigate('/campaigns')
      } else {
        toast('Failed to delete campaign', 'error')
        setDeleting(false)
      }
    } catch {
      toast('Failed to delete campaign', 'error')
      setDeleting(false)
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

  if (loading) return <div style={{ padding: '32px', color: 'var(--ink-faint)' }}>Loading...</div>
  if (!campaign) return <div style={{ padding: '32px', color: 'var(--rubric)' }}>Campaign not found.</div>

  return (
    <div className="page-content" style={{ padding: '32px', maxWidth: '860px' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: '34px', fontWeight: 500, color: 'var(--ink)' }}>
        {campaign.name}
      </h1>
      <div style={{ fontSize: '15px', color: 'var(--ink-faint)', marginBottom: '24px' }}>/{campaign.slug}</div>

      {/* Tabs */}
      <div role="tablist" style={{ display: 'flex', gap: '28px', marginBottom: '28px', borderBottom: '1px solid var(--rule)' }}>
        {(['settings', 'config', 'people', 'stats', ...(myRole === 'dm' ? ['worker'] : [])] as ('settings' | 'config' | 'people' | 'stats' | 'worker')[]).map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="sc"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 0', fontSize: '19px', fontWeight: tab === t ? 600 : 500,
              color: tab === t ? 'var(--rubric)' : 'var(--ink-faint)',
              boxShadow: tab === t ? 'inset 0 -2px 0 var(--rubric)' : 'none',
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
                  background: 'color-mix(in srgb, var(--gilt) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--gilt) 25%, transparent)',
                  borderRadius: 3, color: 'var(--gilt-ink)', padding: '4px 12px', fontSize: 15,
                  fontWeight: 600, cursor: 'pointer', opacity: (vaultTesting || !vaultRepoUrl.trim()) ? 0.5 : 1,
                }}
              >
                {vaultTesting ? 'Testing…' : 'Test Connection'}
              </button>
              {vaultTestResult && (
                <span style={{ fontSize: 15, color: vaultTestResult.ok ? 'var(--moss)' : 'var(--rubric)' }}>
                  {vaultTestResult.message}
                </span>
              )}
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink-faint)', marginTop: 4 }}>
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
            <div style={{ fontSize: 14, color: 'var(--ink-faint)', marginTop: 4 }}>
              Personal access token with repo write access. Stored per-campaign — each user can provide their own.
            </div>
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '16px', color: 'var(--ink-soft)' }}>
            <input type="checkbox" checked={requireApproval} onChange={e => setRequireApproval(e.target.checked)} />
            Require edit approval for transcript changes
          </label>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="btn-primary"
            style={{ alignSelf: 'flex-start' }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>

          {myRole === 'dm' && (
            <div style={{
              marginTop: '20px', padding: '20px', border: '1px solid var(--accent3)',
              borderRadius: '3px', background: 'var(--bg-elevated)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
            }}>
              <div>
                <div style={{ fontSize: '16px', color: 'var(--ink)' }}>Download all session data</div>
                <div style={{ fontSize: '14px', color: 'var(--ink-faint)' }}>
                  Every session's transcript and merged audio, zipped — a manual backup, anytime.
                </div>
              </div>
              <button
                onClick={exportCampaignData}
                disabled={exporting}
                style={{
                  background: 'color-mix(in srgb, var(--gilt) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--gilt) 25%, transparent)',
                  borderRadius: 3, color: 'var(--gilt-ink)', padding: '6px 14px', fontSize: 15,
                  fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                  opacity: exporting ? 0.6 : 1,
                }}
              >
                {exporting ? 'Preparing…' : 'Download All Data'}
              </button>
            </div>
          )}

          {myRole === 'dm' && (
            <div style={{
              marginTop: '4px', padding: '20px', border: '1px solid color-mix(in srgb, var(--rubric) 30%, transparent)',
              borderRadius: '3px', background: 'color-mix(in srgb, var(--rubric) 5%, transparent)',
              display: 'flex', flexDirection: 'column', gap: '14px',
            }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--rubric)' }}>Danger Zone</div>

              {!showDeleteConfirm ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <div style={{ fontSize: '16px', color: 'var(--ink)' }}>Delete this campaign</div>
                    <div style={{ fontSize: '14px', color: 'var(--ink-faint)' }}>
                      Permanently removes all sessions, transcripts, audio, members, and invites. Cannot be undone —
                      consider downloading a backup above first.
                    </div>
                  </div>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    style={{
                      background: 'color-mix(in srgb, var(--rubric) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--rubric) 30%, transparent)',
                      borderRadius: 3, color: 'var(--rubric)', padding: '6px 14px', fontSize: 15,
                      fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    Delete Campaign
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '15px', color: 'var(--rubric)' }}>
                    This cannot be undone. Type <strong>{campaign?.slug}</strong> to confirm.
                  </div>
                  <input
                    value={deleteConfirmText}
                    onChange={e => setDeleteConfirmText(e.target.value)}
                    placeholder={campaign?.slug}
                    style={{ ...inputStyle, maxWidth: '280px' }}
                    autoComplete="off"
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={deleteCampaign}
                      disabled={deleting || deleteConfirmText !== campaign?.slug}
                      style={{
                        background: 'var(--rubric)', border: 'none', borderRadius: 3, color: 'var(--on-rubric)',
                        padding: '6px 14px', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                        opacity: (deleting || deleteConfirmText !== campaign?.slug) ? 0.5 : 1,
                      }}
                    >
                      {deleting ? 'Deleting…' : 'Permanently Delete'}
                    </button>
                    <button
                      onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText('') }}
                      style={{
                        background: 'transparent', border: '1px solid var(--accent3)', borderRadius: 3,
                        color: 'var(--ink-soft)', padding: '6px 14px', fontSize: 15, cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'config' && (
        <div className="page-content" style={{ maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ margin: '0', fontSize: '16px', color: 'var(--ink-faint)' }}>Transcription model and player configuration for this campaign</p>
            </div>
            <button
              onClick={saveConfig}
              disabled={configSaving || !config}
              className="btn-primary"
            >
              {configSaving ? 'Saving...' : configSaved ? 'Saved' : 'Save'}
            </button>
          </div>

          {configLoading ? (
            <div style={{ color: 'var(--ink-faint)' }}>Loading...</div>
          ) : !config ? (
            <div style={{ color: 'var(--ink-faint)' }}>No config found.</div>
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
                    {['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3', 'turbo', 'distil-large-v3', 'canary-1b-flash', 'canary-1b'].map(m => {
                      const labels: Record<string, string> = {
                        'canary-1b-flash': 'canary-1b-flash (NVIDIA)',
                        'canary-1b': 'canary-1b, standard (NVIDIA)',
                      };
                      return <option key={m} value={m}>{labels[m] || m}</option>;
                    })}
                  </select>
                </ConfigField>
                <ConfigField label="Voice Activity Detection (VAD)">
                  <ConfigToggle
                    value={config.vad ?? true}
                    onChange={v => updateConfigField('vad', v)}
                    description="Zeros out silence before Whisper — reduces hallucinations"
                  />
                </ConfigField>
                <ConfigField label="Use Hotwords">
                  <ConfigToggle
                    value={config.use_hotwords ?? false}
                    onChange={v => updateConfigField('use_hotwords', v)}
                    description="Bias via faster-whisper's hotwords param instead of initial_prompt — beat initial_prompt on proper-noun accuracy in head-to-head testing"
                  />
                </ConfigField>
                <ConfigField label="Vocabulary Prompt">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <textarea
                      value={config.vocab_prompt || ''}
                      onChange={e => updateConfigField('vocab_prompt', e.target.value)}
                      placeholder="Character names, spell names, locations, proper nouns… (improves transcription accuracy)"
                      rows={4}
                      style={{ ...configInputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={async () => {
                          setVocabScraping(true)
                          setVocabScrapeError(null)
                          try {
                            const r = await fetch(`/campaigns/${slug}/config/vocab`)
                            const data = await r.json()
                            if (data.error) {
                              setVocabScrapeError(data.error)
                            } else {
                              updateConfigField('vocab_prompt', data.vocab || '')
                            }
                          } catch {
                            setVocabScrapeError('Request failed')
                          } finally {
                            setVocabScraping(false)
                          }
                        }}
                        disabled={vocabScraping}
                        style={{
                          background: 'color-mix(in srgb, var(--gilt) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--gilt) 25%, transparent)',
                          borderRadius: 3, color: 'var(--gilt-ink)', padding: '4px 12px', fontSize: 15,
                          fontWeight: 600, cursor: 'pointer', opacity: vocabScraping ? 0.5 : 1,
                        }}
                      >
                        {vocabScraping ? 'Scraping…' : 'Scrape Vault for Proper Nouns'}
                      </button>
                      {vocabScrapeError && (
                        <span style={{ fontSize: 15, color: 'var(--rubric)' }}>{vocabScrapeError}</span>
                      )}
                    </div>
                    <span style={{ fontSize: 14, color: 'var(--ink-faint)' }}>
                      Pulls the vault's Index.md wikilinks into this field, overwriting whatever's here. Review before saving.
                    </span>
                  </div>
                </ConfigField>
              </ConfigSection>

              {/* Players */}
              <ConfigSection title="Players">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 80px 32px', gap: '8px', padding: '0 4px', fontSize: '14px', fontWeight: 600, color: 'var(--ink-faint)', letterSpacing: '0.04em' }}>
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
                      border: '1px solid var(--accent3)', borderRadius: '3px', alignItems: 'center',
                    }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '15px', color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{username}</span>
                      <input
                        value={info.name || ''}
                        onChange={e => updateConfigPlayer(username, 'name', e.target.value)}
                        style={{ ...configInputStyle, fontSize: '15px', padding: '5px 8px' }}
                      />
                      <input
                        value={info.character || ''}
                        onChange={e => updateConfigPlayer(username, 'character', e.target.value || null)}
                        placeholder="(none)"
                        style={{ ...configInputStyle, fontSize: '15px', padding: '5px 8px' }}
                      />
                      <select
                        value={info.role || 'player'}
                        onChange={e => updateConfigPlayer(username, 'role', e.target.value)}
                        style={{ ...configSelectStyle, fontSize: '15px', padding: '5px 8px' }}
                      >
                        <option value="player">Player</option>
                        <option value="dm">DM</option>
                      </select>
                      <button
                        onClick={() => removeConfigPlayer(username)}
                        title="Remove player"
                        style={{ background: 'transparent', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={addConfigPlayer}
                    style={{
                      background: 'transparent', border: '1px dashed var(--accent3)', borderRadius: '3px',
                      color: 'var(--ink-faint)', padding: '8px', fontSize: '15px', cursor: 'pointer', textAlign: 'center',
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

      {tab === 'stats' && slug && <CampaignStats slug={slug} />}

      {tab === 'people' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Members */}
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-muted)', fontVariant: 'small-caps', letterSpacing: '0.05em', marginBottom: '12px' }}>
              Members
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {members.map(m => (
                <div key={m.id} style={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--accent3)', borderRadius: '3px',
                  padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px',
                }}>
                  {m.avatar && (
                    <img
                      src={`https://cdn.discordapp.com/avatars/${m.discord_id}/${m.avatar}.png?size=32`}
                      style={{ width: 32, height: 32, borderRadius: '50%' }}
                      alt=""
                    />
                  )}
                  <div style={{ flex: 1, fontSize: '17px', color: 'var(--text-primary)', fontWeight: 500 }}>
                    {m.username}
                  </div>
                  <select
                    value={m.role}
                    onChange={e => changeRole(m.user_id, e.target.value)}
                    disabled={m.user_id === user?.id || myRole !== 'dm'}
                    style={{
                      background: 'var(--bg-base)', border: '1px solid var(--accent3)', borderRadius: '3px',
                      color: 'var(--text-secondary)', padding: '4px 8px', fontSize: '15px',
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
                      className="btn-danger"
                      style={{ padding: '4px 10px', fontSize: '15px', borderRadius: '3px' }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Invites */}
          {myRole === 'dm' && (
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-muted)', fontVariant: 'small-caps', letterSpacing: '0.05em', marginBottom: '12px' }}>
                Invite Links
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Create invite form */}
                <div style={{
                  background: 'var(--bg-surface)', border: '1px solid var(--accent3)', borderRadius: '3px',
                  padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px',
                }}>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>Create Invite Link</div>
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
                    className="btn-primary"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    Generate Link
                  </button>
                </div>

                {/* Invite list */}
                {invites.length === 0 ? (
                  <div style={{ fontSize: '16px', color: 'var(--text-muted)' }}>No invite links yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {invites.map(i => (
                      <div key={i.id} style={{
                        background: 'var(--bg-elevated)', border: '1px solid var(--accent3)', borderRadius: '3px',
                        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px',
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '15px', fontFamily: 'monospace', color: 'var(--accent-text)' }}>{i.token}</div>
                          <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            Role: <strong style={{ color: 'var(--text-secondary)' }}>{i.role}</strong>
                            {', '}used {i.use_count}{i.max_uses ? `/${i.max_uses}` : ''}
                            {i.expires_at && `, expires ${new Date(i.expires_at).toLocaleDateString()}`}
                          </div>
                        </div>
                        <button
                          onClick={() => copyInviteLink(i.token)}
                          className="btn-secondary"
                          style={{ padding: '4px 12px', fontSize: '15px', borderRadius: '3px' }}
                        >
                          Copy Link
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'worker' && myRole === 'dm' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '540px' }}>
          <div style={{ fontSize: '16px', color: 'var(--ink-soft)', lineHeight: '1.5' }}>
            Install the worker package on the transcription machine, then paste this key into <code style={{ background: 'var(--bg-elevated)', padding: '1px 5px', borderRadius: '4px' }}>worker.yaml</code>.
          </div>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent3)', borderRadius: '3px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ink)' }}>Worker API Key</div>
            {workerKey ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <code style={{
                  flex: 1, background: 'var(--bg-base)', border: '1px solid var(--accent3)', borderRadius: '3px',
                  padding: '8px 12px', fontSize: '15px', color: 'var(--accent-text)', fontFamily: 'monospace',
                  overflowX: 'auto', whiteSpace: 'nowrap',
                }}>
                  {workerKeyVisible ? workerKey : '•'.repeat(32)}
                </code>
                <button
                  onClick={() => setWorkerKeyVisible(v => !v)}
                  className="btn-ghost"
                  style={{ padding: '6px 10px', fontSize: '15px', borderRadius: '3px' }}
                >
                  {workerKeyVisible ? 'Hide' : 'Show'}
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(workerKey).then(() => toast('Key copied!', 'success'))}
                  className="btn-secondary"
                  style={{ padding: '6px 10px', fontSize: '15px', borderRadius: '3px' }}
                >
                  Copy
                </button>
              </div>
            ) : (
              <div style={{ fontSize: '16px', color: 'var(--ink-faint)' }}>No key generated yet.</div>
            )}
            <button
              onClick={generateWorkerKey}
              disabled={generatingKey}
              className="btn-primary"
              style={{ alignSelf: 'flex-start' }}
            >
              {generatingKey ? 'Generating...' : workerKey ? 'Rotate Key' : 'Generate Key'}
            </button>
          </div>
          <div style={{ fontSize: '15px', color: 'var(--ink-faint)' }}>
            Last worker heartbeat: {workerLastSeen ? (() => {
              const ms = Date.now() - new Date(workerLastSeen).getTime()
              const mins = Math.floor(ms / 60000)
              return mins < 1 ? 'just now' : `${mins} minute${mins === 1 ? '' : 's'} ago`
            })() : 'Never'}
          </div>
        </div>
      )}

    </div>
  )
}

// A written line, like the rest of the journal's inputs.
const inputStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', borderBottom: '1px solid var(--rule-strong)', borderRadius: 0,
  color: 'var(--ink)', padding: '6px 2px', fontSize: '18px', outline: 'none', width: '100%',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '16px', color: 'var(--ink-soft)' }}>{label}</label>
      {children}
    </div>
  )
}

// ── Config tab helpers ────────────────────────────────────────────────────────

function ConfigSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink-faint)', fontVariant: 'small-caps', letterSpacing: '0.05em', marginBottom: '12px' }}>
        {title}
      </div>
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent3)', borderRadius: '3px', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function ConfigField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 16px', borderBottom: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)' }}>
      <label style={{ fontSize: '16px', color: 'var(--ink-soft)', width: '200px', flexShrink: 0 }}>{label}</label>
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
          width: '40px', height: '22px', borderRadius: '3px',
          background: value ? 'var(--accent)' : 'var(--accent3)',
          border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s',
        }}
      >
        <span style={{
          position: 'absolute', top: '3px', left: value ? '21px' : '3px',
          width: '16px', height: '16px', borderRadius: '50%',
          background: 'var(--page-raised)', transition: 'left 0.2s',
        }} />
      </button>
      {description && <span style={{ fontSize: '15px', color: 'var(--ink-faint)' }}>{description}</span>}
    </div>
  )
}

const configInputStyle: React.CSSProperties = {
  background: 'var(--bg-surface)', border: '1px solid var(--accent3)', borderRadius: '3px',
  color: 'var(--ink)', padding: '7px 10px', fontSize: '16px', outline: 'none', width: '100%',
}

const configSelectStyle: React.CSSProperties = {
  background: 'var(--bg-surface)', border: '1px solid var(--accent3)', borderRadius: '3px',
  color: 'var(--ink)', padding: '7px 10px', fontSize: '16px', outline: 'none', width: '100%',
}
