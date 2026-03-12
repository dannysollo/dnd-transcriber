import { useEffect, useRef, useState } from 'react'

interface Pattern {
  match: string
  replace: string
}

export default function CorrectionsPage() {
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
      fetch('/config/corrections').then(r => r.json()),
      fetch('/config/patterns').then(r => r.json()),
    ])
    setCorrections(c.corrections || {})
    setPatterns(p.patterns || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Fetch session count for Re-merge All button label
  useEffect(() => {
    fetch('/sessions').then(r => r.json()).then((sessions: Array<{ name: string; status: string }>) => {
      const withTranscripts = sessions.filter(s => s.status === 'has_transcript' || s.status === 'complete' || s.status === 'transcribed')
      setSessionCount(withTranscripts.length)
    }).catch(() => {})
  }, [])

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
      fetch('/merge/all', { method: 'POST' }).then(r => {
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
    if (line.startsWith('ERROR') || line.includes('✗') || line.includes('failed')) return '#f87171'
    if (line.includes('✓') || line.includes('complete') || line.includes('Complete')) return '#4ade80'
    if (line.startsWith('  ')) return '#94a3b8'
    return '#cbd5e1'
  }

  const saveCorrections = async (updated: Record<string, string>) => {
    setSaving(true)
    await fetch('/config/corrections', {
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
    await fetch('/config/patterns', {
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
    const r = await fetch('/config/test-correction', {
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

  return (
    <div style={{ padding: '32px', maxWidth: '1100px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#e2e8f0' }}>Corrections Editor</h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          Manage word corrections and regex patterns for transcript post-processing
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Left: editor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #2a2d3a' }}>
            {(['corrections', 'patterns'] as const).map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === t ? '2px solid #7c6cfc' : '2px solid transparent',
                  color: activeTab === t ? '#a89cff' : '#64748b',
                  padding: '10px 16px',
                  fontSize: '13px',
                  fontWeight: activeTab === t ? 600 : 400,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {t} ({t === 'corrections' ? sortedCorrections.length : patterns.length})
              </button>
            ))}
            {saving && <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#64748b', alignSelf: 'center' }}>Saving...</span>}
            {saved && <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#4ade80', alignSelf: 'center' }}>✓ Saved</span>}
          </div>

          {loading ? (
            <div style={{ color: '#64748b' }}>Loading...</div>
          ) : activeTab === 'corrections' ? (
            <>
              {/* Add form */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  value={newWrong}
                  onChange={e => setNewWrong(e.target.value)}
                  placeholder="Wrong word"
                  onKeyDown={e => e.key === 'Enter' && addCorrection()}
                  style={inputStyle}
                />
                <span style={{ color: '#64748b', alignSelf: 'center', fontSize: '16px' }}>→</span>
                <input
                  value={newRight}
                  onChange={e => setNewRight(e.target.value)}
                  placeholder="Correct word"
                  onKeyDown={e => e.key === 'Enter' && addCorrection()}
                  style={inputStyle}
                />
                <button onClick={addCorrection} style={addBtnStyle}>Add</button>
              </div>

              {/* List */}
              <div style={{
                background: '#1a1d27',
                border: '1px solid #2a2d3a',
                borderRadius: '10px',
                overflow: 'auto',
                maxHeight: '480px',
              }}>
                {sortedCorrections.length === 0 ? (
                  <div style={{ padding: '24px', color: '#64748b', textAlign: 'center', fontSize: '13px' }}>
                    No corrections yet
                  </div>
                ) : sortedCorrections.map(([wrong, right]) => (
                  <div key={wrong} style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 14px',
                    borderBottom: '1px solid #1e2130',
                    gap: '8px',
                  }}>
                    {editKey === wrong ? (
                      <>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#f87171', flex: 1 }}>{wrong}</span>
                        <span style={{ color: '#64748b' }}>→</span>
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
                        <button onClick={() => setEditKey(null)} style={cancelBtnStyle}>✕</button>
                      </>
                    ) : (
                      <>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#f87171', flex: 1 }}>{wrong}</span>
                        <span style={{ color: '#64748b', fontSize: '12px' }}>→</span>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#4ade80', flex: 1 }}>{right}</span>
                        <button onClick={() => { setEditKey(wrong); setEditVal(right) }} style={iconBtnStyle}>✏️</button>
                        <button onClick={() => deleteCorrection(wrong)} style={iconBtnStyle}>🗑</button>
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
                    style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: '11px' }}
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
                background: '#1a1d27',
                border: '1px solid #2a2d3a',
                borderRadius: '10px',
                overflow: 'auto',
                maxHeight: '480px',
              }}>
                {patterns.length === 0 ? (
                  <div style={{ padding: '24px', color: '#64748b', textAlign: 'center', fontSize: '13px' }}>
                    No patterns yet
                  </div>
                ) : patterns.map((p, i) => (
                  <div key={i} style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid #1e2130',
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'flex-start',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#a89cff', wordBreak: 'break-all' }}>
                        {p.match}
                      </div>
                      <div style={{ fontSize: '12px', color: '#4ade80', marginTop: '2px' }}>
                        → {p.replace}
                      </div>
                    </div>
                    <button onClick={() => deletePattern(i)} style={iconBtnStyle}>🗑</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Re-merge All section */}
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ borderTop: '1px solid #1e2130', paddingTop: '14px' }}>
            {!showMergeConfirm ? (
              <button
                onClick={() => setShowMergeConfirm(true)}
                disabled={mergeAllRunning}
                style={{
                  background: mergeAllRunning ? '#2a2d3a' : 'rgba(251,191,36,0.12)',
                  border: `1px solid ${mergeAllRunning ? '#2a2d3a' : 'rgba(251,191,36,0.3)'}`,
                  borderRadius: '8px',
                  color: mergeAllRunning ? '#64748b' : '#fbbf24',
                  padding: '8px 18px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: mergeAllRunning ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {mergeAllRunning ? (
                  <>
                    <span style={{ width: 12, height: 12, border: '2px solid rgba(251,191,36,0.3)', borderTopColor: '#fbbf24', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                    Re-merging...
                  </>
                ) : (
                  <>Re-merge All{sessionCount !== null ? ` (${sessionCount} sessions)` : ''}</>
                )}
              </button>
            ) : (
              <div style={{
                background: 'rgba(251,191,36,0.08)',
                border: '1px solid rgba(251,191,36,0.25)',
                borderRadius: '10px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}>
                <div style={{ fontSize: '13px', color: '#fbbf24' }}>
                  Re-run merge on all {sessionCount !== null ? sessionCount : ''} sessions with current corrections?
                </div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  This will overwrite transcript.md for every session that has speaker JSON files.
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={runMergeAll}
                    style={{
                      background: 'rgba(251,191,36,0.2)',
                      border: '1px solid rgba(251,191,36,0.4)',
                      borderRadius: '8px',
                      color: '#fbbf24',
                      padding: '7px 16px',
                      fontSize: '12px',
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
                      border: '1px solid #2a2d3a',
                      borderRadius: '8px',
                      color: '#64748b',
                      padding: '7px 16px',
                      fontSize: '12px',
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
                background: '#0d0f18',
                border: '1px solid #1e2130',
                borderRadius: '10px',
                overflow: 'hidden',
              }}>
                <div style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid #1e2130',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '11px',
                  color: '#64748b',
                  fontWeight: 600,
                }}>
                  Output
                  {mergeAllRunning && (
                    <span style={{ width: 10, height: 10, border: '2px solid rgba(124,108,252,0.3)', borderTopColor: '#7c6cfc', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                  )}
                  {mergeAllDone && mergeAllExitCode !== null && (
                    <span style={{ color: mergeAllExitCode === 0 ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                      {mergeAllExitCode === 0 ? '✓ Done' : `✗ Exit ${mergeAllExitCode}`}
                    </span>
                  )}
                </div>
                <div
                  ref={mergeLogRef}
                  style={{
                    padding: '10px 12px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
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
            <h3 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600, color: '#94a3b8' }}>
              Live Preview
            </h3>
            <textarea
              value={testText}
              onChange={e => setTestText(e.target.value)}
              placeholder="Paste transcript text here to test corrections..."
              style={{
                width: '100%',
                height: '160px',
                background: '#1a1d27',
                border: '1px solid #2a2d3a',
                borderRadius: '10px',
                color: '#e2e8f0',
                padding: '12px',
                fontSize: '12px',
                fontFamily: 'monospace',
                resize: 'vertical',
                outline: 'none',
              }}
            />
            <button
              onClick={runTest}
              disabled={testing || !testText.trim()}
              style={{
                marginTop: '8px',
                background: '#7c6cfc',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                padding: '8px 20px',
                fontSize: '13px',
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
              background: '#1a1d27',
              border: '1px solid #2a2d3a',
              borderRadius: '10px',
              overflow: 'hidden',
            }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #1e2130', fontSize: '12px', color: '#64748b' }}>
                {testResult.changed
                  ? `${testResult.diffs.length} change(s) made`
                  : 'No changes'}
              </div>
              {testResult.changed && testResult.diffs.length > 0 && (
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {testResult.diffs.slice(0, 20).map((d, i) => (
                    <div key={i} style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                      <div style={{ color: '#f87171' }}>- {d.before}</div>
                      <div style={{ color: '#4ade80' }}>+ {d.after}</div>
                    </div>
                  ))}
                </div>
              )}
              {testResult.changed && (
                <div style={{ padding: '12px 14px', borderTop: '1px solid #1e2130' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>Result:</div>
                  <pre style={{
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    color: '#cbd5e1',
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

const inputStyle: React.CSSProperties = {
  background: '#13151f',
  border: '1px solid #2a2d3a',
  borderRadius: '8px',
  color: '#e2e8f0',
  padding: '7px 10px',
  fontSize: '12px',
  outline: 'none',
  flex: 1,
}

const addBtnStyle: React.CSSProperties = {
  background: '#7c6cfc',
  border: 'none',
  borderRadius: '8px',
  color: '#fff',
  padding: '7px 14px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const cancelBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#64748b',
  cursor: 'pointer',
  fontSize: '14px',
  padding: '2px 4px',
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  padding: '2px 4px',
  opacity: 0.6,
  flexShrink: 0,
}
