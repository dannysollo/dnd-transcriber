import { useEffect, useRef, useState } from 'react'
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

function parseTimestampToSeconds(ts: string): number {
  const parts = ts.split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

// ─── Types for Changes tab ────────────────────────────────────────────────────

interface CorrectionEntry {
  original: string
  replacement: string
  hit_count: number
  examples: string[]
}

interface HallucinationEntry {
  line: number
  timestamp: string
  speaker: string
  text: string
  reason: string
}

interface ChangesReport {
  corrections_applied: CorrectionEntry[]
  patterns_applied: CorrectionEntry[]
  hallucinations: HallucinationEntry[]
  stats: {
    total_corrections: number
    total_hits: number
    hallucination_count: number
  }
}

type Tab = 'transcript' | 'summary' | 'wiki' | 'changes'

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
  const [audioFiles, setAudioFiles] = useState<string[]>([])
  const [selectedAudio, setSelectedAudio] = useState<string>('')
  const [currentTime, setCurrentTime] = useState(0)
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const [changesReport, setChangesReport] = useState<ChangesReport | null>(null)
  const [changesLoading, setChangesLoading] = useState(false)
  const [changesLoaded, setChangesLoaded] = useState(false)
  const [targetTimestamp, setTargetTimestamp] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const dragCounter = useRef(0)
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

  const loadAudioFiles = async () => {
    try {
      const r = await fetch(`/sessions/${name}/audio-files`)
      const data = await r.json()
      const files: string[] = data.files || []
      setAudioFiles(files)
      if (files.length > 0 && !selectedAudio) setSelectedAudio(files[0])
    } catch (_) {}
  }

  const loadChanges = async () => {
    if (changesLoaded) return
    setChangesLoading(true)
    try {
      const r = await fetch(`/sessions/${name}/corrections-report`)
      if (r.ok) {
        setChangesReport(await r.json())
      } else {
        setChangesReport(null)
      }
    } catch (_) {
      setChangesReport(null)
    } finally {
      setChangesLoading(false)
      setChangesLoaded(true)
    }
  }

  useEffect(() => {
    load()
    loadAudioFiles()
  }, [name])

  useEffect(() => {
    if (tab === 'changes') {
      loadChanges()
    }
  }, [tab])

  // Window-level drag-and-drop
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current++
      setIsDragOver(true)
    }
    const onDragLeave = () => {
      dragCounter.current--
      if (dragCounter.current <= 0) {
        dragCounter.current = 0
        setIsDragOver(false)
      }
    }
    const onDragOver = (e: DragEvent) => { e.preventDefault() }
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setIsDragOver(false)
      const files = Array.from(e.dataTransfer?.files || [])
      const zipFiles = files.filter(f => f.name.toLowerCase().endsWith('.zip'))
      const audioDropped = files.filter(f => /\.(flac|mp3|ogg|wav|m4a)$/i.test(f.name))
      if (zipFiles.length > 0) {
        setUploadingAudio(true)
        const form = new FormData()
        form.append('file', zipFiles[0])
        await fetch(`/sessions/${name}/import-zip`, { method: 'POST', body: form })
        setUploadingAudio(false)
        await loadAudioFiles()
      } else if (audioDropped.length > 0) {
        setUploadingAudio(true)
        const form = new FormData()
        audioDropped.forEach(f => form.append('files', f))
        await fetch(`/sessions/${name}/upload`, { method: 'POST', body: form })
        setUploadingAudio(false)
        await loadAudioFiles()
      }
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [name])

  const doMerge = async () => {
    setMerging(true)
    try {
      const r = await fetch(`/sessions/${name}/merge`, { method: 'POST' })
      if (r.ok) {
        load()
        // Invalidate changes report so it reloads next time
        setChangesLoaded(false)
        setChangesReport(null)
      } else {
        const err = await r.json()
        alert(err.detail || 'Merge failed')
      }
    } finally {
      setMerging(false)
    }
  }

  const seekTo = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = seconds
      audioRef.current.play()
    }
  }

  const goToHallucination = (timestamp: string) => {
    setSearch('')
    setTargetTimestamp(timestamp)
    setTab('transcript')
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'transcript', label: 'Transcript' },
    { id: 'summary', label: 'Summary' },
    { id: 'wiki', label: 'Wiki' },
    { id: 'changes', label: 'Changes' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Window drag overlay */}
      {isDragOver && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(124,108,252,0.08)',
          border: '3px dashed rgba(124,108,252,0.5)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            background: '#1a1d27',
            borderRadius: '16px',
            padding: '32px 64px',
            color: '#a78bfa',
            fontSize: '18px',
            fontWeight: 700,
            border: '1px solid rgba(124,108,252,0.4)',
          }}>
            {uploadingAudio ? '⏳ Uploading...' : '🎵 Drop audio files or ZIP to import'}
          </div>
        </div>
      )}

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

      {/* Audio player panel — transcript tab only */}
      {tab === 'transcript' && audioFiles.length > 0 && (
        <div style={{
          borderBottom: '1px solid #1e2130',
          background: '#0a0d14',
          flexShrink: 0,
          padding: '10px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          {/* File selector */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', color: '#475569', fontWeight: 700, letterSpacing: '0.08em' }}>
              AUDIO
            </span>
            {audioFiles.map(f => (
              <button
                key={f}
                onClick={() => setSelectedAudio(f)}
                style={{
                  background: selectedAudio === f ? 'rgba(124,108,252,0.2)' : 'transparent',
                  border: `1px solid ${selectedAudio === f ? '#7c6cfc' : '#2a2d3a'}`,
                  borderRadius: '4px',
                  color: selectedAudio === f ? '#a78bfa' : '#64748b',
                  padding: '2px 8px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  maxWidth: '220px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={f}
              >
                {f}
              </button>
            ))}
          </div>
          {selectedAudio && (
            <audio
              ref={audioRef}
              key={selectedAudio}
              src={`/sessions/${encodeURIComponent(name!)}/audio/${encodeURIComponent(selectedAudio)}`}
              controls
              onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
              style={{ width: '100%', height: '36px', accentColor: '#7c6cfc' }}
            />
          )}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
        {loading ? (
          <div style={{ color: '#64748b' }}>Loading...</div>
        ) : tab === 'transcript' ? (
          <TranscriptView
            content={transcript}
            search={search}
            speakerColors={speakerColors}
            currentTime={audioFiles.length > 0 ? currentTime : undefined}
            onSeek={audioFiles.length > 0 ? seekTo : undefined}
            targetTimestamp={targetTimestamp}
            onTargetReached={() => setTargetTimestamp(null)}
          />
        ) : tab === 'summary' ? (
          <MarkdownView content={summary} emptyMsg="No summary yet. Run the pipeline to generate one." />
        ) : tab === 'wiki' ? (
          <MarkdownView content={wiki} emptyMsg="No wiki suggestions yet. Run the pipeline to generate them." />
        ) : (
          <ChangesView
            report={changesReport}
            loading={changesLoading}
            onHallucinationClick={goToHallucination}
          />
        )}
      </div>
    </div>
  )
}

function TranscriptView({
  content,
  search,
  speakerColors,
  currentTime,
  onSeek,
  targetTimestamp,
  onTargetReached,
}: {
  content: string | null
  search: string
  speakerColors: Map<string, string>
  currentTime?: number
  onSeek?: (seconds: number) => void
  targetTimestamp?: string | null
  onTargetReached?: () => void
}) {
  const activeLineRef = useRef<HTMLDivElement | null>(null)
  const targetLineRef = useRef<HTMLDivElement | null>(null)
  const [flashTimestamp, setFlashTimestamp] = useState<string | null>(null)

  useEffect(() => {
    if (!targetTimestamp) return
    // Small delay to let the DOM settle after tab switch
    const timer = setTimeout(() => {
      if (targetLineRef.current) {
        targetLineRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setFlashTimestamp(targetTimestamp)
        setTimeout(() => {
          setFlashTimestamp(null)
          onTargetReached?.()
        }, 2000)
      }
    }, 80)
    return () => clearTimeout(timer)
  }, [targetTimestamp])

  if (!content) {
    return (
      <div style={{ color: '#64748b', textAlign: 'center', paddingTop: '60px' }}>
        No transcript yet. Run the pipeline to generate one.
      </div>
    )
  }

  const lines = parseTranscript(content)
  const searchLower = search.toLowerCase()

  const visible = lines.filter(line => {
    if (!search) return true
    return line.raw.toLowerCase().includes(searchLower)
  })

  // Find active line index (last speech line with timestamp <= currentTime)
  let activeIdx = -1
  if (currentTime !== undefined) {
    for (let i = 0; i < visible.length; i++) {
      const line = visible[i]
      if (line.type === 'speech' && line.timestamp) {
        if (parseTimestampToSeconds(line.timestamp) <= currentTime) {
          activeIdx = i
        }
      }
    }
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const el = activeLineRef.current
    if (!el) return
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIdx])

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '820px' }}>
      {visible.map((line, i) => {
        const isActive = i === activeIdx
        const isTarget = line.type === 'speech' && line.timestamp === targetTimestamp
        const isFlash = line.type === 'speech' && line.timestamp === flashTimestamp

        if (line.type === 'heading') {
          return (
            <h2 key={i} style={{ fontSize: '15px', fontWeight: 700, color: '#e2e8f0', margin: '16px 0 8px' }}>
              {line.raw.replace(/^#+\s*/, '')}
            </h2>
          )
        }
        if (line.type === 'speech') {
          const color = getSpeakerColor(line.speaker!, speakerColors)
          const tsSeconds = line.timestamp ? parseTimestampToSeconds(line.timestamp) : null
          return (
            <div
              key={i}
              ref={el => {
                if (isActive) activeLineRef.current = el
                if (isTarget) targetLineRef.current = el
              }}
              style={{
                display: 'flex',
                gap: '12px',
                padding: '5px 6px',
                alignItems: 'flex-start',
                borderRadius: '6px',
                background: isFlash
                  ? 'rgba(251,191,36,0.15)'
                  : isActive
                  ? 'rgba(124,108,252,0.1)'
                  : 'transparent',
                outline: isFlash ? '1px solid rgba(251,191,36,0.4)' : 'none',
                transition: 'background 0.4s, outline 0.4s',
              }}
            >
              {/* Timestamp — clickable if audio available */}
              {onSeek && tsSeconds !== null ? (
                <button
                  onClick={() => onSeek(tsSeconds)}
                  title={`Seek to ${line.timestamp}`}
                  style={{
                    fontSize: '11px',
                    color: isActive ? '#a78bfa' : '#475569',
                    fontFamily: 'monospace',
                    paddingTop: '2px',
                    flexShrink: 0,
                    width: '48px',
                    textAlign: 'right',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '0',
                    textDecoration: 'underline',
                    textDecorationColor: 'rgba(124,108,252,0.4)',
                  }}
                >
                  {line.timestamp}
                </button>
              ) : (
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
              )}
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
              <span style={{ fontSize: '13px', color: isActive ? '#e2e8f0' : '#cbd5e1', lineHeight: 1.6 }}>
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

// ─── Changes tab ──────────────────────────────────────────────────────────────

function CorrectionList({ items, label }: { items: CorrectionEntry[]; label: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (items.length === 0) {
    return (
      <div style={{ color: '#475569', fontSize: '13px', fontStyle: 'italic' }}>
        No {label.toLowerCase()} configured.
      </div>
    )
  }

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {items.map((item, i) => {
        const key = `${item.original}::${i}`
        const isOpen = expanded.has(key)
        const dimmed = item.hit_count === 0
        return (
          <div key={key} style={{
            borderRadius: '8px',
            border: '1px solid #1e2130',
            overflow: 'hidden',
            opacity: dimmed ? 0.45 : 1,
          }}>
            <button
              onClick={() => toggle(key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                background: 'transparent',
                border: 'none',
                cursor: item.examples.length > 0 ? 'pointer' : 'default',
                padding: '8px 12px',
                textAlign: 'left',
              }}
            >
              {/* Arrow */}
              <span style={{ color: '#475569', fontSize: '10px', flexShrink: 0, width: '10px' }}>
                {item.examples.length > 0 ? (isOpen ? '▼' : '▶') : ' '}
              </span>
              {/* Pill */}
              <span style={{
                background: 'rgba(52,211,153,0.12)',
                border: '1px solid rgba(52,211,153,0.25)',
                color: '#34d399',
                borderRadius: '999px',
                padding: '2px 10px',
                fontSize: '12px',
                fontFamily: 'monospace',
                fontWeight: 600,
                flexShrink: 0,
              }}>
                {item.original} → {item.replacement}
              </span>
              {/* Hit count badge */}
              <span style={{
                background: item.hit_count > 0 ? 'rgba(52,211,153,0.15)' : '#1a1d27',
                color: item.hit_count > 0 ? '#34d399' : '#475569',
                borderRadius: '999px',
                padding: '1px 8px',
                fontSize: '11px',
                fontWeight: 700,
                flexShrink: 0,
              }}>
                {item.hit_count} {item.hit_count === 1 ? 'hit' : 'hits'}
              </span>
            </button>

            {isOpen && item.examples.length > 0 && (
              <div style={{
                padding: '6px 12px 10px 32px',
                borderTop: '1px solid #1a1d27',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}>
                {item.examples.map((ex, ei) => {
                  const arrow = ex.indexOf(' → ')
                  const before = arrow >= 0 ? ex.slice(0, arrow) : ex
                  const after = arrow >= 0 ? ex.slice(arrow + 3) : ''
                  return (
                    <div key={ei} style={{ fontSize: '11px', fontFamily: 'monospace', color: '#94a3b8', lineHeight: 1.5 }}>
                      <ExampleLine text={before} word={item.original} color="#f87171" />
                      {after && (
                        <>
                          <span style={{ color: '#475569' }}> → </span>
                          <ExampleLine text={after} word={item.replacement} color="#34d399" />
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ExampleLine({ text, word, color }: { text: string; word: string; color: string }) {
  const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = text.split(re)
  return (
    <>
      {parts.map((part, i) =>
        re.test(part) ? (
          <mark key={i} style={{ background: `${color}25`, color, borderRadius: '2px', padding: '0 1px' }}>
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

function ChangesView({
  report,
  loading,
  onHallucinationClick,
}: {
  report: ChangesReport | null
  loading: boolean
  onHallucinationClick: (timestamp: string) => void
}) {
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#64748b', paddingTop: '60px', justifyContent: 'center' }}>
        <span style={{ fontSize: '18px', animation: 'spin 1s linear infinite' }}>⟳</span>
        Analyzing corrections...
      </div>
    )
  }

  if (!report) {
    return (
      <div style={{ color: '#64748b', textAlign: 'center', paddingTop: '60px' }}>
        No transcript yet. Run the pipeline to generate one.
      </div>
    )
  }

  const { corrections_applied, patterns_applied, hallucinations, stats } = report

  return (
    <div style={{ maxWidth: '820px', display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* Stats bar */}
      <div style={{
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
        flexWrap: 'wrap',
        background: '#0d1017',
        border: '1px solid #1e2130',
        borderRadius: '10px',
        padding: '12px 16px',
        fontSize: '13px',
        color: '#94a3b8',
      }}>
        <span style={{ color: '#34d399', fontWeight: 700 }}>
          {stats.total_corrections} correction{stats.total_corrections !== 1 ? 's' : ''} configured
        </span>
        <span style={{ color: '#475569' }}>·</span>
        <span>
          <span style={{ color: '#34d399', fontWeight: 700 }}>{stats.total_hits}</span> total hits
        </span>
        <span style={{ color: '#475569' }}>·</span>
        <span>
          <span style={{ color: stats.hallucination_count > 0 ? '#fbbf24' : '#64748b', fontWeight: 700 }}>
            {stats.hallucination_count}
          </span>{' '}
          potential hallucination{stats.hallucination_count !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Corrections Applied */}
      <section>
        <h3 style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Corrections Applied
        </h3>
        <CorrectionList items={corrections_applied} label="Corrections" />
      </section>

      {/* Patterns Applied */}
      <section>
        <h3 style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Patterns Applied
        </h3>
        <CorrectionList items={patterns_applied} label="Patterns" />
      </section>

      {/* Possible Hallucinations */}
      <section>
        <h3 style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Possible Hallucinations
        </h3>
        {hallucinations.length === 0 ? (
          <div style={{ color: '#475569', fontSize: '13px', fontStyle: 'italic' }}>
            No suspicious lines detected.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {hallucinations.map((h, i) => (
              <button
                key={i}
                onClick={() => onHallucinationClick(h.timestamp)}
                title="Jump to this line in Transcript"
                style={{
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'baseline',
                  background: 'rgba(251,191,36,0.05)',
                  border: '1px solid rgba(251,191,36,0.15)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(251,191,36,0.1)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(251,191,36,0.05)')}
              >
                <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#fbbf24', flexShrink: 0 }}>
                  {h.timestamp}
                </span>
                <span style={{ fontSize: '11px', color: '#94a3b8', flexShrink: 0 }}>
                  {h.speaker}
                </span>
                <span style={{ fontSize: '13px', color: '#e2e8f0', flex: 1 }}>
                  "{h.text}"
                </span>
                <span style={{
                  background: 'rgba(251,191,36,0.15)',
                  color: '#fbbf24',
                  borderRadius: '999px',
                  padding: '1px 8px',
                  fontSize: '10px',
                  fontWeight: 600,
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}>
                  {h.reason}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

    </div>
  )
}
