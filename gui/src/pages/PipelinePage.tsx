import { useToast } from '../Toast'
import { useEffect, useRef, useState } from 'react'
import { useApiUrl } from '../CampaignContext'

interface Session {
  name: string
  status: string
}

export default function PipelinePage() {
  const apiUrl = useApiUrl()
  const { toast } = useToast()
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
    fetch(apiUrl('/sessions')).then(r => r.json()).then(setSessions)
  }, [apiUrl])

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

    const r = await fetch(apiUrl('/pipeline/run'), {
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
      toast(err.detail || 'Failed to start pipeline', 'error')
      setRunning(false)
    }
  }

  const getLineColor = (line: string) => {
    if (line.startsWith('ERROR') || line.includes('✗') || line.includes('failed')) return 'var(--rubric)'
    if (line.includes('✓') || line.includes('complete') || line.includes('saved')) return 'var(--moss)'
    if (line.startsWith('=') || line.startsWith('[')) return 'var(--accent-text)'
    if (line.startsWith('  ')) return 'var(--ink-soft)'
    return 'var(--ink)'
  }

  return (
    <div style={{ padding: '32px', maxWidth: '900px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '34px', fontWeight: 500, color: 'var(--ink)' }}>Pipeline Runner</h1>
        <p style={{ margin: '4px 0 0', fontSize: '16px', color: 'var(--ink-faint)' }}>
          Transcribe audio and generate wiki suggestions
        </p>
      </div>

      {/* Controls */}
      <div style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: '3px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}>
        {/* Session selector */}
        <div>
          <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, color: 'var(--ink-soft)', marginBottom: '6px' }}>
            Session
          </label>
          <select
            value={selectedSession}
            onChange={e => setSelectedSession(e.target.value)}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: '3px',
              color: 'var(--ink)',
              padding: '8px 12px',
              fontSize: '16px',
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
          <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, color: 'var(--ink-soft)', marginBottom: '8px' }}>
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
                    background: active ? 'color-mix(in srgb, var(--rubric) 15%, transparent)' : 'transparent',
                    border: `1px solid ${active ? 'color-mix(in srgb, var(--rubric) 40%, transparent)' : 'var(--border-default)'}`,
                    borderRadius: '3px',
                    padding: '10px 14px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: '16px', fontWeight: 600, color: active ? 'var(--accent-text)' : 'var(--ink)' }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: '14px', color: 'var(--ink-faint)', marginTop: '2px' }}>{opt.desc}</div>
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
              background: running ? 'var(--border-default)' : 'var(--accent)',
              border: 'none',
              borderRadius: '3px',
              color: running ? 'var(--ink-faint)' : 'var(--on-rubric)',
              padding: '10px 24px',
              fontSize: '17px',
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
          background: 'var(--page-sunk)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '3px',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ink-faint)' }}>Output</span>
            {running && <Spinner size={10} />}
            {exitCode !== null && (
              <span style={{
                fontSize: '14px',
                color: exitCode === 0 ? 'var(--moss)' : 'var(--rubric)',
                fontWeight: 600,
              }}>
                {exitCode === 0 ? 'Completed' : `Failed (exit ${exitCode})`}
              </span>
            )}
          </div>
          <div
            ref={logRef}
            style={{
              padding: '12px 16px',
              fontFamily: 'monospace',
              fontSize: '15px',
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
      border: `2px solid color-mix(in srgb, var(--rubric) 30%, transparent)`,
      borderTopColor: 'var(--accent)',
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
    }} />
  )
}
