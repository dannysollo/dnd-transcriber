import { useEffect, useRef, useState } from 'react'
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

  // Re-merge all
  const [sessionCount, setSessionCount] = useState<number | null>(null)
  const [mergeAllRunning, setMergeAllRunning] = useState(false)
  const [mergeAllLogs, setMergeAllLogs] = useState<string[]>([])
  const [mergeAllDone, setMergeAllDone] = useState(false)
  const [mergeAllExitCode, setMergeAllExitCode] = useState<number | null>(null)
  const [showMergeConfirm, setShowMergeConfirm] = useState(false)
  const mergeLogRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

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

  // Fetch session count for Re-merge All button label
  useEffect(() => {
    fetch(apiUrl('/sessions')).then(r => r.json()).then((sessions: Array<{ name: string; status: string }>) => {
      const withTranscripts = sessions.filter(s => s.status === 'has_transcript' || s.status === 'complete' || s.status === 'transcribed')
      setSessionCount(withTranscripts.length)
    }).catch(() => {})
  }, [apiUrl])

  // Auto-scroll merge logs
  useEffect(() => {
    if (mergeLogRef.current) mergeLogRef.current.scrollTop = mergeLogRef.current.scrollHeight
  }, [mergeAllLogs])

  const runMergeAll = () => {
    setMergeAllLogs([])
    setMergeAllDone(false)
    setMergeAllExitCode(null)
    setMergeAllRunning(true)
    setShowMergeConfirm(false)

    // Open WebSocket first, then trigger the merge
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${location.host}/ws/progress`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'log') {
        const line: string = msg.line
        if (line.startsWith('__EXIT__')) {
          const code = parseInt(line.replace('__EXIT__', ''))
          setMergeAllExitCode(code)
          setMergeAllRunning(false)
          setMergeAllDone(true)
          ws.close()
        } else {
          setMergeAllLogs(prev => [...prev, line])
        }
      }
    }

    ws.onopen = () => {
      fetch(apiUrl('/merge/all'), { method: 'POST' }).then(r => {
        if (!r.ok) {
          r.json().then(err => {
            setMergeAllLogs(prev => [...prev, `Error: ${err.detail || 'Failed to start'}`])
            setMergeAllRunning(false)
            ws.close()
          })
        }
      })
    }

    ws.onerror = () => {
      setMergeAllRunning(false)
      ws.close()
    }
  }

  const getLineColor = (line: string) => {
    if (line.startsWith('ERROR') || line.includes('✗') || line.includes('failed')) return 'var(--rubric)'
    if (line.includes('✓') || line.includes('complete') || line.includes('Complete')) return 'var(--moss)'
    if (line.startsWith('  ')) return 'var(--ink-soft)'
    return 'var(--ink)'
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

        {/* Re-merge All section */}
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ borderTop: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)', paddingTop: '14px' }}>
            {!showMergeConfirm ? (
              <button
                onClick={() => setShowMergeConfirm(true)}
                disabled={mergeAllRunning}
                className="btn-ghost"
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                {mergeAllRunning ? (
                  <>
                    <span style={{ width: 12, height: 12, border: '2px solid color-mix(in srgb, var(--ochre) 30%, transparent)', borderTopColor: 'var(--ochre)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                    Re-merging...
                  </>
                ) : (
                  <>Re-merge All{sessionCount !== null ? ` (${sessionCount} sessions)` : ''}</>
                )}
              </button>
            ) : (
              <div style={{
                background: 'color-mix(in srgb, var(--ochre) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--ochre) 25%, transparent)',
                borderRadius: '3px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}>
                <div style={{ fontSize: '16px', color: 'var(--ochre)' }}>
                  Re-run merge on all {sessionCount !== null ? sessionCount : ''} sessions with current corrections?
                </div>
                <div style={{ fontSize: '15px', color: 'var(--ink-faint)' }}>
                  This will overwrite transcript.md for every session that has speaker JSON files.
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={runMergeAll}
                    style={{
                      background: 'color-mix(in srgb, var(--ochre) 20%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--ochre) 40%, transparent)',
                      borderRadius: '3px',
                      color: 'var(--ochre)',
                      padding: '7px 16px',
                      fontSize: '15px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowMergeConfirm(false)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--accent3)',
                      borderRadius: '3px',
                      color: 'var(--ink-faint)',
                      padding: '7px 16px',
                      fontSize: '15px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Merge log output */}
            {(mergeAllLogs.length > 0 || mergeAllRunning) && (
              <div style={{
                marginTop: '10px',
                background: 'var(--page-sunk)',
                border: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)',
                borderRadius: '3px',
                overflow: 'hidden',
              }}>
                <div style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '14px',
                  color: 'var(--ink-faint)',
                  fontWeight: 600,
                }}>
                  Output
                  {mergeAllRunning && (
                    <span style={{ width: 10, height: 10, border: '2px solid color-mix(in srgb, var(--rubric) 30%, transparent)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                  )}
                  {mergeAllDone && mergeAllExitCode !== null && (
                    <span style={{ color: mergeAllExitCode === 0 ? 'var(--moss)' : 'var(--rubric)', fontWeight: 700 }}>
                      {mergeAllExitCode === 0 ? 'Done' : `Failed (exit ${mergeAllExitCode})`}
                    </span>
                  )}
                </div>
                <div
                  ref={mergeLogRef}
                  style={{
                    padding: '10px 12px',
                    fontFamily: 'monospace',
                    fontSize: '14px',
                    lineHeight: 1.7,
                    maxHeight: '220px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1px',
                  }}
                >
                  {mergeAllLogs.map((line, i) => (
                    <div key={i} style={{ color: getLineColor(line), whiteSpace: 'pre-wrap' }}>
                      {line || '\u00a0'}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
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
