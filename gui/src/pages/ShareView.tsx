import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'

interface ShareData {
  session_name: string
  campaign_name: string
  show_transcript: boolean
  show_summary: boolean
  show_wiki: boolean
  transcript: string | null
  summary: string | null
  wiki: string | null
  created_at: string
  expires_at: string | null
}

type Tab = 'transcript' | 'summary' | 'wiki'

export default function ShareView() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ShareData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('transcript')

  useEffect(() => {
    fetch(`/share/${token}`)
      .then(r => {
        if (r.status === 404) throw new Error('This share link does not exist.')
        if (r.status === 410) throw new Error('This share link has expired.')
        if (!r.ok) throw new Error('Failed to load shared session.')
        return r.json()
      })
      .then((d: ShareData) => {
        setData(d)
        // Pick the first available tab
        if (d.show_transcript && d.transcript) setTab('transcript')
        else if (d.show_summary && d.summary) setTab('summary')
        else if (d.show_wiki && d.wiki) setTab('wiki')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={{ color: '#64748b', textAlign: 'center', marginTop: 80 }}>Loading…</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center', marginTop: 80 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
          <div style={{ color: '#f87171', fontSize: 16, marginBottom: 8 }}>{error ?? 'Not found'}</div>
          <div style={{ color: '#475569', fontSize: 13 }}>This link may have been removed or expired.</div>
        </div>
      </div>
    )
  }

  const tabs: { id: Tab; label: string; available: boolean }[] = (
    [
      { id: 'transcript' as Tab, label: 'Transcript', available: !!(data.show_transcript && data.transcript) },
      { id: 'summary' as Tab, label: 'Summary', available: !!(data.show_summary && data.summary) },
      { id: 'wiki' as Tab, label: 'Wiki', available: !!(data.show_wiki && data.wiki) },
    ] satisfies { id: Tab; label: string; available: boolean }[]
  ).filter(t => t.available)

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 16px' }}>
        {/* Header */}
        <div style={{ padding: '32px 0 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: 0 }}>
          <div style={{ color: '#475569', fontSize: 13, marginBottom: 6 }}>
            ⚔️ {data.campaign_name}
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#e2e8f0' }}>
            📜 {data.session_name}
          </h1>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: '#334155', background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '3px 8px', border: '1px solid rgba(255,255,255,0.06)' }}>
              Read-only shared view
            </span>
            {data.expires_at && (
              <span style={{ fontSize: 11, color: '#64748b' }}>
                Expires {new Date(data.expires_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        {tabs.length > 1 && (
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 0 }}>
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                  color: tab === t.id ? 'var(--accent-text)' : '#64748b',
                  padding: '12px 20px',
                  fontSize: 14,
                  fontWeight: tab === t.id ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'color 0.15s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div style={{ padding: '24px 0 64px' }}>
          {tab === 'transcript' && data.transcript && (
            <pre style={{
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: 13,
              lineHeight: 1.7,
              color: '#cbd5e1',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
            }}>
              {data.transcript}
            </pre>
          )}
          {tab === 'summary' && data.summary && (
            <div style={{ color: '#cbd5e1', lineHeight: 1.8 }} className="markdown-body">
              <ReactMarkdown>{data.summary}</ReactMarkdown>
            </div>
          )}
          {tab === 'wiki' && data.wiki && (
            <div style={{ color: '#cbd5e1', lineHeight: 1.8 }} className="markdown-body">
              <ReactMarkdown>{data.wiki}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg-base)',
  color: '#e2e8f0',
  fontFamily: 'Inter, system-ui, sans-serif',
}
