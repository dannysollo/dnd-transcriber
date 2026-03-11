import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface Session {
  name: string
  status: string
  has_transcript: boolean
  has_summary: boolean
  has_wiki: boolean
}

const statusColors: Record<string, { bg: string; text: string; label: string }> = {
  complete: { bg: 'rgba(34,197,94,0.15)', text: '#4ade80', label: 'Complete' },
  transcribed: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa', label: 'Transcribed' },
  raw: { bg: 'rgba(251,191,36,0.15)', text: '#fbbf24', label: 'Raw audio' },
  empty: { bg: 'rgba(100,116,139,0.15)', text: '#64748b', label: 'Empty' },
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/sessions')
      setSessions(await r.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const createSession = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const r = await fetch('/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (r.ok) {
        setNewName('')
        load()
      } else {
        const err = await r.json()
        alert(err.detail || 'Error creating session')
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={{ padding: '32px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#e2e8f0' }}>Sessions</h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            All recording sessions
          </p>
        </div>

        {/* Create session */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createSession()}
            placeholder="2026-03-15"
            style={{
              background: '#1a1d27',
              border: '1px solid #2a2d3a',
              borderRadius: '8px',
              color: '#e2e8f0',
              padding: '8px 12px',
              fontSize: '13px',
              width: '160px',
              outline: 'none',
            }}
          />
          <button
            onClick={createSession}
            disabled={creating || !newName.trim()}
            style={{
              background: '#7c6cfc',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              opacity: (creating || !newName.trim()) ? 0.5 : 1,
            }}
          >
            + New
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#64748b', fontSize: '14px' }}>Loading...</div>
      ) : sessions.length === 0 ? (
        <div style={{
          background: '#1a1d27',
          border: '1px solid #2a2d3a',
          borderRadius: '12px',
          padding: '48px',
          textAlign: 'center',
          color: '#64748b',
        }}>
          No sessions yet. Create one or drop audio files in the sessions/ directory.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {sessions.map(s => {
            const sc = statusColors[s.status] || statusColors.empty
            return (
              <div
                key={s.name}
                onClick={() => navigate(`/sessions/${s.name}`)}
                style={{
                  background: '#1a1d27',
                  border: '1px solid #2a2d3a',
                  borderRadius: '10px',
                  padding: '16px 20px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#7c6cfc')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2d3a')}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>{s.name}</div>
                </div>
                {/* File badges */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  {s.has_transcript && <Badge label="transcript" />}
                  {s.has_summary && <Badge label="summary" />}
                  {s.has_wiki && <Badge label="wiki" />}
                </div>
                {/* Status badge */}
                <div style={{
                  background: sc.bg,
                  color: sc.text,
                  borderRadius: '20px',
                  padding: '3px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>
                  {sc.label}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Badge({ label }: { label: string }) {
  return (
    <span style={{
      background: 'rgba(124,108,252,0.1)',
      color: '#7c6cfc',
      borderRadius: '4px',
      padding: '2px 7px',
      fontSize: '10px',
      fontWeight: 600,
    }}>
      {label}
    </span>
  )
}
