import { useEffect, useState } from 'react'
import { CloseIcon, PencilIcon, TrashIcon } from '../Icons'
import { useApiUrl, useCampaign } from '../CampaignContext'
import { useAuth } from '../AuthContext'

interface Pattern {
  match: string
  replace: string
}

export default function CorrectionsPage() {
  const apiUrl = useApiUrl()
  const { loading: campaignLoading, activeCampaign } = useCampaign()
  const { authEnabled, isLoggedIn } = useAuth()
  const [corrections, setCorrections] = useState<Record<string, string>>({})
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Test panel
  const [testText, setTestText] = useState('')
  const [testResult, setTestResult] = useState<{ changed: boolean; result: string; diffs: { line: number; before: string; after: string }[] } | null>(null)
  const [testing, setTesting] = useState(false)

  // New correction form
  const [newWrong, setNewWrong] = useState('')
  const [newRight, setNewRight] = useState('')

  // New pattern form
  const [newMatch, setNewMatch] = useState('')
  const [newReplace, setNewReplace] = useState('')

  // Edit mode
  const [editKey, setEditKey] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')

  const [activeTab, setActiveTab] = useState<'corrections' | 'patterns'>('corrections')

  // Apply corrections to every session, in place
  const [applyAllState, setApplyAllState] = useState<'idle' | 'confirm' | 'running'>('idle')
  const [applyAllResult, setApplyAllResult] = useState<{ total_changes: number; sessions_changed: number; sessions: { session: string; changes: number }[] } | null>(null)

  const load = async () => {
    setLoading(true)
    const [c, p] = await Promise.all([
      fetch(apiUrl('/config/corrections')).then(r => r.json()),
      fetch(apiUrl('/config/patterns')).then(r => r.json()),
    ])
    setCorrections(c.corrections || {})
    setPatterns(p.patterns || [])
    setLoading(false)
  }

  useEffect(() => {
    if (campaignLoading) return
    load()
  }, [apiUrl, campaignLoading])

  const applyToAll = async () => {
    setApplyAllState('running')
    setApplyAllResult(null)
    try {
      const r = await fetch(apiUrl('/corrections/apply-all'), { method: 'POST' })
      if (!r.ok) throw new Error()
      setApplyAllResult(await r.json())
    } catch {
      setApplyAllResult({ total_changes: -1, sessions_changed: 0, sessions: [] })
    } finally {
      setApplyAllState('idle')
    }
  }

  const saveCorrections = async (updated: Record<string, string>) => {
    setSaving(true)
    await fetch(apiUrl('/config/corrections'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corrections: updated }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const savePatterns = async (updated: Pattern[]) => {
    setSaving(true)
    await fetch(apiUrl('/config/patterns'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patterns: updated }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const addCorrection = () => {
    if (!newWrong.trim() || !newRight.trim()) return
    const updated = { ...corrections, [newWrong.trim()]: newRight.trim() }
    setCorrections(updated)
    setNewWrong('')
    setNewRight('')
    saveCorrections(updated)
  }

  const deleteCorrection = (key: string) => {
    const updated = { ...corrections }
    delete updated[key]
    setCorrections(updated)
    saveCorrections(updated)
  }

  const addPattern = () => {
    if (!newMatch.trim()) return
    const updated = [...patterns, { match: newMatch.trim(), replace: newReplace.trim() }]
    setPatterns(updated)
    setNewMatch('')
    setNewReplace('')
    savePatterns(updated)
  }

  const deletePattern = (idx: number) => {
    const updated = patterns.filter((_, i) => i !== idx)
    setPatterns(updated)
    savePatterns(updated)
  }

  const runTest = async () => {
    if (!testText.trim()) return
    setTesting(true)
    const r = await fetch(apiUrl('/config/test-correction'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: testText,
        corrections,
        patterns,
      }),
    })
    setTestResult(await r.json())
    setTesting(false)
  }

  const sortedCorrections = Object.entries(corrections).sort(([a], [b]) => a.localeCompare(b))

  if (campaignLoading) {
    return <div style={{ padding: '32px', color: 'var(--ink-faint)' }}>Loading...</div>
  }

  if (authEnabled && (!isLoggedIn || !activeCampaign)) {
    return (
      <div style={{ padding: '32px', color: 'var(--ink-faint)', fontSize: '17px' }}>
        Select a campaign to view corrections.
      </div>
    )
  }

  return (
    <div className="page-content" style={{ padding: '40px 56px', maxWidth: '1140px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '34px', fontWeight: 500, color: 'var(--ink)' }}>Corrections</h1>
        <p style={{ margin: '4px 0 0', fontSize: '17px', color: 'var(--ink-soft)' }}>
          Spellings the campaign always fixes after transcription: whole-word rules, plus regex patterns for trickier cases.
        </p>
      </div>

      <div className="corrections-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Left: editor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Tabs */}
          <div role="tablist" style={{ display: 'flex', gap: '28px', borderBottom: '1px solid var(--rule)' }}>
            {(['corrections', 'patterns'] as const).map(t => (
              <button
                key={t}
                role="tab"
                aria-selected={activeTab === t}
                onClick={() => setActiveTab(t)}
                className="sc"
                style={{
                  background: 'transparent',
                  border: 'none',
                  boxShadow: activeTab === t ? 'inset 0 -2px 0 var(--rubric)' : 'none',
                  color: activeTab === t ? 'var(--rubric)' : 'var(--ink-faint)',
                  padding: '10px 0',
                  fontSize: '19px',
                  fontWeight: activeTab === t ? 600 : 500,
                  cursor: 'pointer',
                }}
              >
                {t === 'corrections' ? 'Word rules' : 'Patterns'}
                <span style={{ marginLeft: 6, fontSize: '15px', fontVariant: 'normal', fontVariantNumeric: 'lining-nums', color: 'var(--ink-faint)' }}>
                  {t === 'corrections' ? sortedCorrections.length : patterns.length}
                </span>
              </button>
            ))}
            {saving && <span style={{ marginLeft: 'auto', fontSize: '15px', color: 'var(--ink-faint)', alignSelf: 'center' }}>Saving...</span>}
            {saved && <span style={{ marginLeft: 'auto', fontSize: '16px', color: 'var(--moss)', alignSelf: 'center' }}>Saved</span>}
          </div>

          {loading ? (
            <div style={{ color: 'var(--ink-faint)' }}>Loading...</div>
          ) : activeTab === 'corrections' ? (
            <>
              {/* Add form */}
              <div className="corrections-add-row" style={{ display: 'flex', gap: '8px' }}>
                <input
                  value={newWrong}
                  onChange={e => setNewWrong(e.target.value)}
                  placeholder="Wrong word"
                  onKeyDown={e => e.key === 'Enter' && addCorrection()}
                  style={inputStyle}
                />
                <span style={{ color: 'var(--ink-faint)', alignSelf: 'center', fontSize: '18px' }}>→</span>
                <input
                  value={newRight}
                  onChange={e => setNewRight(e.target.value)}
                  placeholder="Correct word"
                  onKeyDown={e => e.key === 'Enter' && addCorrection()}
                  style={inputStyle}
                />
                <button onClick={addCorrection} className="btn-primary" style={{ whiteSpace: 'nowrap' }}>Add rule</button>
              </div>

              {/* List */}
              <div style={{
                borderTop: '1px solid var(--rule)',
                overflow: 'auto',
                maxHeight: '520px',
              }}>
                {sortedCorrections.length === 0 ? (
                  <div style={{ padding: '24px', color: 'var(--ink-faint)', textAlign: 'center', fontSize: '16px' }}>
                    No corrections yet
                  </div>
                ) : sortedCorrections.map(([wrong, right]) => (
                  <div key={wrong} style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 2px',
                    borderBottom: '1px solid var(--rule)',
                    gap: '10px',
                  }}>
                    {editKey === wrong ? (
                      <>
                        <span style={{ fontSize: '18px', color: 'var(--ink-faint)', textDecoration: 'line-through', flex: 1 }}>{wrong}</span>
                        <span style={{ color: 'var(--ink-faint)' }}>→</span>
                        <input
                          value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const updated = { ...corrections, [wrong]: editVal }
                              setCorrections(updated)
                              saveCorrections(updated)
                              setEditKey(null)
                            } else if (e.key === 'Escape') setEditKey(null)
                          }}
                          autoFocus
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <button onClick={() => setEditKey(null)} style={cancelBtnStyle} aria-label="Cancel"><CloseIcon /></button>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: '18px', color: 'var(--ink-faint)', textDecoration: 'line-through', flex: 1 }}>{wrong}</span>
                        <span style={{ color: 'var(--ink-faint)', fontSize: '16px' }}>→</span>
                        <span style={{ fontSize: '18px', color: 'var(--ink)', flex: 1 }}>{right}</span>
                        <button onClick={() => { setEditKey(wrong); setEditVal(right) }} style={iconBtnStyle} aria-label="Edit"><PencilIcon /></button>
                        <button onClick={() => deleteCorrection(wrong)} style={iconBtnStyle} aria-label="Delete"><TrashIcon /></button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Add pattern form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    value={newMatch}
                    onChange={e => setNewMatch(e.target.value)}
                    placeholder="Regex pattern (e.g. (?i)\\bChamber Row\\b)"
                    style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: '14px' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    value={newReplace}
                    onChange={e => setNewReplace(e.target.value)}
                    placeholder="Replacement"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button onClick={addPattern} style={addBtnStyle}>Add</button>
                </div>
              </div>

              {/* Patterns list */}
              <div style={{
                borderTop: '1px solid var(--rule)',
                overflow: 'auto',
                maxHeight: '520px',
              }}>
                {patterns.length === 0 ? (
                  <div style={{ padding: '24px', color: 'var(--ink-faint)', textAlign: 'center', fontSize: '16px' }}>
                    No patterns yet
                  </div>
                ) : patterns.map((p, i) => (
                  <div key={i} style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)',
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'flex-start',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'monospace', fontSize: '14px', color: 'var(--accent-text)', wordBreak: 'break-all' }}>
                        {p.match}
                      </div>
                      <div style={{ fontSize: '15px', color: 'var(--moss)', marginTop: '2px' }}>
                        → {p.replace}
                      </div>
                    </div>
                    <button onClick={() => deletePattern(i)} style={iconBtnStyle} aria-label="Delete"><TrashIcon /></button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Apply corrections to every session */}
        <div style={{ marginTop: '8px', borderTop: '1px solid var(--rule)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {applyAllState === 'confirm' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '17px', color: 'var(--ink)' }}>Apply every rule to all sessions?</div>
              <div style={{ fontSize: '16px', color: 'var(--ink-soft)', maxWidth: '52ch' }}>
                Runs the current word rules and patterns over each session's transcript, summary and wiki
                suggestions, in place. Hand edits are kept; nothing is re-transcribed.
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn-primary" onClick={applyToAll}>Apply to all sessions</button>
                <button className="btn-ghost" onClick={() => setApplyAllState('idle')}>Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <button className="btn-ghost" onClick={() => setApplyAllState('confirm')} disabled={applyAllState === 'running'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                {applyAllState === 'running' ? 'Applying corrections…' : 'Apply corrections to all sessions'}
              </button>
              <div style={{ fontSize: '15px', color: 'var(--ink-faint)', marginTop: '6px' }}>
                New rules only fix future transcripts until you apply them here (or per session).
              </div>
            </div>
          )}
          {applyAllResult && (
            applyAllResult.total_changes < 0 ? (
              <div style={{ fontSize: '16px', color: 'var(--rubric)' }}>Couldn't apply the corrections. Try again.</div>
            ) : (
              <div style={{ fontSize: '16px', color: 'var(--ink)' }}>
                {applyAllResult.total_changes === 0
                  ? 'Everything already matches the rules. Nothing to change.'
                  : `Made ${applyAllResult.total_changes.toLocaleString()} fix${applyAllResult.total_changes !== 1 ? 'es' : ''} across ${applyAllResult.sessions_changed} session${applyAllResult.sessions_changed !== 1 ? 's' : ''}.`}
                {applyAllResult.sessions.filter(x => x.changes > 0).length > 0 && (
                  <ul style={{ margin: '6px 0 0', paddingLeft: '1.1em', color: 'var(--ink-soft)', fontSize: '15px' }}>
                    {applyAllResult.sessions.filter(x => x.changes > 0).map(x => (
                      <li key={x.session}>{x.session}: {x.changes}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          )}
        </div>

        {/* Right: test panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '17px', fontWeight: 600, color: 'var(--ink-soft)' }}>
              Live Preview
            </h3>
            <textarea
              value={testText}
              onChange={e => setTestText(e.target.value)}
              placeholder="Paste a few transcript lines to see what the rules would change…"
              style={{
                width: '100%',
                height: '160px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--accent3)',
                borderRadius: '3px',
                color: 'var(--ink)',
                padding: '12px',
                fontSize: '15px',
                fontFamily: 'inherit',
                resize: 'vertical',
                outline: 'none',
              }}
            />
            <button
              onClick={runTest}
              disabled={testing || !testText.trim()}
              style={{
                marginTop: '8px',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: '3px',
                color: 'var(--on-rubric)',
                padding: '8px 20px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
                opacity: testing ? 0.6 : 1,
              }}
            >
              {testing ? 'Testing...' : 'Test Corrections'}
            </button>
          </div>

          {testResult && (
            <div style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--accent3)',
              borderRadius: '3px',
              overflow: 'hidden',
            }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)', fontSize: '15px', color: 'var(--ink-faint)' }}>
                {testResult.changed
                  ? `${testResult.diffs.length} change(s) made`
                  : 'No changes'}
              </div>
              {testResult.changed && testResult.diffs.length > 0 && (
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {testResult.diffs.slice(0, 20).map((d, i) => (
                    <div key={i} style={{ fontFamily: 'monospace', fontSize: '14px' }}>
                      <div style={{ color: 'var(--rubric)' }}>- {d.before}</div>
                      <div style={{ color: 'var(--moss)' }}>+ {d.after}</div>
                    </div>
                  ))}
                </div>
              )}
              {testResult.changed && (
                <div style={{ padding: '12px 14px', borderTop: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)' }}>
                  <div style={{ fontSize: '14px', color: 'var(--ink-faint)', marginBottom: '6px' }}>Result:</div>
                  <pre style={{
                    fontFamily: 'monospace',
                    fontSize: '14px',
                    color: 'var(--ink)',
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                    maxHeight: '200px',
                    overflowY: 'auto',
                  }}>
                    {testResult.result}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// A written line, like the rest of the journal's inputs.
const inputStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--rule-strong)',
  borderRadius: 0,
  color: 'var(--ink)',
  padding: '6px 2px',
  fontSize: '18px',
  outline: 'none',
  flex: 1,
  minWidth: 0,
}

const addBtnStyle: React.CSSProperties = {
  background: 'var(--accent)',
  border: 'none',
  borderRadius: '3px',
  color: 'var(--on-rubric)',
  padding: '7px 14px',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const cancelBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--ink-faint)',
  cursor: 'pointer',
  fontSize: '17px',
  padding: '2px 4px',
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--ink-faint)',
  padding: '4px',
  display: 'flex',
  flexShrink: 0,
}
