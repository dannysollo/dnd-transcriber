import { useEffect, useRef, useState } from 'react'

interface Session {
  name: string
  status: string
}

export default function PipelinePage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState('')
  const [transcribeOnly, setTranscribeOnly] = useState(false)
  const [wikiOnly, setWikiOnly] = useState(false)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [exitCode, setExitCode] = useState<number | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Load sessions
  useEffect(() => {
    fetch('/sessions').then(r => r.json()).then(setSessions)
  }, [])

  // WebSocket connection
  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${location.host}/ws/progress`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'log') {
        const line: string = msg.line
        if (line.startsWith('__EXIT__')) {
          const code = parseInt(line.replace('__EXIT__', ''))
          setExitCode(code)
          setRunning(false)
        } else {
          setLogs(prev => [...prev, line])
        }
      } else if (msg.type === 'status') {
        setRunning(msg.running)
      }
    }

    // Check initial status
    fetch('/pipeline/status').then(r => r.json()).then(s => {
      setRunning(s.running)
    })

    return () => ws.close()
  }, [])

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  const run = async () => {
    if (!selectedSession) return
    setLogs([])
    setExitCode(null)
    setRunning(true)

    const r = await fetch('/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: selectedSession,
        transcribe_only: transcribeOnly,
        wiki_only: wikiOnly,
      }),
    })
    if (!r.ok) {
      const err = await r.json()
      alert(err.detail || 'Failed to start pipeline')
      setRunning(false)
    }
  }

  const getLineColor = (line: string) => {
    if (line.startsWith('ERROR') || line.includes('✗') || line.includes('failed')) return '#f87171'
    if (line.includes('✓') || line.includes('complete') || line.includes('saved')) return '#4ade80'
    if (line.startsWith('=') || line.startsWith('[')) return '#a89cff'
    if (line.startsWith('  ')) return '#94a3b8'
    return '#cbd5e1'
  }

  return (
    <div style={{ padding: '32px', maxWidth: '900px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#e2e8f0' }}>Pipeline Runner</h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          Transcribe audio and generate wiki suggestions
        </p>
      </div>

      {/* Controls */}
      <div style={{
        background: '#1a1d27',
        border: '1px solid #2a2d3a',
        borderRadius: '12px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}>
        {/* Session selector */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
            Session
          </label>
          <select
            value={selectedSession}
            onChange={e => setSelectedSession(e.target.value)}
            style={{
              background: '#13151f',
              border: '1px solid #2a2d3a',
              borderRadius: '8px',
              color: '#e2e8f0',
              padding: '8px 12px',
              fontSize: '13px',
              width: '240px',
              outline: 'none',
            }}
          >
            <option value="">Select session...</option>
            {sessions.map(s => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Step selector */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '8px' }}>
            Steps
          </label>
          <div style={{ display: 'flex', gap: '16px' }}>
            {[
              { id: 'full', label: 'Full pipeline', desc: 'Vocab → Transcribe → Merge → Wiki' },
              { id: 'transcribe', label: 'Transcribe only', desc: 'Stop after merge' },
              { id: 'wiki', label: 'Wiki only', desc: 'Skip transcription' },
            ].map(opt => {
              const active =
                opt.id === 'full' ? (!transcribeOnly && !wikiOnly) :
                opt.id === 'transcribe' ? transcribeOnly :
                wikiOnly
              return (
                <button
                  key={opt.id}
                  onClick={() => {
                    if (opt.id === 'full') { setTranscribeOnly(false); setWikiOnly(false) }
                    else if (opt.id === 'transcribe') { setTranscribeOnly(true); setWikiOnly(false) }
                    else { setTranscribeOnly(false); setWikiOnly(true) }
                  }}
                  style={{
                    background: active ? 'rgba(124,108,252,0.15)' : 'transparent',
                    border: `1px solid ${active ? 'rgba(124,108,252,0.4)' : '#2a2d3a'}`,
                    borderRadius: '8px',
                    padding: '10px 14px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 600, color: active ? '#a89cff' : '#e2e8f0' }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{opt.desc}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Run button */}
        <div>
          <button
            onClick={run}
            disabled={running || !selectedSession}
            style={{
              background: running ? '#2a2d3a' : '#7c6cfc',
              border: 'none',
              borderRadius: '8px',
              color: running ? '#64748b' : '#fff',
              padding: '10px 24px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: (running || !selectedSession) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {running ? (
              <>
                <Spinner />
                Running...
              </>
            ) : 'Run Pipeline'}
          </button>
        </div>
      </div>

      {/* Log output */}
      {(logs.length > 0 || running) && (
        <div style={{
          background: '#0d0f18',
          border: '1px solid #1e2130',
          borderRadius: '12px',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 16px',
            borderBottom: '1px solid #1e2130',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>Output</span>
            {running && <Spinner size={10} />}
            {exitCode !== null && (
              <span style={{
                fontSize: '11px',
                color: exitCode === 0 ? '#4ade80' : '#f87171',
                fontWeight: 600,
              }}>
                {exitCode === 0 ? '✓ Completed' : `✗ Exit code ${exitCode}`}
              </span>
            )}
          </div>
          <div
            ref={logRef}
            style={{
              padding: '12px 16px',
              fontFamily: 'monospace',
              fontSize: '12px',
              lineHeight: 1.7,
              maxHeight: '480px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '1px',
            }}
          >
            {logs.map((line, i) => (
              <div key={i} style={{ color: getLineColor(line), whiteSpace: 'pre-wrap' }}>
                {line || '\u00a0'}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <div style={{
      width: size,
      height: size,
      border: `2px solid rgba(124,108,252,0.3)`,
      borderTopColor: '#7c6cfc',
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
    }} />
  )
}
