import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'

// Speaker color palette
const SPEAKER_PALETTE = [
  '#60a5fa', // blue
  '#f472b6', // pink
  '#34d399', // green
  '#fb923c', // orange
  '#a78bfa', // purple
  '#facc15', // yellow
  '#38bdf8', // sky
  '#f87171', // red
]

function getSpeakerColor(speaker: string, colorMap: Map<string, string>): string {
  if (!colorMap.has(speaker)) {
    const idx = colorMap.size % SPEAKER_PALETTE.length
    colorMap.set(speaker, SPEAKER_PALETTE[idx])
  }
  return colorMap.get(speaker)!
}

interface ParsedLine {
  type: 'heading' | 'speech' | 'other'
  raw: string
  timestamp?: string
  speaker?: string
  text?: string
}

function parseTranscript(md: string): ParsedLine[] {
  const lines: ParsedLine[] = []
  for (const raw of md.split('\n')) {
    // Match: **[00:00] Speaker Name:** text
    const m = raw.match(/^\*\*\[([^\]]+)\] ([^:]+):\*\* (.*)$/)
    if (m) {
      lines.push({ type: 'speech', raw, timestamp: m[1], speaker: m[2].trim(), text: m[3] })
    } else if (raw.startsWith('#')) {
      lines.push({ type: 'heading', raw })
    } else {
      lines.push({ type: 'other', raw })
    }
  }
  return lines
}

type Tab = 'transcript' | 'summary' | 'wiki'

export default function SessionView() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('transcript')
  const [transcript, setTranscript] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [wiki, setWiki] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState(false)
  const speakerColors = new Map<string, string>()

  const load = async () => {
    setLoading(true)
    const [t, s, w] = await Promise.allSettled([
      fetch(`/sessions/${name}/transcript`).then(r => r.ok ? r.json() : null),
      fetch(`/sessions/${name}/summary`).then(r => r.ok ? r.json() : null),
      fetch(`/sessions/${name}/wiki`).then(r => r.ok ? r.json() : null),
    ])
    setTranscript(t.status === 'fulfilled' && t.value ? t.value.content : null)
    setSummary(s.status === 'fulfilled' && s.value ? s.value.content : null)
    setWiki(w.status === 'fulfilled' && w.value ? w.value.content : null)
    setLoading(false)
  }

  useEffect(() => { load() }, [name])

  const doMerge = async () => {
    setMerging(true)
    try {
      const r = await fetch(`/sessions/${name}/merge`, { method: 'POST' })
      if (r.ok) {
        load()
      } else {
        const err = await r.json()
        alert(err.detail || 'Merge failed')
      }
    } finally {
      setMerging(false)
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'transcript', label: 'Transcript' },
    { id: 'summary', label: 'Summary' },
    { id: 'wiki', label: 'Wiki' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '20px 28px',
        borderBottom: '1px solid #1e2130',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexShrink: 0,
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            padding: '4px 8px',
            fontSize: '13px',
            borderRadius: '6px',
          }}
        >
          ← Back
        </button>
        <div style={{ height: '16px', width: '1px', background: '#2a2d3a' }} />
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#e2e8f0' }}>{name}</h1>

        <div style={{ flex: 1 }} />

        <button
          onClick={doMerge}
          disabled={merging}
          style={{
            background: 'rgba(124,108,252,0.15)',
            border: '1px solid rgba(124,108,252,0.3)',
            borderRadius: '8px',
            color: '#a89cff',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            opacity: merging ? 0.5 : 1,
          }}
        >
          {merging ? 'Merging...' : 'Re-merge'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '0',
        padding: '0 28px',
        borderBottom: '1px solid #1e2130',
        flexShrink: 0,
      }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid #7c6cfc' : '2px solid transparent',
              color: tab === t.id ? '#a89cff' : '#64748b',
              padding: '12px 16px',
              fontSize: '13px',
              fontWeight: tab === t.id ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}

        {tab === 'transcript' && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', padding: '8px 0' }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search transcript..."
              style={{
                background: '#1a1d27',
                border: '1px solid #2a2d3a',
                borderRadius: '8px',
                color: '#e2e8f0',
                padding: '6px 12px',
                fontSize: '12px',
                width: '200px',
                outline: 'none',
              }}
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
        {loading ? (
          <div style={{ color: '#64748b' }}>Loading...</div>
        ) : tab === 'transcript' ? (
          <TranscriptView content={transcript} search={search} speakerColors={speakerColors} />
        ) : tab === 'summary' ? (
          <MarkdownView content={summary} emptyMsg="No summary yet. Run the pipeline to generate one." />
        ) : (
          <MarkdownView content={wiki} emptyMsg="No wiki suggestions yet. Run the pipeline to generate them." />
        )}
      </div>
    </div>
  )
}

