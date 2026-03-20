import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useApiUrl, useCampaign } from '../CampaignContext'
import { useAuth } from '../AuthContext'
import { useToast } from '../Toast'
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

interface AudioFile {
  filename: string
  label: string
  url: string
}

interface Player {
  username: string
  name: string
  character: string | null
  role: string
}

function findTrackForSpeaker(speakerLabel: string, audioFiles: AudioFile[], players: Player[]): AudioFile | null {
  for (const player of players) {
    if (speakerLabel.includes(player.name) || (player.character && speakerLabel.includes(player.character))) {
      const match = audioFiles.find(f => f.filename.toLowerCase().includes(player.username.toLowerCase()))
      if (match) return match
    }
  }
  return null
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
    // Match: **[00:00] Speaker Name:** text  (with speaker)
    const m = raw.match(/^\*\*\[([^\]]+)\] ([^:]+):\*\* (.*)$/)
    if (m) {
      lines.push({ type: 'speech', raw, timestamp: m[1], speaker: m[2].trim(), text: m[3] })
      continue
    }
    // Match: **[00:00]** text  (no speaker — worker mixed-audio format)
    const m2 = raw.match(/^\*\*\[([^\]]+)\]\*\* (.*)$/)
    if (m2) {
      lines.push({ type: 'speech', raw, timestamp: m2[1], speaker: undefined, text: m2[2] })
      continue
    }
    if (raw.startsWith('#')) {
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

// ─── Types for Wiki tab ───────────────────────────────────────────────────────

interface WikiSuggestion {
  id: number
  title: string
  page: string | null
  section: string
  bullets: string[]
  new_page: boolean
  description: string | null
}

type Tab = 'transcript' | 'summary' | 'wiki' | 'changes'

export default function SessionView() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const apiUrl = useApiUrl()
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('transcript')
  const [transcript, setTranscript] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [wiki, setWiki] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState(false)
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([])
  const [selectedAudio, setSelectedAudio] = useState<string>('')
  const [players, setPlayers] = useState<Player[]>([])
  const [, setMixingInProgress] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const [changesReport, setChangesReport] = useState<ChangesReport | null>(null)
  const [changesLoading, setChangesLoading] = useState(false)
  const [changesLoaded, setChangesLoaded] = useState(false)
  const [targetTimestamp, setTargetTimestamp] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [shareCreating, setShareCreating] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [shareShowTranscript, setShareShowTranscript] = useState(true)
  const [shareShowSummary, setShareShowSummary] = useState(true)
  const [shareShowWiki, setShareShowWiki] = useState(true)
  const [existingShares, setExistingShares] = useState<{ token: string; created_at: string; expires_at: string | null; expired: boolean }[]>([])
  const [sharesLoading, setSharesLoading] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const pendingSeekRef = useRef<number | null>(null)
  const dragCounter = useRef(0)
  const speakerColors = new Map<string, string>()

  const load = async () => {
    setLoading(true)
    const [t, s, w] = await Promise.allSettled([
      fetch(apiUrl(`/sessions/${name}/transcript`)).then(r => r.ok ? r.json() : null),
      fetch(apiUrl(`/sessions/${name}/summary`)).then(r => r.ok ? r.json() : null),
      fetch(apiUrl(`/sessions/${name}/wiki`)).then(r => r.ok ? r.json() : null),
    ])
    setTranscript(t.status === 'fulfilled' && t.value ? t.value.content : null)
    setSummary(s.status === 'fulfilled' && s.value ? s.value.content : null)
    setWiki(w.status === 'fulfilled' && w.value ? w.value.content : null)
    setLoading(false)
  }

  const loadAudioFiles = async () => {
    try {
      const r = await fetch(apiUrl(`/sessions/${name}/audio-files`))
      const data = await r.json()
      const files: AudioFile[] = data.files || []
      setAudioFiles(files)
      if (files.length > 0 && !selectedAudio) setSelectedAudio(files[0].filename)
    } catch (_) {}
  }

  const loadPlayers = async () => {
    try {
      const r = await fetch(apiUrl('/config'))
      if (r.ok) {
        const config = await r.json()
        const playersObj = config.players || {}
        setPlayers(
          Object.entries(playersObj).map(([username, info]: [string, any]) => ({
            username,
            name: info.name as string,
            character: info.character as string | null,
            role: info.role as string,
          }))
        )
      }
    } catch (_) {}
  }

  const loadChanges = async () => {
    if (changesLoaded) return
    setChangesLoading(true)
    try {
      const r = await fetch(apiUrl(`/sessions/${name}/corrections-report`))
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
    loadPlayers()
  }, [name, apiUrl])

  useEffect(() => {
    if (selectedAudio === '_merged') setMixingInProgress(true)
    else setMixingInProgress(false)
  }, [selectedAudio])

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
        await fetch(apiUrl(`/sessions/${name}/import-zip`), { method: 'POST', body: form })
        setUploadingAudio(false)
        await loadAudioFiles()
      } else if (audioDropped.length > 0) {
        setUploadingAudio(true)
        const form = new FormData()
        audioDropped.forEach(f => form.append('files', f))
        await fetch(apiUrl(`/sessions/${name}/upload`), { method: 'POST', body: form })
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
      const r = await fetch(apiUrl(`/sessions/${name}/merge`), { method: 'POST' })
      if (r.ok) {
        load()
        // Invalidate changes report so it reloads next time
        setChangesLoaded(false)
        setChangesReport(null)
      } else {
        const err = await r.json()
        toast(err.detail || 'Merge failed', 'error')
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

  const seekAndSwitch = (seconds: number, speaker?: string) => {
    if (selectedAudio === '_merged' || !speaker || players.length === 0) {
      seekTo(seconds)
      return
    }
    const match = findTrackForSpeaker(speaker, audioFiles, players)
    if (match && match.filename !== selectedAudio) {
      pendingSeekRef.current = seconds
      setSelectedAudio(match.filename)
    } else {
      seekTo(seconds)
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
          onClick={async () => {
            setShareModalOpen(true); setShareToken(null); setShareCopied(false)
            setSharesLoading(true)
            try {
              const r = await fetch(apiUrl(`/sessions/${name}/shares`))
              if (r.ok) setExistingShares(await r.json())
            } catch { /* ignore */ } finally { setSharesLoading(false) }
          }}
          style={{
            background: 'rgba(96,165,250,0.12)',
            border: '1px solid rgba(96,165,250,0.25)',
            borderRadius: '8px',
            color: '#93c5fd',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          🔗 Share
        </button>

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

      {/* Share modal */}
      {shareModalOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) setShareModalOpen(false) }}
        >
          <div style={{
            background: '#1a1d27', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 14, padding: 28, width: 420, maxWidth: '90vw',
          }}>
            <h3 style={{ margin: '0 0 16px', color: '#e2e8f0', fontSize: 16, fontWeight: 700 }}>
              🔗 Share Session
            </h3>

            {!shareToken ? (
              <>
                <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 16px' }}>
                  Generate a read-only public link. No login required to view.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                  {([
                    ['show_transcript', 'Transcript', shareShowTranscript, setShareShowTranscript],
                    ['show_summary', 'Summary', shareShowSummary, setShareShowSummary],
                    ['show_wiki', 'Wiki', shareShowWiki, setShareShowWiki],
                  ] as const).map(([, label, val, set]) => (
                    <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', color: '#cbd5e1', fontSize: 14 }}>
                      <input
                        type="checkbox"
                        checked={val}
                        onChange={e => (set as (v: boolean) => void)(e.target.checked)}
                        style={{ width: 16, height: 16, accentColor: '#7c6cfc' }}
                      />
                      Include {label}
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShareModalOpen(false)}
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={shareCreating}
                    onClick={async () => {
                      setShareCreating(true)
                      try {
                        const r = await fetch(apiUrl(`/sessions/${name}/shares`), {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ show_transcript: shareShowTranscript, show_summary: shareShowSummary, show_wiki: shareShowWiki }),
                        })
                        if (!r.ok) throw new Error('Failed')
                        const data = await r.json()
                        setShareToken(data.token)
                      } finally {
                        setShareCreating(false)
                      }
                    }}
                    style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#7c6cfc', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13, opacity: shareCreating ? 0.6 : 1 }}
                  >
                    {shareCreating ? 'Creating…' : 'Generate Link'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 12px' }}>Share this link — anyone with it can view the session (no login needed):</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                  <input
                    readOnly
                    value={`${window.location.origin}/share/${shareToken}`}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
                      color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace',
                    }}
                    onClick={e => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/share/${shareToken}`)
                      setShareCopied(true)
                      setTimeout(() => setShareCopied(false), 2000)
                    }}
                    style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: shareCopied ? '#22c55e' : '#7c6cfc', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13, transition: 'background 0.2s' }}
                  >
                    {shareCopied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => { setShareToken(null) }}
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}
                  >
                    ← Create another
                  </button>
                </div>
              </>
            )}

            {/* Existing shares list */}
            {!sharesLoading && existingShares.length > 0 && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 16, paddingTop: 14 }}>
                <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  Active Links
                </div>
                {existingShares.map(s => (
                  <div key={s.token} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{
                      flex: 1, fontSize: 11, fontFamily: 'monospace', color: s.expired ? '#475569' : '#94a3b8',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      textDecoration: s.expired ? 'line-through' : 'none',
                    }}>
                      /share/{s.token}
                    </span>
                    {!s.expired && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/share/${s.token}`)
                        }}
                        style={{ padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 11 }}
                        title="Copy link"
                      >📋</button>
                    )}
                    <button
                      onClick={async () => {
                        await fetch(apiUrl(`/sessions/${name}/shares/${s.token}`), { method: 'DELETE' })
                        setExistingShares(prev => prev.filter(x => x.token !== s.token))
                      }}
                      style={{ padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(248,113,113,0.25)', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 11 }}
                      title="Revoke"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        borderBottom: '1px solid #1e2130',
        flexShrink: 0,
      }}>
      <div style={{ display: 'flex', gap: 0, padding: '0 12px', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid #7c6cfc' : '2px solid transparent',
              color: tab === t.id ? '#a89cff' : '#64748b',
              padding: '12px 14px',
              fontSize: '13px',
              fontWeight: tab === t.id ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {t.label}
          </button>
        ))}
        </div>

        {tab === 'transcript' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderTop: '1px solid #1e2130' }}>
            {!editMode && (
              <>
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
                    flex: 1,
                    minWidth: 0,
                    outline: 'none',
                  }}
                />
                {search && transcript && (() => {
                  const q = search.toLowerCase()
                  const count = transcript.split('\n').filter(l => l.toLowerCase().includes(q)).length
                  return (
                    <span style={{ fontSize: '11px', color: count > 0 ? '#a78bfa' : '#475569', whiteSpace: 'nowrap' }}>
                      {count > 0 ? `${count} match${count !== 1 ? 'es' : ''}` : 'no matches'}
                    </span>
                  )
                })()}
              </>
            )}
            {transcript && (
              <button
                onClick={() => setEditMode(m => !m)}
                style={{
                  background: editMode ? 'rgba(251,191,36,0.15)' : 'transparent',
                  border: `1px solid ${editMode ? 'rgba(251,191,36,0.4)' : '#2a2d3a'}`,
                  borderRadius: '8px',
                  color: editMode ? '#fbbf24' : '#64748b',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {editMode ? 'Exit Edit' : 'Edit Transcript'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Speakers panel — transcript tab only */}
      {tab === 'transcript' && transcript && (
        <SpeakersPanel sessionName={name!} onRename={() => { load(); setChangesLoaded(false); setChangesReport(null) }} />
      )}

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
          {/* Audio label */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', color: '#475569', fontWeight: 700, letterSpacing: '0.08em' }}>
              AUDIO
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>Session recording (merged)</span>
          </div>
          {selectedAudio && (
            <audio
              ref={audioRef}
              key={selectedAudio}
              src={apiUrl(`/sessions/${encodeURIComponent(name!)}/merged-audio`)}
              controls
              onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
              onLoadedMetadata={() => {
                if (pendingSeekRef.current !== null) {
                  seekTo(pendingSeekRef.current)
                  pendingSeekRef.current = null
                }
              }}
              style={{ width: '100%', height: '36px', accentColor: '#7c6cfc' }}
            />
          )}
        </div>
      )}

      {/* Content */}
      <div className="session-content" style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
        {loading ? (
          <div style={{ color: '#64748b' }}>Loading...</div>
        ) : tab === 'transcript' ? (
          transcript ? (
            <TranscriptView
              content={transcript}
              search={search}
              speakerColors={speakerColors}
              currentTime={audioFiles.length > 0 ? currentTime : undefined}
              onSeek={audioFiles.length > 0 ? seekAndSwitch : undefined}
              targetTimestamp={targetTimestamp}
              onTargetReached={() => setTargetTimestamp(null)}
              sessionName={name!}
              editMode={editMode}
              onTranscriptChange={() => { load(); setChangesLoaded(false); setChangesReport(null) }}
            />
          ) : (
            <EmptyTabState
              icon="🎙️"
              title="No transcript yet"
              message="Queue a transcription job to get started. Drop audio files onto the session or use the 🎙️ button on the sessions list."
            />
          )
        ) : tab === 'summary' ? (
          <MarkdownEditView
            content={summary}
            emptyMsg="No summary yet. Run the pipeline to generate one."
            sessionName={name!}
            endpoint="summary"
            onSaved={load}
          />
        ) : tab === 'wiki' ? (
          <WikiView sessionName={name!} wikiMarkdown={wiki} onRemerge={doMerge} onWikiSaved={load} />
        ) : (
          <ChangesView
            report={changesReport}
            loading={changesLoading}
            onHallucinationClick={goToHallucination}
            sessionName={name!}
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
  sessionName,
  editMode,
  onTranscriptChange,
}: {
  content: string | null
  search: string
  speakerColors: Map<string, string>
  currentTime?: number
  onSeek?: (seconds: number, speaker?: string) => void
  targetTimestamp?: string | null
  onTargetReached?: () => void
  sessionName?: string
  editMode?: boolean
  onTranscriptChange?: () => void
}) {
  const apiUrl = useApiUrl()
  const activeLineRef = useRef<HTMLDivElement | null>(null)
  const targetLineRef = useRef<HTMLDivElement | null>(null)
  const [flashTimestamp, setFlashTimestamp] = useState<string | null>(null)
  const { activeCampaign } = useCampaign()
  // Edit mode state
  const [editedLines, setEditedLines] = useState<string[]>([])
  const [editingLineIdx, setEditingLineIdx] = useState<number | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [savingAll, setSavingAll] = useState(false)
  const [savingLine, setSavingLine] = useState(false)
  const [pendingLines, setPendingLines] = useState<Set<number>>(new Set())
  // activeIdx is computed during render; we use a ref to scroll without triggering re-renders


  // Compute parsed lines + activeIdx via useMemo so they're stable for the useEffect below
  const parsedLines = useMemo(() => (content ? parseTranscript(content) : []), [content])
  const searchLower = search.toLowerCase()
  const visibleLines = useMemo(
    () => parsedLines.filter(line => !search || line.raw.toLowerCase().includes(searchLower)),
    [parsedLines, search, searchLower]
  )
  const activeIdx = useMemo(() => {
    if (currentTime === undefined) return -1
    let idx = -1
    for (let i = 0; i < visibleLines.length; i++) {
      const line = visibleLines[i]
      if (line.type === 'speech' && line.timestamp) {
        if (parseTimestampToSeconds(line.timestamp) <= currentTime) idx = i
      }
    }
    return idx
  }, [visibleLines, currentTime])

  // Scroll active line into view (must be at top level — not after an early return)
  useEffect(() => {
    const el = activeLineRef.current
    if (!el) return
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIdx])

  // Initialize editedLines when entering edit mode
  useEffect(() => {
    if (editMode && content) {
      setEditedLines(content.split('\n'))
      setEditingLineIdx(null)
    }
    if (!editMode) {
      setEditingLineIdx(null)
    }
  }, [editMode, content])

  useEffect(() => {
    if (!targetTimestamp) return
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

  const saveLine = async (lineIdx: number, value: string) => {
    if (!sessionName) return
    setSavingLine(true)
    try {
      const r = await fetch(apiUrl(`/sessions/${sessionName}/transcript/line/${lineIdx + 1}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: value }),
      })
      if (r.status === 202) {
        // Pending approval — mark line as pending, don't update local text
        setPendingLines(prev => new Set([...prev, lineIdx]))
      } else {
        setEditedLines(prev => { const next = [...prev]; next[lineIdx] = value; return next })
      }
    } finally {
      setSavingLine(false)
      setEditingLineIdx(null)
    }
  }

  const saveAll = async () => {
    if (!sessionName) return
    setSavingAll(true)
    try {
      await fetch(apiUrl(`/sessions/${sessionName}/transcript`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editedLines.join('\n') }),
      })
      onTranscriptChange?.()
    } finally {
      setSavingAll(false)
    }
  }

  if (!content) {
    return (
      <div style={{ color: '#64748b', textAlign: 'center', paddingTop: '60px' }}>
        No transcript yet. Run the pipeline to generate one.
      </div>
    )
  }

  // ── Edit mode rendering ──────────────────────────────────────────────────
  if (editMode) {
    const displayLines = editedLines.length > 0 ? editedLines : content.split('\n')
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0', maxWidth: '820px' }}>
        {/* Warning banner */}
        <div style={{
          background: 'rgba(251,191,36,0.1)',
          border: '1px solid rgba(251,191,36,0.3)',
          borderRadius: '8px',
          padding: '10px 14px',
          marginBottom: '12px',
          fontSize: '12px',
          color: '#fbbf24',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <span>
            {activeCampaign && activeCampaign.role !== 'dm' && activeCampaign.settings?.require_edit_approval
              ? 'Edit mode — changes will be submitted for DM review before being applied.'
              : 'Edit mode — changes write directly to transcript.md. Re-merging will overwrite manual edits.'}
          </span>
          <button
            onClick={saveAll}
            disabled={savingAll}
            style={{
              background: savingAll ? '#2a2d3a' : 'rgba(251,191,36,0.2)',
              border: '1px solid rgba(251,191,36,0.4)',
              borderRadius: '6px',
              color: savingAll ? '#64748b' : '#fbbf24',
              padding: '5px 14px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: savingAll ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {savingAll ? 'Saving...' : 'Save All'}
          </button>
        </div>

        {displayLines.map((rawLine, lineIdx) => {
          const m = rawLine.match(/^\*\*\[([^\]]+)\] ([^:]+):\*\* (.*)$/)
          const isEditing = editingLineIdx === lineIdx
          const isPending = pendingLines.has(lineIdx)

          return (
            <div
              key={lineIdx}
              style={{
                display: 'flex',
                gap: '8px',
                padding: '3px 6px',
                alignItems: 'flex-start',
                borderRadius: '6px',
                background: isEditing ? 'rgba(251,191,36,0.08)' : isPending ? 'rgba(251,191,36,0.05)' : 'transparent',
              }}
            >
              {/* Line number */}
              <span style={{
                fontSize: '10px',
                color: '#2a2d3a',
                fontFamily: 'monospace',
                flexShrink: 0,
                width: '36px',
                textAlign: 'right',
                paddingTop: '3px',
                userSelect: 'none',
              }}>
                {lineIdx + 1}
              </span>

              {isEditing ? (
                <input
                  autoFocus
                  value={editingValue}
                  onChange={e => setEditingValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { saveLine(lineIdx, editingValue) }
                    else if (e.key === 'Escape') { setEditingLineIdx(null) }
                  }}
                  onBlur={() => saveLine(lineIdx, editingValue)}
                  disabled={savingLine}
                  style={{
                    flex: 1,
                    background: '#13151f',
                    border: '1px solid rgba(251,191,36,0.4)',
                    borderRadius: '4px',
                    color: '#e2e8f0',
                    padding: '2px 8px',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                />
              ) : m ? (
                <div
                  onClick={() => { setEditingLineIdx(lineIdx); setEditingValue(rawLine) }}
                  title="Click to edit"
                  style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'flex-start',
                    flex: 1,
                    cursor: 'text',
                    borderRadius: '4px',
                    padding: '2px 4px',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: '11px', color: '#475569', fontFamily: 'monospace', paddingTop: '2px', flexShrink: 0, width: '48px', textAlign: 'right' }}>
                    {m[1]}
                  </span>
                  <span style={{ background: `${getSpeakerColor(m[2].trim(), speakerColors)}20`, color: getSpeakerColor(m[2].trim(), speakerColors), borderRadius: '4px', padding: '1px 8px', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>
                    {m[2].trim()}
                  </span>
                  <span style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.6 }}>{m[3]}</span>
                </div>
              ) : rawLine.startsWith('#') ? (
                <div
                  onClick={() => { setEditingLineIdx(lineIdx); setEditingValue(rawLine) }}
                  style={{ flex: 1, cursor: 'text', fontSize: '14px', fontWeight: 700, color: '#e2e8f0', paddingTop: '2px' }}
                >
                  {rawLine.replace(/^#+\s*/, '')}
                </div>
              ) : rawLine.trim() === '' ? (
                <div style={{ flex: 1, height: '8px' }} />
              ) : (
                <div
                  onClick={() => { setEditingLineIdx(lineIdx); setEditingValue(rawLine) }}
                  style={{ flex: 1, cursor: 'text', fontSize: '12px', color: '#64748b', paddingTop: '2px' }}
                >
                  {rawLine || '\u00a0'}
                </div>
              )}
              {isPending && (
                <span style={{
                  flexShrink: 0, alignSelf: 'center',
                  fontSize: '10px', fontWeight: 600,
                  color: '#fbbf24', background: 'rgba(251,191,36,0.12)',
                  border: '1px solid rgba(251,191,36,0.3)',
                  borderRadius: '4px', padding: '1px 7px', whiteSpace: 'nowrap',
                }}>
                  Submitted for review
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Read mode rendering ──────────────────────────────────────────────────
  // (parsedLines, visibleLines, activeIdx are computed via useMemo above)
  const visible = visibleLines

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
          const color = line.speaker ? getSpeakerColor(line.speaker, speakerColors) : '#64748b'
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
                  onClick={() => onSeek(tsSeconds, line.speaker)}
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
              {/* Speaker chip — only shown when speaker is known */}
              {line.speaker && (
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
              )}
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
    <div style={{ maxWidth: '820px', color: '#cbd5e1', fontSize: '14px', lineHeight: 1.7 }}>
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

function MarkdownEditView({
  content,
  emptyMsg,
  sessionName,
  endpoint,
  onSaved,
}: {
  content: string | null
  emptyMsg: string
  sessionName: string
  endpoint: 'summary' | 'wiki'
  onSaved?: () => void
}) {
  const apiUrl = useApiUrl()
  const { authEnabled } = useAuth()
  const { activeCampaign } = useCampaign()
  const { toast } = useToast()
  const [editMode, setEditMode] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingApproval, setPendingApproval] = useState(false)

  const isDm = !authEnabled || activeCampaign?.role === 'dm'
  const requiresApproval = authEnabled && !isDm && activeCampaign?.settings?.require_edit_approval

  const enterEdit = () => {
    setEditValue(content ?? '')
    setPendingApproval(false)
    setEditMode(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const r = await fetch(apiUrl(`/sessions/${sessionName}/${endpoint}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editValue }),
      })
      if (r.status === 202) {
        setPendingApproval(true)
        setEditMode(false)
      } else if (r.ok) {
        setEditMode(false)
        onSaved?.()
      } else {
        const data = await r.json().catch(() => ({}))
        toast(`Failed to save: ${data.detail || r.status}`, 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  if (!content && !editMode) {
    return (
      <div style={{ color: '#64748b', textAlign: 'center', paddingTop: '60px' }}>
        {emptyMsg}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '820px' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        {pendingApproval && (
          <span style={{
            fontSize: '11px', fontWeight: 600, color: '#fbbf24',
            background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)',
            borderRadius: '6px', padding: '3px 10px',
          }}>
            Submitted for DM review
          </span>
        )}
        <div style={{ flex: 1 }} />
        {!editMode ? (
          <button
            onClick={enterEdit}
            style={{
              background: 'transparent', border: '1px solid #2a2d3a', borderRadius: '8px',
              color: '#64748b', padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            ✏️ Edit {endpoint === 'summary' ? 'Summary' : 'Wiki'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: requiresApproval ? '#fbbf24' : '#64748b', alignSelf: 'center' }}>
              {requiresApproval ? 'Changes will be submitted for DM review' : 'Changes save directly'}
            </span>
            <button
              onClick={() => setEditMode(false)}
              style={{
                background: 'transparent', border: '1px solid #2a2d3a', borderRadius: '6px',
                color: '#64748b', padding: '5px 12px', fontSize: '12px', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              style={{
                background: requiresApproval ? 'rgba(251,191,36,0.15)' : 'rgba(52,211,153,0.15)',
                border: `1px solid ${requiresApproval ? 'rgba(251,191,36,0.4)' : 'rgba(52,211,153,0.4)'}`,
                borderRadius: '6px',
                color: requiresApproval ? '#fbbf24' : '#34d399',
                padding: '5px 14px', fontSize: '12px', fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : requiresApproval ? 'Submit for Review' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {editMode ? (
        <textarea
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          style={{
            width: '100%', minHeight: '500px', background: '#13151f',
            border: '1px solid rgba(251,191,36,0.3)', borderRadius: '8px',
            color: '#e2e8f0', padding: '16px', fontSize: '13px',
            fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
      ) : (
        <MarkdownView content={content} emptyMsg={emptyMsg} />
      )}
    </div>
  )
}

// ─── Word-level diff helpers ──────────────────────────────────────────────────

interface WordDiffPart {
  word: string
  changed: boolean
}

function computeWordDiff(rawLine: string, corrLine: string): { raw: WordDiffPart[]; corr: WordDiffPart[] } {
  const tokenize = (s: string) => s.split(/(\s+)/).filter(t => t.length > 0)
  const rawTokens = tokenize(rawLine)
  const corrTokens = tokenize(corrLine)
  const m = rawTokens.length
  const n = corrTokens.length

  // LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      if (rawTokens[i - 1] === corrTokens[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])

  // Backtrack
  type Op = { type: 'same' | 'removed' | 'added'; value: string }
  const ops: Op[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && rawTokens[i - 1] === corrTokens[j - 1]) {
      ops.unshift({ type: 'same', value: rawTokens[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'added', value: corrTokens[j - 1] })
      j--
    } else {
      ops.unshift({ type: 'removed', value: rawTokens[i - 1] })
      i--
    }
  }

  const rawParts: WordDiffPart[] = []
  const corrParts: WordDiffPart[] = []
  for (const op of ops) {
    if (op.type === 'same') {
      rawParts.push({ word: op.value, changed: false })
      corrParts.push({ word: op.value, changed: false })
    } else if (op.type === 'removed') {
      rawParts.push({ word: op.value, changed: true })
    } else {
      corrParts.push({ word: op.value, changed: true })
    }
  }
  return { raw: rawParts, corr: corrParts }
}

// ─── DiffViewer ───────────────────────────────────────────────────────────────

type DisplayItem =
  | { type: 'line'; lineNum: number; rawParts: WordDiffPart[]; corrParts: WordDiffPart[]; hasChanges: boolean }
  | { type: 'separator'; skipped: number }

function DiffViewer({ sessionName }: { sessionName: string }) {
  const apiUrl = useApiUrl()
  const [showDiff, setShowDiff] = useState(false)
  const [changedLinesOnly, setChangedLinesOnly] = useState(false)
  const [rawContent, setRawContent] = useState<string | null>(null)
  const [corrContent, setCorrContent] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const scrollingRef = useRef(false)

  const loadDiff = async () => {
    if (rawContent !== null) return
    setDiffLoading(true)
    try {
      const [rawRes, corrRes] = await Promise.allSettled([
        fetch(apiUrl(`/sessions/${sessionName}/raw-transcript`)).then(r => r.ok ? r.json() : null),
        fetch(apiUrl(`/sessions/${sessionName}/transcript`)).then(r => r.ok ? r.json() : null),
      ])
      setRawContent(rawRes.status === 'fulfilled' && rawRes.value ? rawRes.value.content : '')
      setCorrContent(corrRes.status === 'fulfilled' && corrRes.value ? corrRes.value.content : '')
    } finally {
      setDiffLoading(false)
    }
  }

  const handleToggle = () => {
    const next = !showDiff
    setShowDiff(next)
    if (next) loadDiff()
  }

  const syncScroll = (from: 'left' | 'right') => {
    if (scrollingRef.current) return
    scrollingRef.current = true
    if (from === 'left' && rightRef.current && leftRef.current) {
      rightRef.current.scrollTop = leftRef.current.scrollTop
    } else if (from === 'right' && leftRef.current && rightRef.current) {
      leftRef.current.scrollTop = rightRef.current.scrollTop
    }
    requestAnimationFrame(() => { scrollingRef.current = false })
  }

  // Build diff pairs
  const rawLines = rawContent != null ? rawContent.split('\n') : []
  const corrLines = corrContent != null ? corrContent.split('\n') : []
  const totalLines = Math.max(rawLines.length, corrLines.length)

  type LinePair = {
    lineNum: number
    rawLine: string
    corrLine: string
    hasChanges: boolean
    rawParts: WordDiffPart[]
    corrParts: WordDiffPart[]
  }

  const pairs: LinePair[] = []
  if (rawContent != null && corrContent != null) {
    for (let i = 0; i < totalLines; i++) {
      const rawLine = rawLines[i] ?? ''
      const corrLine = corrLines[i] ?? ''
      const hasChanges = rawLine !== corrLine
      const { raw, corr } = hasChanges
        ? computeWordDiff(rawLine, corrLine)
        : { raw: [{ word: rawLine, changed: false }], corr: [{ word: corrLine, changed: false }] }
      pairs.push({ lineNum: i + 1, rawLine, corrLine, hasChanges, rawParts: raw, corrParts: corr })
    }
  }

  const changedCount = pairs.filter(p => p.hasChanges).length

  const displayItems: DisplayItem[] = (() => {
    if (!changedLinesOnly) return pairs.map(p => ({ type: 'line' as const, lineNum: p.lineNum, rawParts: p.rawParts, corrParts: p.corrParts, hasChanges: p.hasChanges }))
    const items: DisplayItem[] = []
    let lastLineNum = -999
    for (const p of pairs) {
      if (!p.hasChanges) continue
      if (items.length > 0 && p.lineNum > lastLineNum + 1) {
        items.push({ type: 'separator', skipped: p.lineNum - lastLineNum - 1 })
      }
      items.push({ type: 'line', lineNum: p.lineNum, rawParts: p.rawParts, corrParts: p.corrParts, hasChanges: p.hasChanges })
      lastLineNum = p.lineNum
    }
    return items
  })()

  const panelStyle: React.CSSProperties = {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  }

  const scrollAreaStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'auto',
    fontFamily: 'monospace',
    fontSize: '12px',
    lineHeight: '1.6',
  }

  const renderWords = (parts: WordDiffPart[], side: 'raw' | 'corr') => {
    const highlightBg = side === 'raw' ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.25)'
    const highlightColor = side === 'raw' ? '#fca5a5' : '#86efac'
    return parts.map((p, i) =>
      p.changed ? (
        <mark key={i} style={{ background: highlightBg, color: highlightColor, borderRadius: '2px', padding: '0 1px' }}>
          {p.word}
        </mark>
      ) : (
        <span key={i}>{p.word}</span>
      )
    )
  }

  return (
    <div style={{ marginBottom: '8px' }}>
      {/* Toggle button + controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: showDiff ? '10px' : '0' }}>
        <button
          onClick={handleToggle}
          style={{
            background: showDiff ? 'rgba(124,108,252,0.2)' : 'rgba(30,33,48,0.8)',
            border: `1px solid ${showDiff ? 'rgba(124,108,252,0.5)' : '#2a2d3a'}`,
            borderRadius: '8px',
            color: showDiff ? '#a89cff' : '#64748b',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {showDiff ? 'Hide Diff' : 'Show Diff'}
        </button>

        {showDiff && rawContent != null && (
          <>
            <span style={{ fontSize: '12px', color: '#475569' }}>
              <span style={{ color: changedCount > 0 ? '#a89cff' : '#475569', fontWeight: 700 }}>{changedCount}</span>
              {' '}line{changedCount !== 1 ? 's' : ''} changed out of{' '}
              <span style={{ fontWeight: 700, color: '#94a3b8' }}>{totalLines}</span> total
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94a3b8', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={changedLinesOnly}
                onChange={e => setChangedLinesOnly(e.target.checked)}
                style={{ accentColor: '#7c6cfc' }}
              />
              Changed lines only
            </label>
          </>
        )}
      </div>

      {/* Diff panels */}
      {showDiff && (
        <div style={{
          border: '1px solid #1e2130',
          borderRadius: '10px',
          overflow: 'hidden',
          height: '400px',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {diffLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#64748b', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>⟳</span> Loading diff...
            </div>
          ) : rawContent == null ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#64748b' }}>
              No transcript data available.
            </div>
          ) : (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Left panel — Raw */}
              <div style={panelStyle}>
                <div style={{
                  padding: '6px 10px',
                  background: 'rgba(239,68,68,0.08)',
                  borderBottom: '1px solid rgba(239,68,68,0.2)',
                  borderRight: '1px solid #1e2130',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#fca5a5',
                  letterSpacing: '0.06em',
                  flexShrink: 0,
                }}>
                  RAW (WHISPER OUTPUT)
                </div>
                <div
                  ref={leftRef}
                  onScroll={() => syncScroll('left')}
                  style={{ ...scrollAreaStyle, borderRight: '1px solid #1e2130', background: 'rgba(239,68,68,0.02)' }}
                >
                  {displayItems.map((item, idx) =>
                    item.type === 'separator' ? (
                      <div key={idx} style={{ padding: '2px 8px', color: '#475569', fontSize: '11px', background: '#0d1017', borderTop: '1px solid #1e2130', borderBottom: '1px solid #1e2130' }}>
                        ···  {item.skipped} line{item.skipped !== 1 ? 's' : ''} hidden
                      </div>
                    ) : (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          gap: '0',
                          padding: '0 8px',
                          background: item.hasChanges ? 'rgba(239,68,68,0.07)' : 'transparent',
                          opacity: item.hasChanges ? 1 : 0.45,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        <span style={{ color: '#374151', minWidth: '36px', userSelect: 'none', paddingRight: '8px', textAlign: 'right', flexShrink: 0 }}>
                          {item.lineNum}
                        </span>
                        <span style={{ color: '#e2e8f0' }}>
                          {renderWords(item.rawParts, 'raw')}
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>

              {/* Right panel — Corrected */}
              <div style={panelStyle}>
                <div style={{
                  padding: '6px 10px',
                  background: 'rgba(34,197,94,0.08)',
                  borderBottom: '1px solid rgba(34,197,94,0.2)',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#86efac',
                  letterSpacing: '0.06em',
                  flexShrink: 0,
                }}>
                  CORRECTED
                </div>
                <div
                  ref={rightRef}
                  onScroll={() => syncScroll('right')}
                  style={{ ...scrollAreaStyle, background: 'rgba(34,197,94,0.02)' }}
                >
                  {displayItems.map((item, idx) =>
                    item.type === 'separator' ? (
                      <div key={idx} style={{ padding: '2px 8px', color: '#475569', fontSize: '11px', background: '#0d1017', borderTop: '1px solid #1e2130', borderBottom: '1px solid #1e2130' }}>
                        ···  {item.skipped} line{item.skipped !== 1 ? 's' : ''} hidden
                      </div>
                    ) : (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          gap: '0',
                          padding: '0 8px',
                          background: item.hasChanges ? 'rgba(34,197,94,0.07)' : 'transparent',
                          opacity: item.hasChanges ? 1 : 0.45,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        <span style={{ color: '#374151', minWidth: '36px', userSelect: 'none', paddingRight: '8px', textAlign: 'right', flexShrink: 0 }}>
                          {item.lineNum}
                        </span>
                        <span style={{ color: '#e2e8f0' }}>
                          {renderWords(item.corrParts, 'corr')}
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
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

// ─── Speakers panel ───────────────────────────────────────────────────────────

function SpeakersPanel({ sessionName, onRename }: { sessionName: string; onRename: () => void }) {
  const apiUrl = useApiUrl()
  const [open, setOpen] = useState(false)
  const [speakers, setSpeakers] = useState<Array<{ name: string; line_count: number }>>([])
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameResult, setRenameResult] = useState<string | null>(null)

  const loadSpeakers = async () => {
    try {
      const r = await fetch(apiUrl(`/sessions/${sessionName}/speakers`))
      if (r.ok) setSpeakers((await r.json()).speakers)
    } catch (_) {}
  }

  useEffect(() => { loadSpeakers() }, [sessionName])

  const doRename = async (oldName: string) => {
    if (!newName.trim() || newName.trim() === oldName) { setEditingSpeaker(null); return }
    setRenaming(true)
    setRenameResult(null)
    try {
      const r = await fetch(apiUrl(`/sessions/${sessionName}/rename-speaker`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_name: oldName, new_name: newName.trim() }),
      })
      if (r.ok) {
        const data = await r.json()
        setRenameResult(`Renamed ${data.replacements} occurrence${data.replacements !== 1 ? 's' : ''}`)
        setEditingSpeaker(null)
        setNewName('')
        onRename()
        loadSpeakers()
      }
    } finally {
      setRenaming(false)
    }
  }

  return (
    <div style={{ borderBottom: '1px solid #1e2130', background: '#080a10', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 28px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '10px', color: '#475569', fontWeight: 700, letterSpacing: '0.08em' }}>SPEAKERS</span>
        <span style={{ fontSize: '10px', color: '#475569' }}>{open ? '▼' : '▶'}</span>
        {speakers.length > 0 && (
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            {speakers.length} speaker{speakers.length !== 1 ? 's' : ''}
          </span>
        )}
        {renameResult && <span style={{ fontSize: '11px', color: '#34d399', marginLeft: '8px' }}>{renameResult}</span>}
      </button>

      {open && (
        <div style={{ padding: '0 28px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{
            fontSize: '11px',
            color: '#fbbf24',
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.2)',
            borderRadius: '6px',
            padding: '6px 10px',
            marginBottom: '4px',
          }}>
            This edits transcript.md directly — re-merging will overwrite speaker names.
          </div>
          {speakers.map(s => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: getSpeakerColor(s.name, new Map()), fontWeight: 600, minWidth: '160px' }}>
                {s.name}
              </span>
              <span style={{ fontSize: '11px', color: '#475569' }}>{s.line_count} line{s.line_count !== 1 ? 's' : ''}</span>
              {editingSpeaker === s.name ? (
                <>
                  <input
                    autoFocus
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') doRename(s.name)
                      else if (e.key === 'Escape') { setEditingSpeaker(null); setNewName('') }
                    }}
                    placeholder="New name"
                    style={{
                      background: '#13151f',
                      border: '1px solid #2a2d3a',
                      borderRadius: '6px',
                      color: '#e2e8f0',
                      padding: '4px 8px',
                      fontSize: '12px',
                      outline: 'none',
                      width: '160px',
                    }}
                  />
                  <button
                    onClick={() => doRename(s.name)}
                    disabled={renaming}
                    style={{ background: 'rgba(124,108,252,0.2)', border: '1px solid rgba(124,108,252,0.3)', borderRadius: '6px', color: '#a89cff', padding: '4px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {renaming ? '...' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setEditingSpeaker(null); setNewName('') }}
                    style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '13px' }}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setEditingSpeaker(s.name); setNewName(s.name); setRenameResult(null) }}
                  style={{ background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '13px', opacity: 0.7 }}
                  title="Rename speaker"
                >
                  ✏️
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Wiki tab ─────────────────────────────────────────────────────────────────

function WikiView({ sessionName, wikiMarkdown, onRemerge, onWikiSaved }: { sessionName: string; wikiMarkdown: string | null; onRemerge?: () => void; onWikiSaved?: () => void }) {
  const apiUrl = useApiUrl()
  const { authEnabled } = useAuth()
  const { activeCampaign } = useCampaign()
  const { toast } = useToast()
  const [wikiEditMode, setWikiEditMode] = useState(false)
  const [wikiEditValue, setWikiEditValue] = useState('')
  const [wikiSaving, setWikiSaving] = useState(false)
  const [wikiPending, setWikiPending] = useState(false)
  const [suggestions, setSuggestions] = useState<WikiSuggestion[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [appliedIds, setAppliedIds] = useState<Set<number>>(new Set())
  const [skippedIds, setSkippedIds] = useState<Set<number>>(new Set())
  const [applying, setApplying] = useState(false)
  const [applyOutput, setApplyOutput] = useState<string | null>(null)
  // Import corrections
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: Array<{from: string; to: string}>; skipped: Array<{from: string; to: string}> } | null>(null)

  const hasProperNounCorrections = wikiMarkdown?.includes('Proper Noun Corrections') ?? false

  const doImportCorrections = async () => {
    setImporting(true)
    setImportResult(null)
    try {
      const r = await fetch(apiUrl(`/sessions/${sessionName}/import-corrections`), { method: 'POST' })
      if (r.ok) setImportResult(await r.json())
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => {
    const fetchSuggestions = async () => {
      setLoading(true)
      try {
        const r = await fetch(apiUrl(`/sessions/${sessionName}/wiki-suggestions-parsed`))
        setSuggestions(r.ok ? await r.json() : null)
      } catch (_) {
        setSuggestions(null)
      } finally {
        setLoading(false)
      }
    }
    fetchSuggestions()
  }, [sessionName])

  const callApplyWiki = async (mode: 'all' | 'apply' | 'skip', ids: number[]) => {
    setApplying(true)
    setApplyOutput(null)
    try {
      const r = await fetch(apiUrl(`/sessions/${sessionName}/apply-wiki`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, ids }),
      })
      const data = await r.json()
      setApplyOutput(data.output || '')
      if (mode === 'all') {
        setAppliedIds(new Set(suggestions?.filter(s => !skippedIds.has(s.id)).map(s => s.id) ?? []))
      } else if (mode === 'apply') {
        setAppliedIds(prev => new Set([...prev, ...ids]))
      } else if (mode === 'skip') {
        // applied all except skipped
        setAppliedIds(new Set(suggestions?.filter(s => !skippedIds.has(s.id)).map(s => s.id) ?? []))
      }
    } finally {
      setApplying(false)
    }
  }

  const toggleSkip = (id: number) => {
    setSkippedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const isDm = !authEnabled || activeCampaign?.role === 'dm'
  const requiresApproval = authEnabled && !isDm && activeCampaign?.settings?.require_edit_approval

  const saveWikiEdit = async () => {
    setWikiSaving(true)
    try {
      const r = await fetch(apiUrl(`/sessions/${sessionName}/wiki`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: wikiEditValue }),
      })
      if (r.status === 202) {
        setWikiPending(true)
        setWikiEditMode(false)
      } else if (r.ok) {
        setWikiEditMode(false)
        onWikiSaved?.()
      } else {
        const data = await r.json().catch(() => ({}))
        toast(`Failed to save: ${data.detail || r.status}`, 'error')
      }
    } finally {
      setWikiSaving(false)
    }
  }

  // Wiki edit toolbar (shown above both the suggestions panel and the markdown fallback)
  const wikiEditToolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
      {wikiPending && (
        <span style={{
          fontSize: '11px', fontWeight: 600, color: '#fbbf24',
          background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)',
          borderRadius: '6px', padding: '3px 10px',
        }}>
          Submitted for DM review
        </span>
      )}
      <div style={{ flex: 1 }} />
      {!wikiEditMode ? (
        <button
          onClick={() => { setWikiEditValue(wikiMarkdown ?? ''); setWikiPending(false); setWikiEditMode(true) }}
          style={{
            background: 'transparent', border: '1px solid #2a2d3a', borderRadius: '8px',
            color: '#64748b', padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          }}
        >
          ✏️ Edit Wiki
        </button>
      ) : (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: requiresApproval ? '#fbbf24' : '#64748b' }}>
            {requiresApproval ? 'Will submit for DM review' : 'Saves directly'}
          </span>
          <button onClick={() => setWikiEditMode(false)} style={{ background: 'transparent', border: '1px solid #2a2d3a', borderRadius: '6px', color: '#64748b', padding: '5px 12px', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
          <button
            onClick={saveWikiEdit}
            disabled={wikiSaving}
            style={{
              background: requiresApproval ? 'rgba(251,191,36,0.15)' : 'rgba(52,211,153,0.15)',
              border: `1px solid ${requiresApproval ? 'rgba(251,191,36,0.4)' : 'rgba(52,211,153,0.4)'}`,
              borderRadius: '6px', color: requiresApproval ? '#fbbf24' : '#34d399',
              padding: '5px 14px', fontSize: '12px', fontWeight: 700,
              cursor: wikiSaving ? 'not-allowed' : 'pointer', opacity: wikiSaving ? 0.6 : 1,
            }}
          >
            {wikiSaving ? 'Saving…' : requiresApproval ? 'Submit for Review' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )

  if (loading) {
    return <div style={{ color: '#64748b', paddingTop: '60px', textAlign: 'center' }}>Loading wiki suggestions...</div>
  }

  if (!suggestions || suggestions.length === 0) {
    return (
      <div style={{ maxWidth: '820px' }}>
        {wikiEditToolbar}
        {wikiEditMode ? (
          <textarea
            value={wikiEditValue}
            onChange={e => setWikiEditValue(e.target.value)}
            style={{
              width: '100%', minHeight: '500px', background: '#13151f',
              border: '1px solid rgba(251,191,36,0.3)', borderRadius: '8px',
              color: '#e2e8f0', padding: '16px', fontSize: '13px',
              fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        ) : (
          <MarkdownView content={wikiMarkdown} emptyMsg="No wiki suggestions yet. Run the pipeline to generate them." />
        )}
      </div>
    )
  }

  const unappliedCount = suggestions.filter(s => !appliedIds.has(s.id) && !skippedIds.has(s.id)).length

  return (
    <div style={{ maxWidth: '820px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {wikiEditToolbar}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => callApplyWiki('all', [])}
          disabled={applying}
          style={{
            background: 'rgba(52,211,153,0.15)',
            border: '1px solid rgba(52,211,153,0.3)',
            borderRadius: '8px',
            color: '#34d399',
            padding: '7px 16px',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            opacity: applying ? 0.5 : 1,
          }}
        >
          Apply All
        </button>
        {skippedIds.size > 0 && (
          <button
            onClick={() => callApplyWiki('skip', [...skippedIds])}
            disabled={applying}
            style={{
              background: 'rgba(124,108,252,0.15)',
              border: '1px solid rgba(124,108,252,0.3)',
              borderRadius: '8px',
              color: '#a89cff',
              padding: '7px 16px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              opacity: applying ? 0.5 : 1,
            }}
          >
            Apply Selected ({unappliedCount} of {suggestions.length})
          </button>
        )}
        {applying && (
          <span style={{ fontSize: '12px', color: '#64748b' }}>Applying...</span>
        )}
        <span style={{ fontSize: '12px', color: '#475569', marginLeft: 'auto' }}>
          {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''}
          {appliedIds.size > 0 && <span style={{ color: '#34d399' }}> · {appliedIds.size} applied</span>}
          {skippedIds.size > 0 && <span style={{ color: '#64748b' }}> · {skippedIds.size} skipped</span>}
        </span>
      </div>

      {/* Import corrections section */}
      {hasProperNounCorrections && (
        <div style={{
          background: '#0d1017',
          border: '1px solid #1e2130',
          borderRadius: '10px',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Proper Noun Corrections
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            This wiki suggestion contains a "Proper Noun Corrections" section. Import the corrections into config.yaml.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={doImportCorrections}
              disabled={importing}
              style={{
                background: 'rgba(124,108,252,0.15)',
                border: '1px solid rgba(124,108,252,0.3)',
                borderRadius: '8px',
                color: '#a89cff',
                padding: '7px 16px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: importing ? 'not-allowed' : 'pointer',
                opacity: importing ? 0.5 : 1,
              }}
            >
              {importing ? 'Importing...' : 'Import Corrections'}
            </button>
            {importResult && (
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                {importResult.imported.length > 0 && (
                  <span style={{ color: '#4ade80' }}>Imported {importResult.imported.length}</span>
                )}
                {importResult.imported.length > 0 && importResult.skipped.length > 0 && <span style={{ color: '#475569' }}>, </span>}
                {importResult.skipped.length > 0 && (
                  <span style={{ color: '#64748b' }}>{importResult.skipped.length} already existed</span>
                )}
                {importResult.imported.length === 0 && importResult.skipped.length === 0 && (
                  <span style={{ color: '#64748b' }}>No corrections found</span>
                )}
              </span>
            )}
            {importResult && importResult.imported.length > 0 && onRemerge && (
              <button
                onClick={onRemerge}
                style={{
                  background: 'rgba(52,211,153,0.12)',
                  border: '1px solid rgba(52,211,153,0.25)',
                  borderRadius: '8px',
                  color: '#34d399',
                  padding: '7px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Re-merge session
              </button>
            )}
          </div>
        </div>
      )}

      {/* Apply output */}
      {applyOutput && (
        <pre style={{
          background: '#0a0d14',
          border: '1px solid #1e2130',
          borderRadius: '8px',
          padding: '12px 16px',
          fontSize: '11px',
          color: '#94a3b8',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          overflowX: 'auto',
          maxHeight: '200px',
          overflowY: 'auto',
        }}>
          {applyOutput}
        </pre>
      )}

      {/* Suggestion cards */}
      {suggestions.map(s => {
        const isApplied = appliedIds.has(s.id)
        const isSkipped = skippedIds.has(s.id)
        return (
          <div
            key={s.id}
            style={{
              border: `1px solid ${isApplied ? 'rgba(52,211,153,0.3)' : '#1e2130'}`,
              borderRadius: '10px',
              background: isApplied ? 'rgba(52,211,153,0.05)' : '#0d1017',
              overflow: 'hidden',
              opacity: isSkipped ? 0.45 : 1,
              transition: 'opacity 0.2s, border-color 0.2s',
            }}
          >
            {/* Card header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px' }}>
              <span style={{
                background: '#1a1d27',
                border: '1px solid #2a2d3a',
                borderRadius: '6px',
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: 700,
                color: '#475569',
                flexShrink: 0,
              }}>
                #{s.id}
              </span>
              <span style={{
                fontSize: '14px',
                fontWeight: 600,
                color: isSkipped ? '#475569' : '#e2e8f0',
                flex: 1,
                textDecoration: isSkipped ? 'line-through' : 'none',
              }}>
                {s.title}
              </span>
              <span style={{
                background: 'rgba(124,108,252,0.12)',
                border: '1px solid rgba(124,108,252,0.25)',
                color: '#a78bfa',
                borderRadius: '999px',
                padding: '2px 10px',
                fontSize: '11px',
                flexShrink: 0,
              }}>
                {s.section}
              </span>
            </div>

            {/* Page path */}
            {s.page && (
              <div style={{ padding: '0 16px 8px', fontSize: '11px', color: '#475569', fontFamily: 'monospace' }}>
                {s.page}
              </div>
            )}

            {/* Bullets */}
            <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {s.bullets.map((b, i) => (
                <div key={i} style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.6 }}>
                  {b}
                </div>
              ))}
            </div>

            {/* Card actions */}
            <div style={{
              display: 'flex',
              gap: '8px',
              padding: '8px 16px',
              borderTop: '1px solid #1e2130',
              background: 'rgba(0,0,0,0.2)',
              alignItems: 'center',
            }}>
              {isApplied ? (
                <span style={{ color: '#34d399', fontSize: '12px', fontWeight: 700 }}>✓ Applied</span>
              ) : (
                <>
                  <button
                    onClick={() => callApplyWiki('apply', [s.id])}
                    disabled={applying || isSkipped}
                    style={{
                      background: 'rgba(52,211,153,0.12)',
                      border: '1px solid rgba(52,211,153,0.25)',
                      borderRadius: '6px',
                      color: '#34d399',
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: applying || isSkipped ? 'not-allowed' : 'pointer',
                      opacity: applying || isSkipped ? 0.5 : 1,
                    }}
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => toggleSkip(s.id)}
                    disabled={applying}
                    style={{
                      background: isSkipped ? 'rgba(100,116,139,0.15)' : 'transparent',
                      border: `1px solid ${isSkipped ? '#475569' : '#2a2d3a'}`,
                      borderRadius: '6px',
                      color: isSkipped ? '#94a3b8' : '#475569',
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: applying ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isSkipped ? 'Undo Skip' : 'Skip'}
                  </button>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ChangesView({
  report,
  loading,
  onHallucinationClick,
  sessionName,
}: {
  report: ChangesReport | null
  loading: boolean
  onHallucinationClick: (timestamp: string) => void
  sessionName: string
}) {
  const corrections_applied = report?.corrections_applied ?? []
  const patterns_applied = report?.patterns_applied ?? []
  const hallucinations = report?.hallucinations ?? []
  const stats = report?.stats ?? { total_corrections: 0, total_hits: 0, hallucination_count: 0 }

  return (
    <div style={{ maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* Diff viewer */}
      <DiffViewer sessionName={sessionName} />

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#64748b', paddingTop: '20px', justifyContent: 'center' }}>
          <span style={{ fontSize: '18px', animation: 'spin 1s linear infinite' }}>⟳</span>
          Analyzing corrections...
        </div>
      )}

      {!loading && !report && (
        <div style={{ color: '#64748b', textAlign: 'center', paddingTop: '20px' }}>
          No transcript yet. Run the pipeline to generate one.
        </div>
      )}

      {!loading && report && (
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
      )}
    </div>
  )
}

function EmptyTabState({ icon, title, message }: { icon: string; title: string; message: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240, textAlign: 'center', padding: '32px' }}>
      <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.5 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#475569', maxWidth: 360, lineHeight: 1.6 }}>{message}</div>
    </div>
  )
}
