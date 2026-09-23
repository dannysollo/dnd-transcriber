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
  transcript: { label: 'Transcript', color: 'var(--accent)' },
  summary:    { label: 'Summary',    color: 'var(--accent2)' },
  wiki:       { label: 'Wiki',       color: 'var(--moss)' },
}

function highlightQuery(text: string, query: string) {
  if (!query) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'color-mix(in srgb, var(--accent) 30%, transparent)', color: 'var(--ink)', borderRadius: 2, padding: '0 2px' }}>
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
      <div style={{ padding: 32, color: 'var(--ink-soft)' }}>
        Select a campaign to search.
      </div>
    )
  }

  return (
    <div className="session-view-root" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '40px 56px 16px', borderBottom: '1px solid var(--rule)', flexShrink: 0 }}>
        <h1 style={{ margin: '0 0 16px', fontSize: 34, fontWeight: 500, color: 'var(--ink)' }}>
          Search every session
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="A name, a place, a line someone said…"
            autoFocus
            aria-label="Search every session"
            className="written-line"
            style={{ flex: 1, fontSize: 20 }}
          />
          <button
            onClick={() => doSearch(query)}
            disabled={loading || query.trim().length < 2}
            style={{
              padding: '10px 20px',
              borderRadius: 3,
              border: 'none',
              background: loading ? 'color-mix(in srgb, var(--rubric) 30%, transparent)' : 'var(--accent)',
              color: 'var(--on-rubric)',
              fontWeight: 600,
              fontSize: 17,
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
          <div style={{ color: 'var(--rubric)', background: 'color-mix(in srgb, var(--rubric) 10%, transparent)', borderRadius: 3, padding: '12px 16px', marginBottom: 16 }}>
            {error}
          </div>
        )}

        {results === null && !loading && (
          <div style={{ color: 'var(--ink-faint)', textAlign: 'center', marginTop: 48, fontSize: 18 }}>
            Type something and press Enter or click Search
          </div>
        )}

        {results !== null && results.length === 0 && (
          <div style={{ color: 'var(--ink-faint)', textAlign: 'center', marginTop: 48, fontSize: 18 }}>
            No results for <strong style={{ color: 'var(--ink-soft)' }}>"{lastQuery}"</strong>
          </div>
        )}

        {results !== null && results.length > 0 && (
          <>
            <div style={{ color: 'var(--ink-faint)', fontSize: 16, marginBottom: 16 }}>
              {results.reduce((n, r) => n + r.hit_count, 0)} hit{results.reduce((n, r) => n + r.hit_count, 0) !== 1 ? 's' : ''} across {results.length} session{results.length !== 1 ? 's' : ''} for <strong style={{ color: 'var(--ink-soft)' }}>"{lastQuery}"</strong>
            </div>

            {results.map(sessionResult => (
              <div
                key={sessionResult.session}
                style={{
                  marginBottom: 20,
                  border: '1px solid var(--accent3)',
                  borderRadius: 3,
                  overflow: 'hidden',
                  background: 'color-mix(in srgb, var(--ink) 2%, transparent)',
                }}
              >
                {/* Session header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: 'color-mix(in srgb, var(--ink) 4%, transparent)',
                    borderBottom: '1px solid color-mix(in srgb, var(--ink) 6%, transparent)',
                    cursor: 'pointer',
                  }}
                  onClick={() => navigate(`/sessions/${sessionResult.session}`)}
                >
                  <span style={{ fontWeight: 600, color: 'var(--accent-text)', fontSize: 17 }}>
                    {sessionResult.session}
                  </span>
                  <span style={{ fontSize: 15, color: 'var(--ink-faint)' }}>
                    {sessionResult.hit_count} hit{sessionResult.hit_count !== 1 ? 's' : ''} →
                  </span>
                </div>

                {/* Hits */}
                {sessionResult.hits.map((hit, i) => {
                  const src = SOURCE_LABELS[hit.source] ?? { label: hit.source, color: 'var(--ink-soft)' }
                  return (
                    <div
                      key={i}
                      style={{
                        padding: '10px 16px',
                        borderBottom: i < sessionResult.hits.length - 1 ? '1px solid color-mix(in srgb, var(--ink) 4%, transparent)' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: src.color,
                          background: `${src.color}1a`,
                          borderRadius: 4,
                          padding: '2px 6px',
                          fontVariant: 'small-caps',
                          letterSpacing: '0.05em',
                        }}>
                          {src.label}
                        </span>
                        <span style={{ fontSize: 14, color: 'var(--ink-faint)' }}>line {hit.line_number}</span>
                      </div>
                      <div style={{ fontFamily: 'monospace', fontSize: 16, lineHeight: 1.6 }}>
                        {hit.context.map((ctxLine, j) => {
                          const isMatch = ctxLine === hit.line
                          return (
                            <div
                              key={j}
                              style={{
                                color: isMatch ? 'var(--ink)' : 'var(--ink-faint)',
                                background: isMatch ? 'color-mix(in srgb, var(--rubric) 8%, transparent)' : 'transparent',
                                borderLeft: isMatch ? '2px solid var(--accent)' : '2px solid transparent',
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