function TranscriptView({
  content,
  search,
  speakerColors,
}: {
  content: string | null
  search: string
  speakerColors: Map<string, string>
}) {
  if (!content) {
    return (
      <div style={{ color: '#64748b', textAlign: 'center', paddingTop: '60px' }}>
        No transcript yet. Run the pipeline to generate one.
      </div>
    )
  }

  const lines = parseTranscript(content)
  const searchLower = search.toLowerCase()

  const highlight = (text: string) => {
    if (!search) return text
    const idx = text.toLowerCase().indexOf(searchLower)
    if (idx < 0) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: 'rgba(251,191,36,0.3)', color: '#fbbf24', borderRadius: '2px' }}>
          {text.slice(idx, idx + search.length)}
        </mark>
        {text.slice(idx + search.length)}
      </>
    )
  }

  const visible = lines.filter(line => {
    if (!search) return true
    return line.raw.toLowerCase().includes(searchLower)
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '820px' }}>
      {visible.map((line, i) => {
        if (line.type === 'heading') {
          return (
            <h2 key={i} style={{ fontSize: '15px', fontWeight: 700, color: '#e2e8f0', margin: '16px 0 8px' }}>
              {line.raw.replace(/^#+\s*/, '')}
            </h2>
          )
        }
        if (line.type === 'speech') {
          const color = getSpeakerColor(line.speaker!, speakerColors)
          return (
            <div key={i} style={{ display: 'flex', gap: '12px', padding: '5px 0', alignItems: 'flex-start' }}>
              {/* Timestamp */}
              <span style={{
                fontSize: '11px',
                color: '#475569',
                fontFamily: 'monospace',
                paddingTop: '2px',
                flexShrink: 0,
                width: '48px',
                textAlign: 'right',
              }}>
                {line.timestamp}
              </span>
              {/* Speaker chip */}
              <span style={{
                background: `${color}20`,
                color,
                borderRadius: '4px',
                padding: '1px 8px',
                fontSize: '11px',
                fontWeight: 700,
                flexShrink: 0,
                alignSelf: 'flex-start',
                marginTop: '1px',
              }}>
                {line.speaker}
              </span>
              {/* Text */}
              <span style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.6 }}>
                {highlight(line.text || '')}
              </span>
            </div>
          )
        }
        return null
      })}
    </div>
  )
}

function MarkdownView({ content, emptyMsg }: { content: string | null; emptyMsg: string }) {
  if (!content) {
    return (
      <div style={{ color: '#64748b', textAlign: 'center', paddingTop: '60px' }}>
        {emptyMsg}
      </div>
    )
  }
  return (
    <div style={{
      maxWidth: '820px',
      color: '#cbd5e1',
      fontSize: '14px',
      lineHeight: 1.7,
    }}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 style={{ color: '#e2e8f0', fontSize: '20px', marginBottom: '12px' }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ color: '#e2e8f0', fontSize: '16px', marginTop: '24px', marginBottom: '8px' }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ color: '#e2e8f0', fontSize: '14px', marginTop: '16px', marginBottom: '6px' }}>{children}</h3>,
          p: ({ children }) => <p style={{ marginBottom: '12px' }}>{children}</p>,
          li: ({ children }) => <li style={{ marginBottom: '4px' }}>{children}</li>,
          strong: ({ children }) => <strong style={{ color: '#e2e8f0' }}>{children}</strong>,
          code: ({ children }) => (
            <code style={{ background: '#1a1d27', borderRadius: '4px', padding: '2px 5px', fontSize: '12px' }}>
              {children}
            </code>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
