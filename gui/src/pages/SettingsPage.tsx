import { useEffect, useState } from 'react'
import { useApiUrl, useCampaign } from '../CampaignContext'
import { useAuth } from '../AuthContext'


export default function SettingsPage() {
  const apiUrl = useApiUrl()
  const { loading: campaignLoading, activeCampaign } = useCampaign()
  const { authEnabled, isLoggedIn } = useAuth()
  const [config, setConfig] = useState<Record<string, any> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [vocab, setVocab] = useState('')
  const [vocabError, setVocabError] = useState('')

  const load = async () => {
    setLoading(true)
    const r = await fetch(apiUrl('/config'))
    const data = await r.json()
    setConfig(data)
    setLoading(false)

    // Load vocab
    const vr = await fetch(apiUrl('/config/vocab'))
    const vdata = await vr.json()
    setVocab(vdata.vocab || '')
    setVocabError(vdata.error || '')
  }

  useEffect(() => {
    if (campaignLoading) return
    load()
  }, [apiUrl, campaignLoading])

  const save = async () => {
    if (!config) return
    setSaving(true)
    await fetch(apiUrl('/config'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const updateField = (key: string, value: any) => {
    setConfig(prev => prev ? { ...prev, [key]: value } : prev)
  }

  const updatePlayer = (username: string, field: string, value: any) => {
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

  const addPlayer = () => {
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

  const removePlayer = (username: string) => {
    setConfig(prev => {
      if (!prev) return prev
      const players = { ...prev.players }
      delete players[username]
      return { ...prev, players }
    })
  }

  if (campaignLoading) return <div style={{ padding: '32px', color: '#64748b' }}>Loading...</div>
  if (authEnabled && (!isLoggedIn || !activeCampaign)) {
    return (
      <div style={{ padding: '32px', color: '#64748b', fontSize: '14px' }}>
        Select a campaign to view settings.
      </div>
    )
  }
  if (loading) return <div style={{ padding: '32px', color: '#64748b' }}>Loading...</div>
  if (!config) return null

  const players = config.players || {}

  return (
    <div style={{ padding: '32px', maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#e2e8f0' }}>Settings</h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>Pipeline and player configuration</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          style={{
            background: '#7c6cfc',
            border: 'none',
            borderRadius: '8px',
            color: '#fff',
            padding: '9px 20px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>

      {/* Whisper model */}
      <Section title="Transcription">
        <Field label="Whisper Model">
          <select
            value={config.whisper_model || 'turbo'}
            onChange={e => updateField('whisper_model', e.target.value)}
            style={selectStyle}
          >
            {['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3', 'turbo'].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Voice Activity Detection (VAD)">
          <Toggle
            value={config.vad ?? true}
            onChange={v => updateField('vad', v)}
            description="Zeros out silence before Whisper — prevents hallucinations"
          />
        </Field>
        <Field label="Sessions Directory">
          <input
            value={config.sessions_dir || 'sessions'}
            onChange={e => updateField('sessions_dir', e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Vault Path">
          <input
            value={config.vault_path || ''}
            onChange={e => updateField('vault_path', e.target.value)}
            style={inputStyle}
          />
        </Field>
      </Section>

      {/* OpenClaw / Notify */}
      <Section title="Claude / Notify">
        <Field label="Notify Claude via OpenClaw">
          <Toggle
            value={config.notify_claude ?? true}
            onChange={v => updateField('notify_claude', v)}
            description="Auto-pings Claude after transcription"
          />
        </Field>
        <Field label="OpenClaw Session ID">
          <input
            value={config.openclaw_session_id || ''}
            onChange={e => updateField('openclaw_session_id', e.target.value)}
            style={inputStyle}
          />
        </Field>
      </Section>

      {/* Players */}
      <Section title="Players">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 80px 32px', gap: '8px', padding: '0 8px', fontSize: '11px', fontWeight: 600, color: '#64748b' }}>
            <span>Discord Username</span>
            <span>Display Name</span>
            <span>Character</span>
            <span>Role</span>
            <span />
          </div>
          {Object.entries(players).map(([username, info]: [string, any]) => (
            <div key={username} style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr 80px 32px',
              gap: '8px',
              padding: '8px',
              background: '#1a1d27',
              border: '1px solid #2a2d3a',
              borderRadius: '8px',
              alignItems: 'center',
            }}>
              <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#94a3b8' }}>{username}</span>
              <input
                value={info.name || ''}
                onChange={e => updatePlayer(username, 'name', e.target.value)}
                style={{ ...inputStyle, fontSize: '12px', padding: '5px 8px' }}
              />
              <input
                value={info.character || ''}
                onChange={e => updatePlayer(username, 'character', e.target.value || null)}
                placeholder="(none)"
                style={{ ...inputStyle, fontSize: '12px', padding: '5px 8px' }}
              />
              <select
                value={info.role || 'player'}
                onChange={e => updatePlayer(username, 'role', e.target.value)}
                style={{ ...selectStyle, fontSize: '12px', padding: '5px 8px' }}
              >
                <option value="player">Player</option>
                <option value="dm">DM</option>
              </select>
              <button
                onClick={() => removePlayer(username)}
                style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '14px' }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={addPlayer}
            style={{
              background: 'transparent',
              border: '1px dashed #2a2d3a',
              borderRadius: '8px',
              color: '#64748b',
              padding: '8px',
              fontSize: '12px',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            + Add player
          </button>
        </div>
      </Section>

      {/* Vocab preview */}
      <Section title="Vocabulary Prompt (from vault)">
        {vocabError ? (
          <div style={{ fontSize: '12px', color: '#f87171' }}>Error: {vocabError}</div>
        ) : (
          <pre style={{
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#94a3b8',
            background: '#1a1d27',
            border: '1px solid #2a2d3a',
            borderRadius: '8px',
            padding: '12px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
          }}>
            {vocab || '(empty — check vault_path in config)'}
          </pre>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
        {title}
      </div>
      <div style={{
        background: '#1a1d27',
        border: '1px solid #2a2d3a',
        borderRadius: '10px',
        overflow: 'hidden',
      }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      padding: '12px 16px',
      borderBottom: '1px solid #1e2130',
    }}>
      <label style={{ fontSize: '13px', color: '#94a3b8', width: '200px', flexShrink: 0 }}>{label}</label>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function Toggle({ value, onChange, description }: { value: boolean; onChange: (v: boolean) => void; description?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: '40px',
          height: '22px',
          borderRadius: '11px',
          background: value ? '#7c6cfc' : '#2a2d3a',
          border: 'none',
          cursor: 'pointer',
          position: 'relative',
          flexShrink: 0,
          transition: 'background 0.2s',
        }}
      >
        <span style={{
          position: 'absolute',
          top: '3px',
          left: value ? '21px' : '3px',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s',
        }} />
      </button>
      {description && <span style={{ fontSize: '12px', color: '#64748b' }}>{description}</span>}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#13151f',
  border: '1px solid #2a2d3a',
  borderRadius: '7px',
  color: '#e2e8f0',
  padding: '7px 10px',
  fontSize: '13px',
  outline: 'none',
  width: '100%',
}

const selectStyle: React.CSSProperties = {
  background: '#13151f',
  border: '1px solid #2a2d3a',
  borderRadius: '7px',
  color: '#e2e8f0',
  padding: '7px 10px',
  fontSize: '13px',
  outline: 'none',
  width: '100%',
}
