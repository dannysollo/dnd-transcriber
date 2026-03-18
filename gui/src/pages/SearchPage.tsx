import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApiUrl, useCampaign } from '../CampaignContext'

interface SearchHit {
  source: 'transcript' | 'summary' | 'wiki'
  line_number: number
  line: string
  context: string[]
}

interface SessionResult {
  session: string
  hits: SearchHit[]
  hit_count: number
}

interface SearchResponse {
  query: string
  results: SessionResult[]
  total_sessions: number
}

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  transcript: { label: 'Transcript', color: '#a78bfa' },
  summary:    { label: 'Summary',    color: '#60a5fa' },
  wiki:       { label: 'Wiki',       color: '#4ade80' },
}

function highlightQuery(text: string, query: string) {
  if (!query) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'rgba(167,139,250,0.35)', color: '#e2e8f0', borderRadius: 2, padding: '0 2px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SessionResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastQuery, setLastQuery] = useState('')
  const apiUrl = useApiUrl()
  const { activeCampaign } = useCampaign()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(apiUrl(`/search?q=${encodeURIComponent(q.trim())}`))
      if (!res.ok) throw new Error(`Search failed: ${res.status}`)
      const data: SearchResponse = await res.json()
      setResults(data.results)
      setLastQuery(q.trim())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [apiUrl])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') doSearch(query)
  }

  if (!activeCampaign) {
    return (
      <div style={{ padding: 32, color: '#94a3b8' }}>
        Select a campaign to search.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 20, fontWeight: 600, color: '#e2e8f0' }}>
          🔍 Search Sessions
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search transcripts, summaries, wiki…"
            autoFocus
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.05)',
              color: '#e2e8f0',
              fontSize: 15,
              outline: 'none',
            }}
          />
          <button
            onClick={() => doSearch(query)}
            disabled={loading || query.trim().length < 2}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: loading ? 'rgba(124,108,252,0.3)' : '#7c6cfc',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '…' : 'Search'}
          </button>
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {error && (
          <div style={{ color: '#f87171', background: 'rgba(248,113,113,0.1)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
            {error}
          </div>
        )}

        {results === null && !loading && (
          <div style={{ color: '#475569', textAlign: 'center', marginTop: 48, fontSize: 15 }}>
            Type something and press Enter or click Search
          </div>
        )}

        {results !== null && results.length === 0 && (
          <div style={{ color: '#475569', textAlign: 'center', marginTop: 48, fontSize: 15 }}>
            No results for <strong style={{ color: '#94a3b8' }}>"{lastQuery}"</strong>
          </div>
        )}

        {results !== null && results.length > 0 && (
          <>
            <div style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
              {results.reduce((n, r) => n + r.hit_count, 0)} hit{results.reduce((n, r) => n + r.hit_count, 0) !== 1 ? 's' : ''} across {results.length} session{results.length !== 1 ? 's' : ''} for <strong style={{ color: '#94a3b8' }}>"{lastQuery}"</strong>
            </div>

            {results.map(sessionResult => (
              <div
                key={sessionResult.session}
                style={{
                  marginBottom: 20,
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 10,
                  overflow: 'hidden',
                  background: 'rgba(255,255,255,0.02)',
                }}
              >
                {/* Session header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: 'rgba(255,255,255,0.04)',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer',
                  }}
                  onClick={() => navigate(`/sessions/${sessionResult.session}`)}
                >
                  <span style={{ fontWeight: 600, color: '#c4b5fd', fontSize: 14 }}>
                    📜 {sessionResult.session}
                  </span>
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    {sessionResult.hit_count} hit{sessionResult.hit_count !== 1 ? 's' : ''} →
                  </span>
                </div>

                {/* Hits */}
                {sessionResult.hits.map((hit, i) => {
                  const src = SOURCE_LABELS[hit.source] ?? { label: hit.source, color: '#94a3b8' }
                  return (
                    <div
                      key={i}
                      style={{
                        padding: '10px 16px',
                        borderBottom: i < sessionResult.hits.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: src.color,
                          background: `${src.color}1a`,
                          borderRadius: 4,
                          padding: '2px 6px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}>
                          {src.label}
                        </span>
                        <span style={{ fontSize: 11, color: '#475569' }}>line {hit.line_number}</span>
                      </div>
                      <div style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}>
                        {hit.context.map((ctxLine, j) => {
                          const isMatch = ctxLine === hit.line
                          return (
                            <div
                              key={j}
                              style={{
                                color: isMatch ? '#e2e8f0' : '#475569',
                                background: isMatch ? 'rgba(124,108,252,0.08)' : 'transparent',
                                borderLeft: isMatch ? '2px solid #7c6cfc' : '2px solid transparent',
                                paddingLeft: 8,
                                borderRadius: 2,
                              }}
                            >
                              {isMatch ? highlightQuery(ctxLine, lastQuery) : ctxLine}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
