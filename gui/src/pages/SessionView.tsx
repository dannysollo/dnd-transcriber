import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Chevron, CloseIcon, CopyIcon, PauseIcon, PlayIcon, QuoteIcon, SpinnerIcon } from '../Icons'
import { useParams, useNavigate } from 'react-router-dom'
import { useApiUrl, useCampaign } from '../CampaignContext'
import { useAuth } from '../AuthContext'
import { useToast } from '../Toast'
import { RuleSuggestionBar, type SessionRuleSuggestion, addCorrectionRule } from '../RuleSuggestions'
import ReactMarkdown from 'react-markdown'
import { BarList } from '../Charts'
import { formatDuration, percent } from '../chartFormat'


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
  lineIdx: number
  timestamp?: string
  speaker?: string
  text?: string
}

function parseTranscript(md: string): ParsedLine[] {
  const lines: ParsedLine[] = []
  let idx = 0
  for (const raw of md.split('\n')) {
    const lineIdx = idx++
    // Match: **[00:00] Speaker Name:** text  (with speaker)
    const m = raw.match(/^\*\*\[([^\]]+)\] ([^:]+):\*\* (.*)$/)
    if (m) {
      lines.push({ type: 'speech', raw, lineIdx, timestamp: m[1], speaker: m[2].trim(), text: m[3] })
      continue
    }
    // Match: **[00:00]** text  (no speaker — worker mixed-audio format)
    const m2 = raw.match(/^\*\*\[([^\]]+)\]\*\* (.*)$/)
    if (m2) {
      lines.push({ type: 'speech', raw, lineIdx, timestamp: m2[1], speaker: undefined, text: m2[2] })
      continue
    }
    if (raw.startsWith('#')) {
      lines.push({ type: 'heading', raw, lineIdx })
    } else {
      lines.push({ type: 'other', raw, lineIdx })
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

/** "Kali [Marko]" -> {name: Kali, player: Marko}; "DM (Danny)" -> {name: DM, player: Danny}. */
function splitSpeaker(speaker?: string): { name: string; player: string } {
  if (!speaker) return { name: '', player: '' }
  const m = speaker.match(/^(.*?)\s*[[(]([^\])]+)[\])]\s*$/)
  return m ? { name: m[1], player: m[2] } : { name: speaker, player: '' }
}

const SILENCE_BREAK_SECONDS = 12

// ─── Ribbon bookmark: where each reader stopped in each session ──────────────
const ribbonKey = (campaign: string, session: string) => `dnd-ribbon:${campaign}:${session}`

// ─── Low-confidence words ─────────────────────────────────────────────────────
// The worker records words Whisper decoded with low probability, keyed by the
// transcript line's timestamp + speaker (line numbers shift with edits).

interface LowConfWord { word: string; prob: number }
interface ConfidenceMap { version: number; lines: { ts: string; speaker: string; words: LowConfWord[] }[] }
type ConfidenceIndex = Map<string, { speaker: string; words: LowConfWord[] }[]>

function indexConfidence(map: ConfidenceMap | null): ConfidenceIndex {
  const idx: ConfidenceIndex = new Map()
  for (const line of map?.lines ?? []) {
    const bucket = idx.get(line.ts) ?? []
    bucket.push({ speaker: line.speaker, words: line.words })
    idx.set(line.ts, bucket)
  }
  return idx
}

function lowConfWordsFor(idx: ConfidenceIndex, ts?: string, speaker?: string): LowConfWord[] {
  if (!ts) return []
  const entries = idx.get(ts)
  if (!entries) return []
  // Prefer the exact speaker; fall back to anything at this timestamp so a
  // speaker rename doesn't silently drop the highlights.
  const same = entries.filter(e => e.speaker === speaker)
  return (same.length ? same : entries).flatMap(e => e.words)
}

type Mark = { start: number; end: number; prob?: number; search?: boolean }

/** Locate each low-confidence word in order, so a shaky "the" doesn't flag every "the". */
function lowConfRanges(text: string, words: LowConfWord[]): Mark[] {
  const lower = text.toLowerCase()
  const out: Mark[] = []
  let cursor = 0
  for (const w of words) {
    const needle = w.word.toLowerCase()
    if (!needle) continue
    let at = lower.indexOf(needle, cursor)
    while (at >= 0) {
      const before = at === 0 ? '' : lower[at - 1]
      const after = lower[at + needle.length] ?? ''
      if (!/[a-z0-9']/.test(before) && !/[a-z0-9']/.test(after)) break
      at = lower.indexOf(needle, at + 1)
    }
    // A word that was corrected or hand-edited since won't be found — fine,
    // it no longer needs flagging.
    if (at < 0) continue
    out.push({ start: at, end: at + needle.length, prob: w.prob })
    cursor = at + needle.length
  }
  return out
}

function renderMarked(text: string, marks: Mark[]) {
  if (marks.length === 0) return text
  const cuts = new Set<number>([0, text.length])
  for (const m of marks) { cuts.add(m.start); cuts.add(m.end) }
  const points = [...cuts].sort((a, b) => a - b)
  const parts: React.ReactNode[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]]
    const piece = text.slice(a, b)
    const low = marks.find(m => m.prob !== undefined && m.start <= a && m.end >= b)
    const hit = marks.some(m => m.search && m.start <= a && m.end >= b)
    if (!low && !hit) { parts.push(piece); continue }
    parts.push(
      <span
        key={a}
        className={[low ? 'lowconf-word' : '', hit ? 'search-hit' : ''].join(' ').trim() || undefined}
        data-strong={low && low.prob! < 0.35 ? '' : undefined}
        title={low ? `Whisper was ${Math.round(low.prob! * 100)}% sure of this word` : undefined}
      >
        {piece}
      </span>
    )
  }
  return <>{parts}</>
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

type Tab = 'transcript' | 'summary' | 'wiki' | 'changes' | 'names' | 'stats'

export default function SessionView() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const apiUrl = useApiUrl()
  const { toast } = useToast()
  const { authEnabled } = useAuth()
  const { activeCampaign } = useCampaign()
  const [tab, setTab] = useState<Tab>('transcript')
  const [transcript, setTranscript] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [wiki, setWiki] = useState<string | null>(null)
  const [description, setDescription] = useState<string | null>(null)
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [search, setSearch] = useState('')
  const [confidence, setConfidence] = useState<ConfidenceMap | null>(null)
  const [showConfidence, setShowConfidence] = useState(() => {
    try { return localStorage.getItem('dnd-show-lowconf') !== 'false' } catch { return true }
  })
  const [namesKey, setNamesKey] = useState(0)
  const [namesPending, setNamesPending] = useState(0)
  const [walkItems, setWalkItems] = useState<WalkItem[] | null>(null)
  const walkStopRef = useRef<number | null>(null)
  const canEditTranscript = !activeCampaign || activeCampaign.role !== 'spectator'
  const unsureCount = useMemo(
    () => (transcript && confidence ? buildWalkItems(transcript, confidence).length : 0),
    [transcript, confidence],
  )
  /** Play [from, until) of the recording, for the walkthrough. */
  const playMoment = (from: number, until: number) => {
    const el = audioRef.current
    if (!el) return
    if (walkStopRef.current) window.clearTimeout(walkStopRef.current)
    el.currentTime = from
    el.play().catch(() => {})
    walkStopRef.current = window.setTimeout(() => el.pause(), Math.max(1, until - from) * 1000 / (el.playbackRate || 1))
  }
  const stopMoment = () => {
    if (walkStopRef.current) window.clearTimeout(walkStopRef.current)
    audioRef.current?.pause()
  }
  const tabsRowRef = useRef<HTMLDivElement | null>(null)
  // On narrow screens the tab row scrolls; keep the active tab in view.
  useEffect(() => {
    tabsRowRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [tab])
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
  const sessionContentRef = useRef<HTMLDivElement | null>(null)
  const anchorLineIdxRef = useRef<number | null>(null)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [shareCreating, setShareCreating] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [shareShowTranscript, setShareShowTranscript] = useState(true)
  const [shareShowSummary, setShareShowSummary] = useState(true)
  const [shareShowWiki, setShareShowWiki] = useState(true)
  const [existingShares, setExistingShares] = useState<{ token: string; created_at: string; expires_at: string | null; expired: boolean }[]>([])
  const [sharesLoading, setSharesLoading] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  // ── Pipeline run ─────────────────────────────────────────────────────────
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [pipelineLog, setPipelineLog] = useState<string[]>([])
  const [pipelinePanel, setPipelinePanel] = useState(false)
  const [pipelineStep, setPipelineStep] = useState<'full' | 'transcribe' | 'wiki'>('full')
  // ── Generate (summary + wiki) ─────────────────────────────────────────────
  const [generating, setGenerating] = useState(false)
  const [generateLog, setGenerateLog] = useState<string[]>([])
  const [generateDone, setGenerateDone] = useState(false)
  const [analysisNotes, setAnalysisNotes] = useState<string>('')
  const [notesSaving, setNotesSaving] = useState(false)
  const [analysisPending, setAnalysisPending] = useState(false)
  const [importingTranscript, setImportingTranscript] = useState(false)
  const [audioDuration, setAudioDuration] = useState(0)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [mainAudioVisible, setMainAudioVisible] = useState(true)
  const importInputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioPanelRef = useRef<HTMLDivElement | null>(null)
  const pendingSeekRef = useRef<number | null>(null)
  const dragCounter = useRef(0)

  const handleDownloadTranscript = () => {
    if (!transcript) return
    const blob = new Blob([transcript], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}-transcript.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportTranscript = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.md') && !file.name.endsWith('.txt')) {
      toast('Please select a .md or .txt file', 'error')
      return
    }
    setImportingTranscript(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await fetch(apiUrl(`/sessions/${name}/transcript/import`), { method: 'POST', body: form })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: 'Upload failed' }))
        toast(err.detail ?? 'Import failed', 'error')
        return
      }
      const data = await r.json()
      toast(`Transcript imported — ${data.lines} lines`, 'success')
      load()
      setChangesLoaded(false)
      setChangesReport(null)
    } catch (_) {
      toast('Import failed', 'error')
    } finally {
      setImportingTranscript(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  /** silent: refresh data without the loading skeleton, which would unmount
   *  the active tab (losing e.g. the Names tab's expanded sections). */
  const load = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true)
    const [t, s, w, n, d, p] = await Promise.allSettled([
      fetch(apiUrl(`/sessions/${name}/transcript`)).then(r => r.ok ? r.json() : null),
      fetch(apiUrl(`/sessions/${name}/summary`)).then(r => r.ok ? r.json() : null),
      fetch(apiUrl(`/sessions/${name}/wiki`)).then(r => r.ok ? r.json() : null),
      fetch(apiUrl(`/sessions/${name}/analysis-notes`)).then(r => r.ok ? r.json() : null),
      fetch(apiUrl(`/sessions/${name}/description`)).then(r => r.ok ? r.json() : null),
      fetch(apiUrl(`/sessions/${name}/analysis-pending`)).then(r => r.ok ? r.json() : null),
    ])
    if (activeCampaign) {
      // Names tab badge: how many likely-misheard names are waiting for a decision.
      fetch(apiUrl(`/sessions/${name}/unknown-words`))
        .then(r => (r.ok ? r.json() : null))
        .then(d => setNamesPending(d ? d.words.filter((w: { suggestion: string | null }) => w.suggestion).length : 0))
        .catch(() => setNamesPending(0))
      fetch(apiUrl(`/sessions/${name}/confidence`))
        .then(r => (r.ok ? r.json() : null))
        .then(setConfidence)
        .catch(() => setConfidence(null))
    }
    setTranscript(t.status === 'fulfilled' && t.value ? t.value.content : null)
    setSummary(s.status === 'fulfilled' && s.value ? s.value.content : null)
    setWiki(w.status === 'fulfilled' && w.value ? w.value.content : null)
    if (n.status === 'fulfilled' && n.value) setAnalysisNotes(n.value.content ?? '')
    const desc = d.status === 'fulfilled' && d.value ? d.value.content : null
    setDescription(desc)
    setDescriptionDraft(desc ?? '')
    setAnalysisPending(p.status === 'fulfilled' && p.value ? p.value.pending : false)
    setLoading(false)
  }

  const saveDescription = async (value: string) => {
    try {
      await fetch(apiUrl(`/sessions/${name}/description`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: value }),
      })
      setDescription(value.trim() || null)
      setEditingDescription(false)
    } catch (_) {
      toast('Failed to save description', 'error')
    }
  }

  const saveAnalysisNotes = async (value: string) => {
    setNotesSaving(true)
    try {
      await fetch(apiUrl(`/sessions/${name}/analysis-notes`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: value }),
      })
    } finally {
      setNotesSaving(false)
    }
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

  // Start polling whenever analysisPending becomes true (catches both page-load detection and UI-triggered)
  useEffect(() => {
    if (!analysisPending) return
    let attempts = 0
    const poll = setInterval(async () => {
      attempts++
      try {
        const pr = await fetch(apiUrl(`/sessions/${name}/analysis-pending`))
        if (pr.ok) {
          const pd = await pr.json()
          if (!pd.pending) {
            clearInterval(poll)
            setAnalysisPending(false)
            toast('Summary & wiki ready!', 'success')
            load()
          }
        }
      } catch (_) { /* ignore transient errors */ }
      if (attempts >= 240) { clearInterval(poll); setAnalysisPending(false) }
    }, 5000)
    return () => clearInterval(poll)
  }, [analysisPending, name, apiUrl])

  useEffect(() => {
    if (selectedAudio === '_merged') setMixingInProgress(true)
    else setMixingInProgress(false)
  }, [selectedAudio])

  useEffect(() => {
    if (tab === 'changes') {
      loadChanges()
    }
    // Each tab starts at its own top; otherwise Names/Wiki open mid-list at
    // whatever depth the transcript was scrolled to.
    if (sessionContentRef.current && !targetTimestamp) sessionContentRef.current.scrollTop = 0
  }, [tab])

  // After toggling edit mode, scroll the anchor line into view
  useEffect(() => {
    const idx = anchorLineIdxRef.current
    if (idx === null) return
    const frame = requestAnimationFrame(() => {
      const el = sessionContentRef.current?.querySelector(`[data-line-idx="${idx}"]`) as HTMLElement | null
      if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' })
    })
    return () => cancelAnimationFrame(frame)
  }, [editMode])

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

  // Track audio panel visibility for sticky mini-player
  useEffect(() => {
    const el = audioPanelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => setMainAudioVisible(entry.isIntersecting),
      { threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [audioFiles.length]) // re-run when audio files load

  const doMerge = async () => {
    setMerging(true)
    try {
      const r = await fetch(apiUrl(`/sessions/${name}/merge`), { method: 'POST' })
      if (r.ok) {
        const res = await r.json().catch(() => null)
        const n = res?.changes ?? 0
        toast(n ? `Applied corrections: ${n} fix${n !== 1 ? 'es' : ''}` : 'Already matches the correction rules', n ? 'success' : 'info')
        load({ silent: true })
        // Invalidate changes report so it reloads next time
        setChangesLoaded(false)
        setChangesReport(null)
      } else {
        const err = await r.json()
        toast(err.detail || 'Could not apply corrections', 'error')
      }
    } finally {
      setMerging(false)
    }
  }

  const generateAnalysis = async (wikiOnly = false) => {
    setGenerating(true)
    setGenerateLog([])
    setGenerateDone(false)
    try {
      const r = await fetch(apiUrl('/pipeline/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: name, wiki_only: wikiOnly }),
      })
      if (!r.ok) {
        const body = await r.text().catch(() => '')
        let detail = `HTTP ${r.status}`
        try { const j = JSON.parse(body); detail = j.detail ? String(j.detail) : detail } catch {}
        toast(`Failed to start generation: ${detail}`, 'error')
        console.error('pipeline/run failed', r.status, body)
        setGenerating(false)
        return
      }
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${protocol}://${location.host}/ws/progress`)
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'log') {
          const line: string = msg.line
          if (line.startsWith('__EXIT__')) {
            const code = parseInt(line.replace('__EXIT__', ''))
            ws.close()
            setGenerating(false)
            setGenerateDone(true)
            if (code === 0) {
              toast('Queued — worker is analyzing transcript…', 'success')
              setAnalysisPending(true) // useEffect will start polling automatically
            } else {
              toast('Generation failed — check logs', 'error')
            }
          } else {
            setGenerateLog(prev => [...prev, line])
          }
        } else if (msg.type === 'status' && !msg.running) {
          ws.close()
          setGenerating(false)
          setGenerateDone(true)
        }
      }
      ws.onerror = () => { setGenerating(false); toast('WebSocket error during generation', 'error') }
    } catch {
      setGenerating(false)
      toast('Failed to start generation', 'error')
    }
  }

  const cancelAnalysis = async () => {
    try {
      await fetch(apiUrl(`/sessions/${name}/analysis-pending`), { method: 'DELETE' })
      setAnalysisPending(false)
      toast('Analysis job cancelled', 'info')
    } catch {
      toast('Failed to cancel analysis', 'error')
    }
  }

  const runFullPipeline = async () => {
    setPipelineRunning(true)
    setPipelineLog([])
    try {
      const r = await fetch(apiUrl('/pipeline/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: name, transcribe_only: pipelineStep === 'transcribe', wiki_only: false }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        toast(err.detail || 'Failed to start pipeline', 'error')
        setPipelineRunning(false)
        return
      }
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${protocol}://${location.host}/ws/progress`)
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'log') {
          const line: string = msg.line
          if (line.startsWith('__EXIT__')) {
            const code = parseInt(line.replace('__EXIT__', ''))
            ws.close()
            setPipelineRunning(false)
            if (code === 0) {
              load()
              toast('Pipeline complete', 'success')
            } else {
              toast('Pipeline failed — check logs', 'error')
            }
          } else {
            setPipelineLog(prev => [...prev, line])
          }
        } else if (msg.type === 'status' && !msg.running) {
          ws.close()
          setPipelineRunning(false)
        }
      }
      ws.onerror = () => { setPipelineRunning(false); toast('WebSocket error during pipeline', 'error') }
    } catch {
      setPipelineRunning(false)
      toast('Failed to start pipeline', 'error')
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

  // Every speech line's start, for mapping a time (from a summary citation
  // or a #t= link) to the line it falls in.
  const lineStarts = useMemo(() => {
    const out: { seconds: number; ts: string }[] = []
    for (const line of transcript?.split('\n') ?? []) {
      const m = line.match(/^\*\*\[([^\]]+)\]/)
      if (m) out.push({ seconds: parseTimestampToSeconds(m[1]), ts: m[1] })
    }
    return out
  }, [transcript])

  /** Open the transcript at the line containing `seconds` and play from there. */
  const jumpToTime = (seconds: number, play = true) => {
    let hit = lineStarts[0]
    for (const l of lineStarts) {
      if (l.seconds <= seconds) hit = l
      else break
    }
    if (!hit) return
    setSearch('')
    setTab('transcript')
    setTargetTimestamp(hit.ts)
    if (play && audioRef.current) seekTo(seconds)
  }

  // Deep link: /sessions/<name>#t=1:15:57 (used by the Quotes page).
  useEffect(() => {
    const m = window.location.hash.match(/^#t=([\d:]+)$/)
    if (!m || lineStarts.length === 0) return
    jumpToTime(parseTimestampToSeconds(m[1]), false)
    history.replaceState(null, '', window.location.pathname)
  }, [lineStarts])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'transcript', label: 'Transcript' },
    { id: 'summary', label: 'Summary' },
    { id: 'wiki', label: 'Wiki' },
    { id: 'changes', label: 'Changes' },
    ...(activeCampaign ? [{ id: 'names' as Tab, label: 'Names' }, { id: 'stats' as Tab, label: 'Stats' }] : []),
  ]

  return (
    <div className="session-view-root" style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, minHeight: 0 }}>
      {/* Window drag overlay */}
      {isDragOver && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'color-mix(in srgb, var(--rubric) 8%, transparent)',
          border: '3px dashed color-mix(in srgb, var(--rubric) 50%, transparent)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            background: 'var(--bg-elevated)',
            borderRadius: '16px',
            padding: '32px 64px',
            color: 'var(--gilt-ink)',
            fontSize: '20px',
            fontWeight: 700,
            border: '1px solid color-mix(in srgb, var(--rubric) 40%, transparent)',
          }}>
            {uploadingAudio ? 'Uploading...' : 'Drop audio files or ZIP to import'}
          </div>
        </div>
      )}

      {/* Analysis pending banner — shown across all tabs */}
      {analysisPending && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 28px',
          background: 'color-mix(in srgb, var(--ochre) 10%, transparent)',
          borderBottom: '1px solid color-mix(in srgb, var(--ochre) 30%, transparent)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ochre)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <SpinnerIcon size={14} />
            Worker is analyzing this session — summary and wiki will appear when done.
          </span>
          <button
            onClick={cancelAnalysis}
            style={{
              background: 'color-mix(in srgb, var(--rubric) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--rubric) 30%, transparent)',
              borderRadius: '3px',
              color: 'var(--rubric)',
              padding: '4px 12px',
              fontSize: '15px',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Header: the entry's chapter heading */}
      <div className="session-header" style={{
        padding: '26px 48px 10px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate('/')}
            aria-label="Back to sessions"
            title="Back to sessions"
            className="entry-action"
            style={{ marginLeft: '-8px', color: 'var(--ink-faint)' }}
          >
            <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <h1 style={{ margin: 0, fontSize: '34px', lineHeight: 1.15, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '0 1 auto' }}>{name}</h1>
          {!description && !editingDescription && summary && (
            <button
              className="desc-add"
              onClick={() => { setEditingDescription(true); setDescriptionDraft('') }}
            >
              Add a description
            </button>
          )}
          <span style={{ flex: '1 1 0' }} />

          {editMode && tab === 'transcript' && (
            <span style={{ color: 'var(--rubric)', fontSize: '17px', flexShrink: 0, paddingBottom: '4px' }}>
              Editing
            </span>
          )}

          <div style={{ display: 'flex', gap: '8px', flexShrink: 0, paddingBottom: '4px' }}>
            <button
              className="btn-ghost"
              onClick={async () => {
                setShareModalOpen(true); setShareToken(null); setShareCopied(false)
                setSharesLoading(true)
                try {
                  const r = await fetch(apiUrl(`/sessions/${name}/shares`))
                  if (r.ok) setExistingShares(await r.json())
                } catch { /* ignore */ } finally { setSharesLoading(false) }
              }}
            >
              Share
            </button>

            {!(editMode && tab === 'transcript') && (
              <>
                <button className="btn-ghost" onClick={doMerge} disabled={merging}
                  title="Apply the campaign's correction rules to this session (your manual edits are kept)">
                  {merging ? 'Applying…' : 'Apply corrections'}
                </button>
                <button
                  className={pipelineRunning ? 'btn-secondary' : 'btn-primary'}
                  onClick={() => setPipelinePanel(p => !p)}
                  aria-expanded={pipelinePanel}
                >
                  {pipelineRunning ? 'Pipeline running…' : 'Run pipeline'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Episode description row */}
        {(description || editingDescription) ? (
          <div className={editingDescription ? undefined : 'session-description-block'} style={{ marginTop: '10px', paddingLeft: '2px' }}>
            {editingDescription ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <textarea
                  value={descriptionDraft}
                  onChange={e => setDescriptionDraft(e.target.value)}
                  rows={3}
                  style={{
                    flex: 1,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--accent3)',
                    borderRadius: '3px',
                    color: 'var(--text-primary)',
                    padding: '8px 12px',
                    fontSize: '16px',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    lineHeight: 1.5,
                    outline: 'none',
                  }}
                  autoFocus
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <button className="btn-primary" style={{ fontSize: '15px', padding: '6px 14px', whiteSpace: 'nowrap' }} onClick={() => saveDescription(descriptionDraft)}>Save</button>
                  <button className="btn-ghost" style={{ fontSize: '15px', padding: '6px 14px' }} onClick={() => { setEditingDescription(false); setDescriptionDraft(description ?? '') }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <p style={{
                  margin: 0,
                  fontSize: '16px',
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',  // the session's subtitle
                  lineHeight: 1.6,
                  flex: 1,
                }}>
                  {description}
                </p>
                <button
                  onClick={() => { setEditingDescription(true); setDescriptionDraft(description ?? '') }}
                  className="btn-ghost"
                  style={{ fontSize: '14px', padding: '3px 8px', flexShrink: 0 }}
                  title="Edit description"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Pipeline panel */}
      {pipelinePanel && (
        <div style={{
          borderBottom: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)',
          background: 'var(--bg-elevated)',
          padding: '16px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {[
              { id: 'full', label: 'Full Pipeline', desc: 'Transcribe + Wiki' },
              { id: 'transcribe', label: 'Transcribe Only', desc: 'Stop after merge' },
              { id: 'wiki', label: 'Wiki Only', desc: 'Skip transcription' },
            ].map(opt => {
              const active = pipelineStep === opt.id
              return (
                <button key={opt.id} onClick={() => setPipelineStep(opt.id as any)}
                  style={{
                    background: active ? 'color-mix(in srgb, var(--rubric) 15%, transparent)' : 'transparent',
                    border: `1px solid ${active ? 'color-mix(in srgb, var(--rubric) 40%, transparent)' : 'var(--accent3)'}`,
                    borderRadius: '3px', padding: '8px 14px', cursor: 'pointer', textAlign: 'left',
                  }}>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: active ? 'var(--accent-text)' : 'var(--text-primary)' }}>{opt.label}</div>
                  <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{opt.desc}</div>
                </button>
              )
            })}
            <button
              onClick={() => {
                if (pipelineStep === 'wiki') { generateAnalysis() }
                else { runFullPipeline() }
                setPipelinePanel(false)
              }}
              disabled={pipelineRunning || generating}
              className="btn-primary"
              style={{ marginLeft: 'auto', padding: '8px 20px', fontSize: '16px' }}
            >
              Run
            </button>
          </div>
          {pipelineLog.length > 0 && (
            <div style={{
              background: 'var(--page-sunk)', borderRadius: '3px', padding: '10px 14px',
              fontFamily: 'monospace', fontSize: '14px', lineHeight: 1.7,
              maxHeight: '160px', overflowY: 'auto', color: 'var(--ink-soft)',
            }}>
              {pipelineLog.map((line, i) => <div key={i} style={{ whiteSpace: 'pre-wrap' }}>{line || '\u00a0'}</div>)}
            </div>
          )}
        </div>
      )}

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
            background: 'var(--bg-elevated)', border: '1px solid color-mix(in srgb, var(--ink) 10%, transparent)',
            borderRadius: 3, padding: 28, width: 420, maxWidth: '90vw',
          }}>
            <h3 style={{ margin: '0 0 16px', color: 'var(--ink)', fontSize: 18, fontWeight: 700 }}>
              Share Session
            </h3>

            {!shareToken ? (
              <>
                <p style={{ color: 'var(--ink-faint)', fontSize: 16, margin: '0 0 16px' }}>
                  Generate a read-only public link. No login required to view.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                  {([
                    ['show_transcript', 'Transcript', shareShowTranscript, setShareShowTranscript],
                    ['show_summary', 'Summary', shareShowSummary, setShareShowSummary],
                    ['show_wiki', 'Wiki', shareShowWiki, setShareShowWiki],
                  ] as const).map(([, label, val, set]) => (
                    <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', color: 'var(--ink)', fontSize: 17 }}>
                      <input
                        type="checkbox"
                        checked={val}
                        onChange={e => (set as (v: boolean) => void)(e.target.checked)}
                        style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                      />
                      Include {label}
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShareModalOpen(false)}
                    style={{ padding: '8px 16px', borderRadius: 3, border: '1px solid color-mix(in srgb, var(--ink) 10%, transparent)', background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 16 }}
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
                    style={{ padding: '8px 18px', borderRadius: 3, border: 'none', background: 'var(--accent)', color: 'var(--on-rubric)', fontWeight: 600, cursor: 'pointer', fontSize: 16, opacity: shareCreating ? 0.6 : 1 }}
                  >
                    {shareCreating ? 'Creating…' : 'Generate Link'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ color: 'var(--ink-faint)', fontSize: 16, margin: '0 0 12px' }}>Share this link — anyone with it can view the session (no login needed):</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                  <input
                    readOnly
                    value={`${window.location.origin}/share/${shareToken}`}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 3,
                      border: '1px solid color-mix(in srgb, var(--ink) 10%, transparent)', background: 'color-mix(in srgb, var(--ink) 5%, transparent)',
                      color: 'var(--ink)', fontSize: 16, fontFamily: 'monospace',
                    }}
                    onClick={e => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/share/${shareToken}`)
                      setShareCopied(true)
                      setTimeout(() => setShareCopied(false), 2000)
                    }}
                    style={{ padding: '8px 14px', borderRadius: 3, border: 'none', background: shareCopied ? 'var(--moss)' : 'var(--accent)', color: 'var(--on-rubric)', fontWeight: 600, cursor: 'pointer', fontSize: 16, transition: 'background 0.2s' }}
                  >
                    {shareCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => { setShareToken(null) }}
                    style={{ padding: '8px 16px', borderRadius: 3, border: '1px solid color-mix(in srgb, var(--ink) 10%, transparent)', background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 16 }}
                  >
                    ← Create another
                  </button>
                </div>
              </>
            )}

            {/* Existing shares list */}
            {!sharesLoading && existingShares.length > 0 && (
              <div style={{ borderTop: '1px solid color-mix(in srgb, var(--ink) 7%, transparent)', marginTop: 16, paddingTop: 14 }}>
                <div style={{ fontSize: 14, color: 'var(--ink-faint)', fontWeight: 700, fontVariant: 'small-caps', letterSpacing: '0.05em', marginBottom: 8 }}>
                  Active Links
                </div>
                {existingShares.map(s => (
                  <div key={s.token} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{
                      flex: 1, fontSize: 14, fontFamily: 'monospace', color: s.expired ? 'var(--ink-faint)' : 'var(--ink-soft)',
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
                        style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid color-mix(in srgb, var(--ink) 10%, transparent)', background: 'transparent', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: 14 }}
                        title="Copy link"
                       aria-label="Copy link"><CopyIcon /></button>
                    )}
                    <button
                      onClick={async () => {
                        await fetch(apiUrl(`/sessions/${name}/shares/${s.token}`), { method: 'DELETE' })
                        setExistingShares(prev => prev.filter(x => x.token !== s.token))
                      }}
                      style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid color-mix(in srgb, var(--rubric) 25%, transparent)', background: 'transparent', color: 'var(--rubric)', cursor: 'pointer', fontSize: 14 }}
                      title="Revoke"
                    ><CloseIcon /></button>
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
        flexShrink: 0,
      }}>
      <div ref={tabsRowRef} className="session-tabs-row" role="tablist" style={{ display: 'flex', gap: '28px', padding: '0 48px', overflowX: 'auto', scrollbarWidth: 'none', borderBottom: '1px solid var(--rule)' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className="sc"
            style={{
              background: 'transparent',
              border: 'none',
              boxShadow: tab === t.id ? 'inset 0 -2px 0 var(--rubric)' : 'none',
              color: tab === t.id ? 'var(--rubric)' : 'var(--ink-faint)',
              padding: '10px 0',
              fontSize: '19px',
              fontWeight: tab === t.id ? 600 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {t.label}
            {t.id === 'names' && namesPending > 0 && (
              <span style={{ marginLeft: 6, fontSize: '15px', color: 'var(--rubric)', fontVariant: 'normal', fontVariantNumeric: 'lining-nums' }}
                aria-label={`${namesPending} to review`}>
                {namesPending}
              </span>
            )}
          </button>
        ))}
        </div>

        {tab === 'transcript' && (
          <div className="session-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 48px 8px', flexWrap: 'wrap' }}>
            {/* View mode: search bar */}
            {!editMode && (
              <>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Find a word, name, or phrase"
                  aria-label="Search this transcript"
                  className="written-line"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--rule-strong)',
                    borderRadius: 0,
                    color: 'var(--ink)',
                    padding: '4px 2px',
                    fontSize: '18px',
                    flex: '0 1 360px',
                    minWidth: 0,
                    outline: 'none',
                  }}
                />
                {(confidence?.lines.length ?? 0) > 0 && (
                  <button
                    onClick={() => setShowConfidence(v => {
                      try { localStorage.setItem('dnd-show-lowconf', String(!v)) } catch { /* private mode */ }
                      return !v
                    })}
                    aria-pressed={showConfidence}
                    title="Underline words Whisper wasn't sure about"
                    style={{
                      background: 'none', border: 'none', padding: '4px 2px', cursor: 'pointer', flexShrink: 0,
                      fontSize: '17px', color: showConfidence ? 'var(--ink)' : 'var(--ink-faint)',
                    }}
                  >
                    <span className={showConfidence ? 'lowconf-word' : undefined} data-strong="" style={showConfidence ? undefined : { textDecoration: 'line-through' }}>Unsure words</span>
                    <span style={{ color: 'var(--ink-faint)', marginLeft: 6 }}>{showConfidence ? 'shown' : 'hidden'}</span>
                  </button>
                )}
                {canEditTranscript && unsureCount > 0 && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => { setSearch(''); setWalkItems(buildWalkItems(transcript!, confidence)) }}
                    title="Step through each word Whisper wasn't sure about, with the audio"
                    style={{ flexShrink: 0 }}
                  >
                    Review {unsureCount} unsure word{unsureCount !== 1 ? 's' : ''}
                  </button>
                )}
                {search && transcript && (() => {
                  const q = search.toLowerCase()
                  const count = transcript.split('\n').filter(l => l.toLowerCase().includes(q)).length
                  return (
                    <span style={{ fontSize: '16px', color: count > 0 ? 'var(--ink-soft)' : 'var(--rubric)', whiteSpace: 'nowrap' }}>
                      {count > 0 ? `${count} line${count !== 1 ? 's' : ''}` : 'not found'}
                    </span>
                  )
                })()}
              </>
            )}

            {/* Edit mode: download + import tools */}
            {editMode && transcript && (
              <>
                <button
                  onClick={handleDownloadTranscript}
                  className="btn-ghost"
                  style={{ fontSize: '15px', padding: '5px 12px', flexShrink: 0 }}
                >
                  Download
                </button>
                <label
                  className="btn-ghost"
                  style={{ fontSize: '15px', padding: '5px 12px', flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  {importingTranscript ? 'Importing...' : 'Import'}
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".md,.txt"
                    style={{ display: 'none' }}
                    onChange={handleImportTranscript}
                  />
                </label>
              </>
            )}

            <div style={{ flex: 1 }} />

            {/* Edit/Done toggle — always rightmost */}
            {transcript && (
              <button
                onClick={() => {
                  if (!editMode && sessionContentRef.current) {
                    const container = sessionContentRef.current
                    const containerTop = container.getBoundingClientRect().top
                    const lineEls = container.querySelectorAll('[data-line-idx]')
                    let bestIdx: number | null = null
                    for (const el of Array.from(lineEls)) {
                      const rect = el.getBoundingClientRect()
                      if (rect.bottom > containerTop + 4) {
                        bestIdx = parseInt((el as HTMLElement).dataset.lineIdx ?? '-1', 10)
                        break
                      }
                    }
                    anchorLineIdxRef.current = bestIdx
                  }
                  setEditMode(m => !m)
                }}
                className={editMode ? 'btn-primary' : 'btn-ghost'}
                style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                {editMode ? 'Done editing' : 'Edit transcript'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Speakers panel — transcript tab only */}
      {tab === 'transcript' && transcript && (
        <SpeakersPanel sessionName={name!} onRename={() => { load(); setChangesLoaded(false); setChangesReport(null) }} />
      )}

      {/* Audio: a hairline bar in the journal's own hand. The <audio> element
          stays mounted on every tab so switching tabs doesn't stop playback;
          the controls only show on the transcript, the tab that uses them. */}
      {audioFiles.length > 0 && (
        <div ref={audioPanelRef} className="session-audio-panel" hidden={tab !== 'transcript'} style={{
          borderBottom: '1px solid var(--rule)',
          flexShrink: 0,
          padding: '4px 48px 12px',
        }}>
          {selectedAudio && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <audio
                ref={audioRef}
                key={selectedAudio}
                src={apiUrl(`/sessions/${encodeURIComponent(name!)}/merged-audio`)}
                preload="metadata"
                onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
                onLoadedMetadata={() => {
                  if (audioRef.current) {
                    audioRef.current.playbackRate = playbackRate
                    setAudioDuration(audioRef.current.duration || 0)
                  }
                  if (pendingSeekRef.current !== null) {
                    seekTo(pendingSeekRef.current)
                    pendingSeekRef.current = null
                  }
                }}
                onPlay={() => setAudioPlaying(true)}
                onPause={() => setAudioPlaying(false)}
                onEnded={() => setAudioPlaying(false)}
              />
              <button
                type="button"
                className="audio-play"
                onClick={() => {
                  const el = audioRef.current
                  if (!el) return
                  if (el.paused) el.play().catch(() => {})
                  else el.pause()
                }}
                aria-label={audioPlaying ? 'Pause recording' : 'Play recording'}
              >
                {audioPlaying ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
              </button>
              <span className="audio-time" aria-live="off">
                {formatTime(currentTime)}
                <span style={{ color: 'var(--ink-faint)' }}> / {audioDuration > 0 ? formatTime(audioDuration) : '…'}</span>
              </span>
              <input
                type="range"
                className="journal-scrubber"
                min={0}
                max={audioDuration || 1}
                step={1}
                value={Math.min(currentTime, audioDuration || 1)}
                onChange={e => seekTo(parseFloat(e.target.value))}
                aria-label="Position in recording"
                style={{ ['--pct' as string]: `${audioDuration ? (currentTime / audioDuration) * 100 : 0}%` }}
              />
              <select
                value={playbackRate}
                onChange={e => {
                  const rate = parseFloat(e.target.value)
                  setPlaybackRate(rate)
                  if (audioRef.current) audioRef.current.playbackRate = rate
                }}
                aria-label="Playback speed"
                className="audio-speed"
              >
                {[1, 1.5, 2, 3].map(r => (
                  <option key={r} value={r}>{r}×</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div ref={sessionContentRef} className="session-content" style={{ flex: 1, overflow: 'auto', padding: '18px 48px', paddingBottom: !mainAudioVisible && audioFiles.length > 0 ? '80px' : '40px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '820px' }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="skeleton" style={{ height: 14, width: '20%' }} />
                <div className="skeleton" style={{ height: 16, width: '90%' }} />
                <div className="skeleton" style={{ height: 16, width: '75%' }} />
              </div>
            ))}
          </div>
        ) : tab === 'transcript' ? (
          transcript ? (
            <TranscriptView
              content={transcript}
              search={search}
              currentTime={audioFiles.length > 0 ? currentTime : undefined}
              onSeek={audioFiles.length > 0 ? seekAndSwitch : undefined}
              targetTimestamp={targetTimestamp}
              onTargetReached={() => setTargetTimestamp(null)}
              sessionName={name!}
              editMode={editMode}
              onTranscriptChange={() => { load(); setChangesLoaded(false); setChangesReport(null); setNamesKey(k => k + 1) }}
              confidence={confidence}
              showConfidence={showConfidence && !editMode}
            />
          ) : (
            <EmptyTabState
              title="No transcript yet"
              message="Queue a transcription job to get started. Drop audio files onto the session, or use the microphone button on the sessions list."
            />
          )
        ) : tab === 'summary' ? (
          <div style={{ maxWidth: '820px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <GenerateWikiPanel
              generating={generating}
              generateLog={generateLog}
              generateDone={generateDone}
              onGenerate={() => generateAnalysis()}
              compact={!!summary}
              notes={analysisNotes}
              onNotesChange={setAnalysisNotes}
              onNotesBlur={saveAnalysisNotes}
              notesSaving={notesSaving}
              analysisPending={analysisPending}
              onCancelAnalysis={cancelAnalysis}
            />
            <MarkdownEditView
              content={summary}
              emptyMsg="No summary yet. Use 'Generate' above to analyze the transcript."
              sessionName={name!}
              endpoint="summary"
              onSaved={load}
              onJump={jumpToTime}
            />
          </div>
        ) : tab === 'wiki' ? (
          <WikiView
            sessionName={name!}
            wikiMarkdown={wiki}
            onRemerge={doMerge}
            onWikiSaved={load}
            generating={generating}
            generateLog={generateLog}
            generateDone={generateDone}
            onGenerate={() => generateAnalysis(true)}
            notes={analysisNotes}
            onNotesChange={setAnalysisNotes}
            onNotesBlur={saveAnalysisNotes}
            notesSaving={notesSaving}
            analysisPending={analysisPending}
            onCancelAnalysis={cancelAnalysis}
          />
        ) : tab === 'stats' ? (
          transcript ? <SessionStatsPanel sessionName={name!} /> : (
            <EmptyTabState title="No transcript yet" message="Talk time is counted once there's a transcript." />
          )
        ) : tab === 'names' ? (
          transcript ? (
            <UnknownWordsPanel
              key={namesKey}
              sessionName={name!}
              canEdit={!authEnabled || activeCampaign?.role === 'dm'}
              onJump={goToHallucination}
              onRuleAdded={() => { load({ silent: true }); setChangesLoaded(false); setChangesReport(null) }}
            />
          ) : (
            <EmptyTabState title="No transcript yet" message="Names are scanned once there's a transcript." />
          )
        ) : (
          <ChangesView
            report={changesReport}
            loading={changesLoading}
            onHallucinationClick={goToHallucination}
            sessionName={name!}
          />
        )}
      </div>

      {walkItems && transcript && tab === 'transcript' && (
        <UnsureWalkthrough
          items={walkItems}
          transcript={transcript}
          sessionName={name!}
          onClose={() => { stopMoment(); setWalkItems(null) }}
          onShowLine={ts => setTargetTimestamp(ts)}
          onPlay={playMoment}
          onStop={stopMoment}
          onChanged={() => load({ silent: true })}
        />
      )}

      {/* Mini audio player: shown on tabs where the main bar is hidden, so playback stays reachable */}
      {audioFiles.length > 0 && !mainAudioVisible && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,   /* overridden to sidebar-width on desktop via CSS */
          right: 0,
          background: 'var(--page)',
          borderTop: '1px solid var(--rule)',
          boxShadow: '0 -8px 20px -14px rgba(0, 0, 0, 0.35)',
          padding: '8px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          zIndex: 200,
          // On mobile, sit above bottom nav
        }} className="sticky-mini-player">
          {/* Play/pause */}
          <button
            onClick={() => {
              if (!audioRef.current) return
              if (audioPlaying) audioRef.current.pause()
              else audioRef.current.play()
            }}
            className="audio-play"
            aria-label={audioPlaying ? 'Pause recording' : 'Play recording'}
          >
            {audioPlaying ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
          </button>

          {/* Time */}
          <span className="audio-time">
            {formatTime(currentTime)}
            <span style={{ color: 'var(--ink-faint)' }}> / {audioDuration > 0 ? formatTime(audioDuration) : '…'}</span>
          </span>

          {/* Progress bar */}
          <input
            type="range"
            min={0}
            max={audioDuration || 1}
            value={Math.min(currentTime, audioDuration || 1)}
            step={1}
            onChange={e => {
              const t = parseFloat(e.target.value)
              if (audioRef.current) audioRef.current.currentTime = t
            }}
            className="journal-scrubber"
            aria-label="Position in recording"
            style={{ ['--pct' as string]: `${audioDuration ? (currentTime / audioDuration) * 100 : 0}%` }}
          />

          {/* Speed */}
          <select
            value={playbackRate}
            onChange={e => {
              const rate = parseFloat(e.target.value)
              setPlaybackRate(rate)
              if (audioRef.current) audioRef.current.playbackRate = rate
            }}
            aria-label="Playback speed"
            className="audio-speed"
          >
            {[1, 1.5, 2, 3].map(r => (
              <option key={r} value={r}>{r}×</option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function TranscriptView({
  content,
  search,
  currentTime,
  onSeek,
  targetTimestamp,
  onTargetReached,
  sessionName,
  editMode,
  onTranscriptChange,
  confidence,
  showConfidence,
}: {
  content: string | null
  search: string
  currentTime?: number
  onSeek?: (seconds: number, speaker?: string) => void
  targetTimestamp?: string | null
  onTargetReached?: () => void
  sessionName?: string
  editMode?: boolean
  onTranscriptChange?: () => void
  confidence?: ConfidenceMap | null
  showConfidence?: boolean
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
  const [hoveredLineIdx, setHoveredLineIdx] = useState<number | null>(null)
  const [ruleSuggestions, setRuleSuggestions] = useState<SessionRuleSuggestion[]>([])
  const confidenceIdx = useMemo(() => indexConfidence(confidence ?? null), [confidence])
  // Ribbon bookmark: remember the first visible line while reading, and on the
  // next visit offer to continue from there.
  const pageRef = useRef<HTMLDivElement | null>(null)
  const storageKey = activeCampaign && sessionName ? ribbonKey(activeCampaign.slug, sessionName) : null
  const [ribbonTs, setRibbonTs] = useState<string | null>(null)
  useEffect(() => {
    if (!storageKey) return
    let saved: string | null = null
    try { saved = localStorage.getItem(storageKey) } catch { /* no storage */ }
    // Only worth a ribbon if they'd actually read past the opening minutes.
    setRibbonTs(saved && parseTimestampToSeconds(saved) > 120 ? saved : null)
  }, [storageKey])
  useEffect(() => {
    if (!storageKey || editMode) return
    const scroller = pageRef.current?.closest('.session-content') as HTMLElement | null
    if (!scroller) return
    let pending = 0
    const onScroll = () => {
      if (pending) return
      pending = window.setTimeout(() => {
        pending = 0
        const top = scroller.getBoundingClientRect().top
        for (const el of Array.from(scroller.querySelectorAll<HTMLElement>('[data-ts]'))) {
          if (el.getBoundingClientRect().bottom > top + 8) {
            try { localStorage.setItem(storageKey, el.dataset.ts!) } catch { /* no storage */ }
            if (scroller.scrollTop > 200) setRibbonTs(null)
            break
          }
        }
      }, 600)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => { scroller.removeEventListener('scroll', onScroll); window.clearTimeout(pending) }
  }, [storageKey, editMode, content])
  // Quotes: lines saved to the campaign's quote board.
  const { toast } = useToast()
  const canQuote = !!activeCampaign && activeCampaign.role !== 'spectator'
  const [quotes, setQuotes] = useState<{ id: string; ts: string; text: string }[]>([])
  useEffect(() => {
    if (!activeCampaign || !sessionName) return
    fetch(apiUrl(`/sessions/${sessionName}/quotes`))
      .then(r => (r.ok ? r.json() : []))
      .then(setQuotes)
      .catch(() => setQuotes([]))
  }, [activeCampaign?.slug, sessionName])
  const quoteFor = (line: ParsedLine) => quotes.find(q => q.ts === line.timestamp && q.text === (line.text ?? '').trim())
  const toggleQuote = async (line: ParsedLine, nextTs?: string) => {
    if (!sessionName || !line.timestamp) return
    const existing = quoteFor(line)
    if (existing) {
      const r = await fetch(apiUrl(`/sessions/${sessionName}/quotes/${existing.id}`), { method: 'DELETE' })
      if (r.ok || r.status === 204) { setQuotes(prev => prev.filter(q => q.id !== existing.id)); toast('Quote removed', 'info') }
      else toast(r.status === 403 ? 'Only whoever saved this quote, or a DM, can remove it' : 'Could not remove the quote', 'error')
      return
    }
    const r = await fetch(apiUrl(`/sessions/${sessionName}/quotes`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts: line.timestamp, end_ts: nextTs ?? null, speaker: line.speaker ?? null, text: line.text ?? '' }),
    })
    if (r.ok) { const q = await r.json(); setQuotes(prev => [...prev, q]); toast('Saved to Quotes', 'success') }
    else toast('Could not save the quote', 'error')
  }

  const continueReading = () => {
    if (!ribbonTs) return
    const el = pageRef.current?.querySelector<HTMLElement>(`[data-ts="${ribbonTs}"]`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    setRibbonTs(null)
  }
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

  // Scroll active line into view — suppressed in edit mode to prevent audio controls
  // from hijacking scroll or blurring the active text input
  useEffect(() => {
    if (editMode) return
    const el = activeLineRef.current
    if (!el) return
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIdx, editMode])

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
    // Capture the editing index at call time — async resolution must not clobber
    // a different line that was opened while this save was in flight (e.g. via insertLineAfter)
    const savedEditingIdx = lineIdx
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
        const data = await r.json().catch(() => null)
        const fresh: SessionRuleSuggestion[] = (data?.rule_suggestions ?? []).map(
          (s: Omit<SessionRuleSuggestion, 'session'>) => ({ ...s, session: sessionName }))
        if (fresh.length) {
          setRuleSuggestions(prev => [
            ...prev.filter(p => !fresh.some(f => f.wrong.toLowerCase() === p.wrong.toLowerCase())),
            ...fresh,
          ])
        }
      }
    } catch (_) {
      // Network/server error — don't lose the edit, just close the input
    } finally {
      setSavingLine(false)
      // Only clear editingLineIdx if it hasn't been changed to something else
      // (e.g. insertLineAfter may have already set a new line while save was in flight)
      setEditingLineIdx(prev => prev === savedEditingIdx ? null : prev)
    }
  }

  const insertLineAfter = (lineIdx: number) => {
    // If a line is currently being edited, commit its current value locally first
    // so we don't lose it when editedLines splices
    if (editingLineIdx !== null) {
      setEditedLines(prev => {
        const next = [...prev]
        next[editingLineIdx] = editingValue
        return next
      })
    }
    setEditedLines(prev => {
      const next = [...prev]
      next.splice(lineIdx + 1, 0, '')
      return next
    })
    setEditingLineIdx(lineIdx + 1)
    setEditingValue('')
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
      try { onTranscriptChange?.() } catch (_) {}
    } catch (_) {
      // Network error — don't leave editor permanently disabled
    } finally {
      setSavingAll(false)
    }
  }

  if (!content) {
    return (
      <div style={{ color: 'var(--ink-faint)', textAlign: 'center', paddingTop: '60px' }}>
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
          background: 'color-mix(in srgb, var(--ochre) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--ochre) 30%, transparent)',
          borderRadius: '3px',
          padding: '10px 14px',
          marginBottom: '12px',
          fontSize: '15px',
          color: 'var(--ochre)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <span>
            {activeCampaign && activeCampaign.role !== 'dm' && activeCampaign.settings?.require_edit_approval
              ? 'Edit mode — changes will be submitted for DM review before being applied.'
              : 'Editing: changes save straight to the transcript, and applying corrections later keeps them. Only re-transcribing the audio would replace them.'}
          </span>
          <button
            onClick={saveAll}
            disabled={savingAll}
            style={{
              background: savingAll ? 'var(--accent3)' : 'color-mix(in srgb, var(--ochre) 20%, transparent)',
              border: '1px solid color-mix(in srgb, var(--ochre) 40%, transparent)',
              borderRadius: '3px',
              color: savingAll ? 'var(--ink-faint)' : 'var(--ochre)',
              padding: '5px 14px',
              fontSize: '15px',
              fontWeight: 700,
              cursor: savingAll ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {savingAll ? 'Saving...' : 'Save All'}
          </button>
        </div>

        {activeCampaign && (
          <RuleSuggestionBar
            campaignSlug={activeCampaign.slug}
            suggestions={ruleSuggestions}
            onDismiss={s => setRuleSuggestions(prev => prev.filter(p => p !== s))}
            onApplied={() => { try { onTranscriptChange?.() } catch (_) {} }}
            floating
          />
        )}

        {displayLines.map((rawLine, lineIdx) => {
          const m = rawLine.match(/^\*\*\[([^\]]+)\] ([^:]+):\*\* (.*)$/)
          const isEditing = editingLineIdx === lineIdx
          const isPending = pendingLines.has(lineIdx)

          return (
            <div
              key={lineIdx}
              data-line-idx={lineIdx}
              onMouseEnter={() => setHoveredLineIdx(lineIdx)}
              onMouseLeave={() => setHoveredLineIdx(null)}
              style={{
                display: 'flex',
                gap: '8px',
                padding: '3px 6px',
                alignItems: 'flex-start',
                borderRadius: '3px',
                background: isEditing ? 'color-mix(in srgb, var(--ochre) 8%, transparent)' : isPending ? 'color-mix(in srgb, var(--ochre) 5%, transparent)' : 'transparent',
                position: 'relative',
              }}
            >
              {/* Line number */}
              <span style={{
                fontSize: '13px',
                color: 'var(--rule-strong)',
                fontVariantNumeric: 'lining-nums tabular-nums',
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
                  onBlur={() => { if (!savingLine) saveLine(lineIdx, editingValue) }}
                  disabled={savingLine}
                  style={{
                    flex: 1,
                    background: 'var(--bg-surface)',
                    border: '1px solid color-mix(in srgb, var(--ochre) 40%, transparent)',
                    borderRadius: '4px',
                    color: 'var(--ink)',
                    padding: '2px 8px',
                    fontSize: '15px',
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
                  onMouseEnter={e => (e.currentTarget.style.background = 'color-mix(in srgb, var(--ink) 3%, transparent)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span className="transcript-ts" style={{ flexShrink: 0, width: '64px', cursor: 'text' }}>
                    {m[1]}
                  </span>
                  <span style={{ fontSize: '18px', color: 'var(--ink)', lineHeight: 1.55 }}>
                    <span className="speaker-name" style={{ marginRight: '0.45em' }}>{m[2].trim()}</span>
                    {m[3]}
                  </span>
                </div>
              ) : rawLine.startsWith('#') ? (
                <div
                  onClick={() => { setEditingLineIdx(lineIdx); setEditingValue(rawLine) }}
                  style={{ flex: 1, cursor: 'text', fontSize: '17px', fontWeight: 700, color: 'var(--ink)', paddingTop: '2px' }}
                >
                  {rawLine.replace(/^#+\s*/, '')}
                </div>
              ) : rawLine.trim() === '' ? (
                <div style={{ flex: 1, height: '8px' }} />
              ) : (
                <div
                  onClick={() => { setEditingLineIdx(lineIdx); setEditingValue(rawLine) }}
                  style={{ flex: 1, cursor: 'text', fontSize: '15px', color: 'var(--ink-faint)', paddingTop: '2px' }}
                >
                  {rawLine || '\u00a0'}
                </div>
              )}
              {isPending && (
                <span style={{
                  flexShrink: 0, alignSelf: 'center',
                  fontSize: '15px',
                  color: 'var(--ochre)', whiteSpace: 'nowrap',
                }}>
                  sent to the DM for review
                </span>
              )}
              {/* Add line button — shows on hover */}
              <button
                onClick={() => insertLineAfter(lineIdx)}
                title="Insert line below"
                style={{
                  flexShrink: 0,
                  alignSelf: 'center',
                  background: 'transparent',
                  border: '1px solid color-mix(in srgb, var(--gilt) 40%, transparent)',
                  borderRadius: '4px',
                  color: 'var(--gilt-ink)',
                  fontSize: '16px',
                  lineHeight: 1,
                  width: '20px',
                  height: '20px',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: hoveredLineIdx === lineIdx ? 1 : 0,
                  transition: 'opacity 0.1s',
                  pointerEvents: hoveredLineIdx === lineIdx ? 'auto' : 'none',
                }}
              >
                +
              </button>
            </div>
          )
        })}
      </div>
    )
  }

  // ── Read mode rendering ──────────────────────────────────────────────────
  // (parsedLines, visibleLines, activeIdx are computed via useMemo above)
  const visible = visibleLines

  const highlight = (line: ParsedLine) => {
    const text = line.text || ''
    const marks: Mark[] = showConfidence
      ? lowConfRanges(text, lowConfWordsFor(confidenceIdx, line.timestamp, line.speaker))
      : []
    if (search) {
      const idx = text.toLowerCase().indexOf(searchLower)
      if (idx >= 0) marks.push({ start: idx, end: idx + search.length, search: true })
    }
    return renderMarked(text, marks)
  }

  // Silences: the gap between two lines' start times, minus how long the
  // first one plausibly took to say (~2.7 words/s). Only real pauses open a
  // "time passes" break; a long speech doesn't.
  const silenceBefore = (i: number): boolean => {
    if (search) return false
    const cur = visible[i]
    let j = i - 1
    while (j >= 0 && visible[j].type !== 'speech') j--
    if (j < 0 || cur.type !== 'speech' || !cur.timestamp || !visible[j].timestamp) return false
    const prev = visible[j]
    const spoken = (prev.text ?? '').split(/\s+/).filter(Boolean).length / 2.7
    const gap = parseTimestampToSeconds(cur.timestamp) - parseTimestampToSeconds(prev.timestamp!) - spoken
    return gap >= SILENCE_BREAK_SECONDS
  }

  return (
    <div ref={pageRef} style={{ position: 'relative', maxWidth: '900px' }}>
      {ribbonTs && !search && (
        <div className="journal-ribbon" style={{ right: '-72px' }}>
          <button type="button" onClick={continueReading} title="Jump back to where you stopped reading">
            Continue from {ribbonTs}
          </button>
          <button type="button" className="dismiss" onClick={() => setRibbonTs(null)} aria-label="Dismiss bookmark">
            <CloseIcon size={13} />
          </button>
        </div>
      )}
      {visible.map((line, i) => {
        const isActive = i === activeIdx
        const isTarget = line.type === 'speech' && line.timestamp === targetTimestamp
        const isFlash = line.type === 'speech' && line.timestamp === flashTimestamp

        if (line.type === 'heading') {
          // The "# Session Transcript" title just repeats the entry heading above.
          if (/^#\s*session transcript\s*$/i.test(line.raw.trim())) return null
          return (
            <h2 key={i} data-line-idx={line.lineIdx ?? i} className="sc" style={{ fontSize: '20px', color: 'var(--rubric)', margin: '24px 0 8px 96px' }}>
              {line.raw.replace(/^#+\s*/, '')}
            </h2>
          )
        }
        if (line.type === 'speech') {
          const tsSeconds = line.timestamp ? parseTimestampToSeconds(line.timestamp) : null
          const who = splitSpeaker(line.speaker)
          return (
            <React.Fragment key={i}>
              {silenceBefore(i) && (
                <div className="time-passes" style={{ marginLeft: 'calc(var(--ts-col, 78px) + var(--ts-gap, 18px))' }} aria-hidden>a few moments pass</div>
              )}
              <div
                data-line-idx={line.lineIdx ?? i}
                data-ts={line.timestamp}
                className="transcript-line"
                ref={el => {
                  if (isActive) activeLineRef.current = el
                  if (isTarget) targetLineRef.current = el
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'var(--ts-col, 78px) minmax(0, 1fr)',
                  columnGap: 'var(--ts-gap, 18px)',
                  padding: '4px 0',
                  background: isFlash
                    ? 'var(--highlighter)'
                    : isActive
                    ? 'linear-gradient(90deg, color-mix(in srgb, var(--gilt) 16%, transparent), transparent 70%)'
                    : 'transparent',
                  boxShadow: isActive ? 'inset 2px 0 0 var(--gilt)' : 'none',
                  transition: 'background 0.4s',
                }}
              >
                {onSeek && tsSeconds !== null ? (
                  <button
                    onClick={() => onSeek(tsSeconds, line.speaker)}
                    title={`Play from ${line.timestamp}`}
                    className="transcript-ts"
                    style={{ color: isActive ? 'var(--gilt-ink)' : undefined }}
                  >
                    {line.timestamp}
                  </button>
                ) : (
                  <span className="transcript-ts">{line.timestamp}</span>
                )}
                <p style={{ margin: 0, fontSize: '19px', lineHeight: 1.55, color: 'var(--ink)', maxWidth: '70ch' }}>
                  {who.name && <span className="speaker-name" style={{ marginRight: '0.4em' }}>{who.name}</span>}
                  {who.player && <span className="speaker-player" style={{ marginRight: '0.5em' }}>{who.player}</span>}
                  {highlight(line)}
                  {canQuote && (() => {
                    const saved = !!quoteFor(line)
                    const next = visible.slice(i + 1).find(l => l.type === 'speech')
                    return (
                      <button
                        type="button"
                        className={'quote-toggle' + (saved ? ' saved' : '')}
                        onClick={() => toggleQuote(line, next?.timestamp)}
                        aria-label={saved ? 'Remove from quotes' : 'Save this line as a quote'}
                        title={saved ? 'Saved to Quotes (click to remove)' : 'Save to Quotes'}
                      >
                        <QuoteIcon size={15} filled={saved} />
                      </button>
                    )
                  })()}
                </p>
              </div>
            </React.Fragment>
          )
        }
        return null
      })}
    </div>
  )
}

// "[1:15:57]" / "[09:41]" citations in a summary -> links into the transcript.
const CITATION_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)\](?!\()/g

function MarkdownView({ content, emptyMsg, onJump }: { content: string | null; emptyMsg: string; onJump?: (seconds: number) => void }) {
  if (!content) {
    return (
      <div style={{ color: 'var(--ink-faint)', textAlign: 'center', paddingTop: '60px' }}>
        {emptyMsg}
      </div>
    )
  }
  return (
    <div style={{ maxWidth: '820px', color: 'var(--ink)', fontSize: '17px', lineHeight: 1.7 }}>
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            const t = href?.match(/^#t=([\d:]+)$/)
            if (t && onJump) {
              return (
                <button type="button" className="citation" onClick={() => onJump(parseTimestampToSeconds(t[1]))}
                  title={`Open the transcript at ${t[1]} and play`}>
                  {children}
                </button>
              )
            }
            return <a href={href} target="_blank" rel="noreferrer">{children}</a>
          },
          h1: ({ children }) => <h1 style={{ color: 'var(--ink)', fontSize: '22px', marginBottom: '12px' }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ color: 'var(--ink)', fontSize: '18px', marginTop: '24px', marginBottom: '8px' }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ color: 'var(--ink)', fontSize: '17px', marginTop: '16px', marginBottom: '6px' }}>{children}</h3>,
          p: ({ children }) => <p style={{ marginBottom: '12px' }}>{children}</p>,
          li: ({ children }) => <li style={{ marginBottom: '4px' }}>{children}</li>,
          strong: ({ children }) => <strong style={{ color: 'var(--ink)' }}>{children}</strong>,
          code: ({ children }) => (
            <code style={{ background: 'var(--bg-elevated)', borderRadius: '4px', padding: '2px 5px', fontSize: '15px' }}>
              {children}
            </code>
          ),
        }}
      >
        {onJump ? content.replace(CITATION_RE, '[$1](#t=$1)') : content}
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
  onJump,
}: {
  onJump?: (seconds: number) => void
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
      <div style={{ color: 'var(--ink-faint)', textAlign: 'center', paddingTop: '60px' }}>
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
            fontSize: '14px', fontWeight: 600, color: 'var(--ochre)',
            background: 'color-mix(in srgb, var(--ochre) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--ochre) 30%, transparent)',
            borderRadius: '3px', padding: '3px 10px',
          }}>
            Submitted for DM review
          </span>
        )}
        <div style={{ flex: 1 }} />
        {!editMode ? (
          <button
            onClick={enterEdit}
            style={{
              background: 'transparent', border: '1px solid var(--accent3)', borderRadius: '3px',
              color: 'var(--ink-faint)', padding: '6px 12px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Edit {endpoint === 'summary' ? 'Summary' : 'Wiki'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '8px' }}>
            <span style={{ fontSize: '14px', color: requiresApproval ? 'var(--ochre)' : 'var(--ink-faint)', alignSelf: 'center' }}>
              {requiresApproval ? 'Changes will be submitted for DM review' : 'Changes save directly'}
            </span>
            <button
              onClick={() => setEditMode(false)}
              style={{
                background: 'transparent', border: '1px solid var(--accent3)', borderRadius: '3px',
                color: 'var(--ink-faint)', padding: '5px 12px', fontSize: '15px', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              style={{
                background: requiresApproval ? 'color-mix(in srgb, var(--ochre) 15%, transparent)' : 'color-mix(in srgb, var(--moss) 15%, transparent)',
                border: `1px solid ${requiresApproval ? 'color-mix(in srgb, var(--ochre) 40%, transparent)' : 'color-mix(in srgb, var(--moss) 40%, transparent)'}`,
                borderRadius: '3px',
                color: requiresApproval ? 'var(--ochre)' : 'var(--moss)',
                padding: '5px 14px', fontSize: '15px', fontWeight: 700,
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
            width: '100%', minHeight: '500px', background: 'var(--bg-surface)',
            border: '1px solid color-mix(in srgb, var(--ochre) 30%, transparent)', borderRadius: '3px',
            color: 'var(--ink)', padding: '16px', fontSize: '16px',
            fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
      ) : (
        <MarkdownView content={content} emptyMsg={emptyMsg} onJump={onJump} />
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
    fontSize: '15px',
    lineHeight: '1.6',
  }

  const renderWords = (parts: WordDiffPart[], side: 'raw' | 'corr') => {
    const highlightBg = side === 'raw' ? 'color-mix(in srgb, var(--rubric) 25%, transparent)' : 'color-mix(in srgb, var(--moss) 25%, transparent)'
    const highlightColor = side === 'raw' ? 'var(--rubric)' : 'var(--moss)'
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
            background: showDiff ? 'color-mix(in srgb, var(--rubric) 20%, transparent)' : 'color-mix(in srgb, var(--page-sunk) 80%, transparent)',
            border: `1px solid ${showDiff ? 'color-mix(in srgb, var(--rubric) 50%, transparent)' : 'var(--accent3)'}`,
            borderRadius: '3px',
            color: showDiff ? 'var(--accent-text)' : 'var(--ink-faint)',
            padding: '6px 14px',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {showDiff ? 'Hide Diff' : 'Show Diff'}
        </button>

        {showDiff && rawContent != null && (
          <>
            <span style={{ fontSize: '15px', color: 'var(--ink-faint)' }}>
              <span style={{ color: changedCount > 0 ? 'var(--accent-text)' : 'var(--ink-faint)', fontWeight: 700 }}>{changedCount}</span>
              {' '}line{changedCount !== 1 ? 's' : ''} changed out of{' '}
              <span style={{ fontWeight: 700, color: 'var(--ink-soft)' }}>{totalLines}</span> total
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '15px', color: 'var(--ink-soft)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={changedLinesOnly}
                onChange={e => setChangedLinesOnly(e.target.checked)}
                style={{ accentColor: 'var(--accent)' }}
              />
              Changed lines only
            </label>
          </>
        )}
      </div>

      {/* Diff panels */}
      {showDiff && (
        <div style={{
          border: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)',
          borderRadius: '3px',
          overflow: 'hidden',
          height: '400px',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {diffLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--ink-faint)', gap: '8px' }}>
              <SpinnerIcon size={16} /> Loading diff…
            </div>
          ) : rawContent == null ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--ink-faint)' }}>
              No transcript data available.
            </div>
          ) : (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Left panel — Raw */}
              <div style={panelStyle}>
                <div style={{
                  padding: '6px 10px',
                  background: 'color-mix(in srgb, var(--rubric) 8%, transparent)',
                  borderBottom: '1px solid color-mix(in srgb, var(--rubric) 20%, transparent)',
                  borderRight: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)',
                  fontSize: '14px',
                  fontWeight: 700,
                  color: 'var(--rubric)',
                  letterSpacing: '0.04em', fontVariant: 'small-caps',
                  flexShrink: 0,
                }}>
                  Raw Whisper output
                </div>
                <div
                  ref={leftRef}
                  onScroll={() => syncScroll('left')}
                  style={{ ...scrollAreaStyle, borderRight: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)', background: 'color-mix(in srgb, var(--rubric) 2%, transparent)' }}
                >
                  {displayItems.map((item, idx) =>
                    item.type === 'separator' ? (
                      <div key={idx} style={{ padding: '2px 8px', color: 'var(--ink-faint)', fontSize: '14px', background: 'var(--page-sunk)', borderTop: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)' }}>
                        …  {item.skipped} line{item.skipped !== 1 ? 's' : ''} hidden
                      </div>
                    ) : (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          gap: '0',
                          padding: '0 8px',
                          background: item.hasChanges ? 'color-mix(in srgb, var(--rubric) 7%, transparent)' : 'transparent',
                          opacity: item.hasChanges ? 1 : 0.45,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        <span style={{ color: 'var(--rule-strong)', minWidth: '36px', userSelect: 'none', paddingRight: '8px', textAlign: 'right', flexShrink: 0 }}>
                          {item.lineNum}
                        </span>
                        <span style={{ color: 'var(--ink)' }}>
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
                  background: 'color-mix(in srgb, var(--moss) 8%, transparent)',
                  borderBottom: '1px solid color-mix(in srgb, var(--moss) 20%, transparent)',
                  fontSize: '14px',
                  fontWeight: 700,
                  color: 'var(--moss)',
                  letterSpacing: '0.04em', fontVariant: 'small-caps',
                  flexShrink: 0,
                }}>
                  Corrected
                </div>
                <div
                  ref={rightRef}
                  onScroll={() => syncScroll('right')}
                  style={{ ...scrollAreaStyle, background: 'color-mix(in srgb, var(--moss) 2%, transparent)' }}
                >
                  {displayItems.map((item, idx) =>
                    item.type === 'separator' ? (
                      <div key={idx} style={{ padding: '2px 8px', color: 'var(--ink-faint)', fontSize: '14px', background: 'var(--page-sunk)', borderTop: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)' }}>
                        …  {item.skipped} line{item.skipped !== 1 ? 's' : ''} hidden
                      </div>
                    ) : (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          gap: '0',
                          padding: '0 8px',
                          background: item.hasChanges ? 'color-mix(in srgb, var(--moss) 7%, transparent)' : 'transparent',
                          opacity: item.hasChanges ? 1 : 0.45,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        <span style={{ color: 'var(--rule-strong)', minWidth: '36px', userSelect: 'none', paddingRight: '8px', textAlign: 'right', flexShrink: 0 }}>
                          {item.lineNum}
                        </span>
                        <span style={{ color: 'var(--ink)' }}>
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
      <div style={{ color: 'var(--ink-faint)', fontSize: '16px' }}>
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
            borderBottom: '1px solid var(--rule)',
            opacity: dimmed ? 0.5 : 1,
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
              <svg aria-hidden width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                style={{ color: 'var(--ink-faint)', flexShrink: 0, visibility: item.examples.length > 0 ? 'visible' : 'hidden', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}>
                <path d="m9 6 6 6-6 6" />
              </svg>
              <span style={{ fontSize: '18px', flexShrink: 0 }}>
                <span style={{ color: 'var(--ink-faint)', textDecoration: 'line-through' }}>{item.original}</span>
                <span style={{ color: 'var(--ink-faint)', margin: '0 6px' }}>→</span>
                <span style={{ color: 'var(--ink)' }}>{item.replacement}</span>
              </span>
              <span style={{
                color: item.hit_count > 0 ? 'var(--moss)' : 'var(--ink-faint)',
                fontSize: '16px',
                flexShrink: 0,
              }}>
                {item.hit_count} {item.hit_count === 1 ? 'hit' : 'hits'}
              </span>
            </button>

            {isOpen && item.examples.length > 0 && (
              <div style={{
                padding: '6px 12px 10px 32px',
                borderTop: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}>
                {item.examples.map((ex, ei) => {
                  const arrow = ex.indexOf(' → ')
                  const before = arrow >= 0 ? ex.slice(0, arrow) : ex
                  const after = arrow >= 0 ? ex.slice(arrow + 3) : ''
                  return (
                    <div key={ei} style={{ fontSize: '14px', fontFamily: 'monospace', color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                      <ExampleLine text={before} word={item.original} color="var(--rubric)" />
                      {after && (
                        <>
                          <span style={{ color: 'var(--ink-faint)' }}> → </span>
                          <ExampleLine text={after} word={item.replacement} color="var(--moss)" />
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
    <div style={{ flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '0 48px 6px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          fontSize: '16px',
          color: 'var(--ink-soft)',
        }}
      >
        <svg aria-hidden width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .2s', color: 'var(--ink-faint)' }}>
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span>
          {speakers.length > 0 ? `${speakers.length} speaker${speakers.length !== 1 ? 's' : ''}` : 'Speakers'}
        </span>
        <span style={{ color: 'var(--ink-faint)' }}>rename who's who</span>
        {renameResult && <span style={{ fontSize: '14px', color: 'var(--moss)', marginLeft: '8px' }}>{renameResult}</span>}
      </button>

      {open && (
        <div style={{ padding: '0 48px 12px 68px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <p style={{ margin: '0 0 4px', fontSize: '15px', color: 'var(--ochre)' }}>
            Renaming edits this transcript directly. Re-transcribing the audio would bring the old names back.
          </p>
          {speakers.map(s => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="speaker-name" style={{ fontSize: '17px', minWidth: '200px' }}>
                {s.name}
              </span>
              <span style={{ fontSize: '14px', color: 'var(--ink-faint)' }}>{s.line_count} line{s.line_count !== 1 ? 's' : ''}</span>
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
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--accent3)',
                      borderRadius: '3px',
                      color: 'var(--ink)',
                      padding: '4px 8px',
                      fontSize: '15px',
                      outline: 'none',
                      width: '160px',
                    }}
                  />
                  <button
                    onClick={() => doRename(s.name)}
                    disabled={renaming}
                    style={{ background: 'color-mix(in srgb, var(--rubric) 20%, transparent)', border: '1px solid color-mix(in srgb, var(--rubric) 30%, transparent)', borderRadius: '3px', color: 'var(--accent-text)', padding: '4px 10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {renaming ? '...' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setEditingSpeaker(null); setNewName('') }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: '16px', textDecoration: 'underline', textUnderlineOffset: 3 }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setEditingSpeaker(s.name); setNewName(s.name); setRenameResult(null) }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: '16px', opacity: 0.7 }}
                  title="Rename speaker"
                >
                  Rename
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

function WikiView({ sessionName, wikiMarkdown, onRemerge, onWikiSaved, generating, generateLog, generateDone, onGenerate, notes, onNotesChange, onNotesBlur, notesSaving, analysisPending, onCancelAnalysis }: {
  sessionName: string
  wikiMarkdown: string | null
  onRemerge?: () => void
  onWikiSaved?: () => void
  generating: boolean
  generateLog: string[]
  generateDone: boolean
  onGenerate: () => void
  notes: string
  onNotesChange: (v: string) => void
  onNotesBlur: (v: string) => void
  notesSaving: boolean
  analysisPending?: boolean
  onCancelAnalysis?: () => void
}) {
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
    const load = async () => {
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
    load()
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
      setApplyOutput(data.output ?? data.detail ?? '(no output)')
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

  const reloadSuggestions = async () => {
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

  // When generation completes (generateDone flips to true), reload suggestions
  useEffect(() => {
    if (generateDone) reloadSuggestions()
  }, [generateDone])

  // Wiki edit toolbar (shown above both the suggestions panel and the markdown fallback)
  const wikiEditToolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
      {wikiPending && (
        <span style={{
          fontSize: '14px', fontWeight: 600, color: 'var(--ochre)',
          background: 'color-mix(in srgb, var(--ochre) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--ochre) 30%, transparent)',
          borderRadius: '3px', padding: '3px 10px',
        }}>
          Submitted for DM review
        </span>
      )}
      <div style={{ flex: 1 }} />
      {!wikiEditMode ? (
        <button
          onClick={() => { setWikiEditValue(wikiMarkdown ?? ''); setWikiPending(false); setWikiEditMode(true) }}
          style={{
            background: 'transparent', border: '1px solid var(--accent3)', borderRadius: '3px',
            color: 'var(--ink-faint)', padding: '6px 12px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Edit Wiki
        </button>
      ) : (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', color: requiresApproval ? 'var(--ochre)' : 'var(--ink-faint)' }}>
            {requiresApproval ? 'Will submit for DM review' : 'Saves directly'}
          </span>
          <button onClick={() => setWikiEditMode(false)} style={{ background: 'transparent', border: '1px solid var(--accent3)', borderRadius: '3px', color: 'var(--ink-faint)', padding: '5px 12px', fontSize: '15px', cursor: 'pointer' }}>Cancel</button>
          <button
            onClick={saveWikiEdit}
            disabled={wikiSaving}
            style={{
              background: requiresApproval ? 'color-mix(in srgb, var(--ochre) 15%, transparent)' : 'color-mix(in srgb, var(--moss) 15%, transparent)',
              border: `1px solid ${requiresApproval ? 'color-mix(in srgb, var(--ochre) 40%, transparent)' : 'color-mix(in srgb, var(--moss) 40%, transparent)'}`,
              borderRadius: '3px', color: requiresApproval ? 'var(--ochre)' : 'var(--moss)',
              padding: '5px 14px', fontSize: '15px', fontWeight: 700,
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
    return <div style={{ color: 'var(--ink-faint)', paddingTop: '60px', textAlign: 'center' }}>Loading wiki suggestions...</div>
  }

  if (!suggestions || suggestions.length === 0) {
    return (
      <div style={{ maxWidth: '820px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {wikiEditToolbar}
        {/* Generate button */}
        <GenerateWikiPanel
          generating={generating}
          generateLog={generateLog}
          generateDone={generateDone}
          onGenerate={onGenerate}
          notes={notes}
          onNotesChange={onNotesChange}
          onNotesBlur={onNotesBlur}
          notesSaving={notesSaving}
          analysisPending={analysisPending}
          onCancelAnalysis={onCancelAnalysis}
        />
        {wikiEditMode ? (
          <textarea
            value={wikiEditValue}
            onChange={e => setWikiEditValue(e.target.value)}
            style={{
              width: '100%', minHeight: '500px', background: 'var(--bg-surface)',
              border: '1px solid color-mix(in srgb, var(--ochre) 30%, transparent)', borderRadius: '3px',
              color: 'var(--ink)', padding: '16px', fontSize: '16px',
              fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        ) : (
          <MarkdownView content={wikiMarkdown} emptyMsg="No wiki suggestions yet. Use 'Generate' above to analyze the transcript." />
        )}
      </div>
    )
  }

  const unappliedCount = suggestions.filter(s => !appliedIds.has(s.id) && !skippedIds.has(s.id)).length

  return (
    <div style={{ maxWidth: '820px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {wikiEditToolbar}

      {/* Edit mode textarea — shown instead of suggestions */}
      {wikiEditMode && (
        <textarea
          value={wikiEditValue}
          onChange={e => setWikiEditValue(e.target.value)}
          style={{
            width: '100%', minHeight: '500px', background: 'var(--bg-surface)',
            border: '1px solid color-mix(in srgb, var(--ochre) 30%, transparent)', borderRadius: '3px',
            color: 'var(--ink)', padding: '16px', fontSize: '16px',
            fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
      )}

      {/* Compact action bar + generate + corrections — hidden while editing */}
      {!wikiEditMode && <>

      {/* Single toolbar row */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Apply buttons */}
        <button
          onClick={() => callApplyWiki('all', [])}
          disabled={applying}
          className="btn-primary"
        >
          Apply all to vault
        </button>
        {skippedIds.size > 0 && (
          <button
            onClick={() => callApplyWiki('skip', [...skippedIds])}
            disabled={applying}
            className="btn-secondary"
          >
            Apply selected ({unappliedCount}/{suggestions.length})
          </button>
        )}
        {applying && <span style={{ fontSize: '14px', color: 'var(--ink-faint)' }}>Applying…</span>}


        {/* Generate button */}
        <button
          onClick={onGenerate}
          disabled={generating}
          className="btn-ghost"
          style={{ whiteSpace: 'nowrap' }}
        >
          {generating ? 'Generating…' : generateDone ? 'Generate again' : 'Generate suggestions'}
        </button>

        {/* Import corrections button — inline */}
        {hasProperNounCorrections && (
          <button
            onClick={doImportCorrections}
            disabled={importing}
            className="btn-ghost"
          >
            {importing ? 'Importing…' : 'Import name corrections'}
          </button>
        )}
        {importResult && (
          <span style={{ fontSize: '14px', color: 'var(--ink-faint)' }}>
            {importResult.imported.length > 0 && <span style={{ color: 'var(--moss)' }}>+{importResult.imported.length} imported</span>}
            {importResult.imported.length > 0 && importResult.skipped.length > 0 && <span>, </span>}
            {importResult.skipped.length > 0 && <span>{importResult.skipped.length} skipped</span>}
            {importResult.imported.length === 0 && importResult.skipped.length === 0 && <span>none found</span>}
          </span>
        )}
        {importResult && importResult.imported.length > 0 && onRemerge && (
          <button
            onClick={onRemerge}
            className="btn-ghost"
          >
            Apply corrections
          </button>
        )}

        {/* Counts pushed to right */}
        <span style={{ fontSize: '14px', color: 'var(--rule-strong)', marginLeft: 'auto' }}>
          {suggestions.length} suggestions
          {appliedIds.size > 0 && <span style={{ color: 'var(--moss)' }}>, {appliedIds.size} applied</span>}
          {skippedIds.size > 0 && <span style={{ color: 'var(--ink-faint)' }}>, {skippedIds.size} skipped</span>}
        </span>
      </div>

      {/* Special instructions — collapsible */}
      <SpecialInstructionsRow
        notes={notes}
        onNotesChange={onNotesChange}
        onNotesBlur={onNotesBlur}
        notesSaving={notesSaving}
        generating={generating}
        generateLog={generateLog}
      />

      {/* Corrections pills — collapsible */}
      {hasProperNounCorrections && (() => {
        if (!wikiMarkdown) return null
        const sectionStart = wikiMarkdown.indexOf('Proper Noun Corrections')
        if (sectionStart < 0) return null
        const sectionText = wikiMarkdown.slice(sectionStart)
        const lines = sectionText.split('\n')
        const corrections: Array<{wrong: string; right: string}> = []
        for (const line of lines.slice(1)) {
          if (line.startsWith('#')) break
          const arrow = line.indexOf('→')
          if (arrow < 0) continue
          const wrongs = line.slice(0, arrow).replace(/^[-\s]+/, '').split(/\s*\/\s*/)
          const right = line.slice(arrow + 1).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\(.*?\)/g, '').replace(/"/g, '').trim()
          if (!right) continue
          for (const w of wrongs) {
            const clean = w.replace(/"/g, '').trim()
            if (clean) corrections.push({ wrong: clean, right })
          }
        }
        if (corrections.length === 0) return null
        return (
          <p style={{ margin: 0, fontSize: '17px', lineHeight: 1.7 }}>
            <span style={{ color: 'var(--ink-faint)', marginRight: 8 }}>Suggested name fixes:</span>
            {corrections.map((c, i) => (
              <span key={i} style={{ whiteSpace: 'nowrap', marginRight: 14 }}>
                <span style={{ color: 'var(--ink-faint)', textDecoration: 'line-through' }}>{c.wrong}</span>
                <span style={{ color: 'var(--ink-faint)', margin: '0 5px' }}>→</span>
                <span style={{ color: 'var(--ink)' }}>{c.right}</span>
              </span>
            ))}
          </p>
        )
      })()}



      {/* Apply output */}
      {applyOutput !== null && (
        <pre style={{
          background: 'var(--page-sunk)',
          border: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)',
          borderRadius: '3px',
          padding: '12px 16px',
          fontSize: '14px',
          color: 'var(--ink-soft)',
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
              borderBottom: '1px solid var(--rule)',
              padding: '16px 0 14px',
              opacity: isSkipped ? 0.5 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '21px',
                color: isSkipped ? 'var(--ink-faint)' : 'var(--ink)',
                flex: '1 1 260px',
                textDecoration: isSkipped ? 'line-through' : 'none',
              }}>
                {s.title}
              </span>
              <span style={{ fontSize: '16px', color: 'var(--rubric)', flexShrink: 0 }}>
                {s.new_page ? `new page, ${s.section}` : s.section}
              </span>
            </div>

            {s.page && (
              <div style={{ fontSize: '15px', color: 'var(--ink-faint)', marginTop: '2px' }}>
                {s.page}
              </div>
            )}

            <ul style={{ margin: '8px 0 10px', padding: '0 0 0 1.1em', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {s.bullets.map((b, i) => (
                <li key={i} style={{ fontSize: '17px', color: 'var(--ink-soft)', lineHeight: 1.55, paddingLeft: '4px' }}>
                  {b.replace(/^-\s*/, '')}
                </li>
              ))}
            </ul>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {isApplied ? (
                <span style={{ color: 'var(--moss)', fontSize: '16px' }}>Applied to the vault</span>
              ) : (
                <>
                  <button
                    className="btn-secondary"
                    onClick={() => callApplyWiki('apply', [s.id])}
                    disabled={applying || isSkipped}
                    style={{ fontSize: '15px', padding: '3px 12px' }}
                  >
                    Apply
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => toggleSkip(s.id)}
                    disabled={applying}
                    style={{ fontSize: '15px', padding: '3px 12px' }}
                  >
                    {isSkipped ? 'Undo skip' : 'Skip'}
                  </button>
                </>
              )}
            </div>
          </div>
        )
      })}
      </>}
    </div>
  )
}

// ─── Special Instructions Row (collapsible) ──────────────────────────────────

function SpecialInstructionsRow({ notes, onNotesChange, onNotesBlur, notesSaving, generating, generateLog }: {
  notes: string
  onNotesChange?: (v: string) => void
  onNotesBlur?: (v: string) => void
  notesSaving?: boolean
  generating?: boolean
  generateLog?: string[]
}) {
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => { if (generating) setOpen(true) }, [generating])

  const hasNotes = notes.trim().length > 0

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '5px',
          color: hasNotes ? 'var(--ink-faint)' : 'var(--rule-strong)', fontSize: '14px', fontWeight: 600,
          padding: '2px 0',
        }}
      >
        <Chevron open={open} />
        <span>Special instructions</span>
        {hasNotes && !open && (
          <span style={{ color: 'var(--ink-faint)', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '320px' }}>
            — {notes.trim().slice(0, 60)}{notes.trim().length > 60 ? '…' : ''}
          </span>
        )}
        {notesSaving && <span style={{ color: 'var(--rule-strong)', fontWeight: 400 }}>saving…</span>}
      </button>
      {open && (
        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <textarea
            value={notes}
            onChange={e => onNotesChange?.(e.target.value)}
            onBlur={e => onNotesBlur?.(e.target.value)}
            placeholder="e.g. Aella and Danny are on the same mic — attribute ambiguous lines to Danny unless clearly in character."
            rows={3}
            style={{
              width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--accent3)',
              borderRadius: '3px', color: 'var(--ink)', padding: '8px 10px',
              fontSize: '15px', lineHeight: 1.5, resize: 'vertical',
              outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
          {generating && generateLog && generateLog.length > 0 && (
            <pre style={{
              background: 'var(--page-sunk)', border: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)', borderRadius: '3px',
              padding: '8px 12px', fontSize: '14px', color: 'var(--ink-soft)',
              fontFamily: 'monospace', whiteSpace: 'pre-wrap',
              maxHeight: '140px', overflowY: 'auto', margin: 0,
            }}>
              {generateLog.join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Generate Wiki Panel ──────────────────────────────────────────────────────

function GenerateWikiPanel({
  generating,
  generateLog,
  generateDone,
  onGenerate,
  compact = false,
  notes = '',
  onNotesChange,
  onNotesBlur,
  notesSaving = false,
  analysisPending = false,
  onCancelAnalysis,
}: {
  generating: boolean
  generateLog: string[]
  generateDone: boolean
  onGenerate: () => void
  compact?: boolean
  notes?: string
  onNotesChange?: (v: string) => void
  onNotesBlur?: (v: string) => void
  notesSaving?: boolean
  analysisPending?: boolean
  onCancelAnalysis?: () => void
}) {
  return (
    <div style={{
      borderBottom: '1px solid var(--rule)',
      padding: compact ? '4px 0 12px' : '4px 0 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {!compact && (
          <div style={{ flex: 1 }}>
            <div className="sc" style={{ fontSize: '19px', fontWeight: 600, color: 'var(--rubric)', marginBottom: '2px' }}>
              Summary and wiki suggestions
            </div>
            <div style={{ fontSize: '16px', color: 'var(--ink-soft)' }}>
              Analyze the transcript with Claude via the worker. Add any notes below to guide the analysis.
            </div>
          </div>
        )}
        {compact && (
          <span style={{ fontSize: '17px', color: 'var(--ink-soft)', flex: 1 }}>Re-read the transcript and rewrite the summary (the worker runs the analysis)</span>
        )}
        {analysisPending && !generating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '16px', color: 'var(--ochre)' }}>
              <SpinnerIcon size={14} /> The worker is analyzing…
            </span>
            <button
              onClick={onCancelAnalysis}
              title="Cancel analysis job"
              style={{
                background: 'color-mix(in srgb, var(--rubric) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--rubric) 30%, transparent)',
                borderRadius: '3px',
                color: 'var(--rubric)',
                padding: '4px 10px',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Cancel
            </button>
          </div>
        )}
        <button
          onClick={onGenerate}
          disabled={generating || analysisPending}
          className={compact ? 'btn-ghost' : 'btn-primary'}
          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {generating ? 'Generating…' : generateDone ? 'Generate again' : 'Generate'}
        </button>
      </div>

      {/* Notes + log — only in full (non-compact) mode */}
      {!compact && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label className="sc" style={{ fontSize: '17px', color: 'var(--ink-soft)' }}>
                Special instructions
              </label>
              {notesSaving && <span style={{ fontSize: '13px', color: 'var(--ink-faint)' }}>saving…</span>}
            </div>
            <textarea
              value={notes}
              onChange={e => onNotesChange?.(e.target.value)}
              onBlur={e => onNotesBlur?.(e.target.value)}
              placeholder="e.g. Aella and Danny are on the same mic — attribute ambiguous lines to Danny unless clearly in character."
              rows={3}
              style={{
                width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--accent3)',
                borderRadius: '3px', color: 'var(--ink)', padding: '8px 10px',
                fontSize: '15px', lineHeight: 1.5, resize: 'vertical',
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>
          {generating && generateLog.length > 0 && (
            <pre style={{
              background: 'var(--page-sunk)', border: '1px solid color-mix(in srgb, var(--accent3) 50%, transparent)', borderRadius: '3px',
              padding: '10px 14px', fontSize: '14px', color: 'var(--ink-soft)',
              fontFamily: 'monospace', whiteSpace: 'pre-wrap',
              maxHeight: '180px', overflowY: 'auto', margin: 0,
            }}>
              {generateLog.join('\n')}
            </pre>
          )}
        </>
      )}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--ink-faint)', paddingTop: '20px', justifyContent: 'center' }}>
          <SpinnerIcon size={18} />
          Analyzing corrections...
        </div>
      )}

      {!loading && !report && (
        <div style={{ color: 'var(--ink-faint)', textAlign: 'center', paddingTop: '20px' }}>
          No transcript yet. Run the pipeline to generate one.
        </div>
      )}

      {!loading && report && (
      <div style={{ maxWidth: '820px', display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* Stats: one ruled sentence */}
      <p style={{ margin: 0, paddingBottom: '12px', borderBottom: '1px solid var(--rule)', fontSize: '18px', color: 'var(--ink-soft)' }}>
        {stats.total_corrections} correction rule{stats.total_corrections !== 1 ? 's' : ''} fixed{' '}
        <span style={{ color: 'var(--moss)' }}>{stats.total_hits} word{stats.total_hits !== 1 ? 's' : ''}</span> in this session
        {stats.hallucination_count > 0
          ? <>, and <span style={{ color: 'var(--ochre)' }}>{stats.hallucination_count} line{stats.hallucination_count !== 1 ? 's' : ''}</span> look like Whisper hallucinations.</>
          : '. No lines look like Whisper hallucinations.'}
      </p>

      {/* Corrections Applied */}
      <section>
        <h3 className="sc" style={{ margin: '0 0 6px', fontSize: '19px', fontWeight: 600, color: 'var(--rubric)' }}>
          Corrections applied
        </h3>
        <CorrectionList items={corrections_applied} label="Corrections" />
      </section>

      {/* Patterns Applied */}
      <section>
        <h3 className="sc" style={{ margin: '0 0 6px', fontSize: '19px', fontWeight: 600, color: 'var(--rubric)' }}>
          Patterns applied
        </h3>
        <CorrectionList items={patterns_applied} label="Patterns" />
      </section>

      {/* Possible Hallucinations */}
      <section>
        <h3 className="sc" style={{ margin: '0 0 6px', fontSize: '19px', fontWeight: 600, color: 'var(--rubric)' }}>
          Possible hallucinations
        </h3>
        {hallucinations.length === 0 ? (
          <div style={{ color: 'var(--ink-faint)', fontSize: '16px' }}>
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
                  background: 'color-mix(in srgb, var(--ochre) 5%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--ochre) 15%, transparent)',
                  borderRadius: '3px',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'color-mix(in srgb, var(--ochre) 10%, transparent)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'color-mix(in srgb, var(--ochre) 5%, transparent)')}
              >
                <span style={{ fontVariantNumeric: 'lining-nums tabular-nums', fontSize: '15px', color: 'var(--ochre)', flexShrink: 0 }}>
                  {h.timestamp}
                </span>
                <span style={{ fontSize: '14px', color: 'var(--ink-soft)', flexShrink: 0 }}>
                  {h.speaker}
                </span>
                <span style={{ fontSize: '16px', color: 'var(--ink)', flex: 1 }}>
                  "{h.text}"
                </span>
                <span style={{
                  background: 'color-mix(in srgb, var(--ochre) 15%, transparent)',
                  color: 'var(--ochre)',
                  borderRadius: '999px',
                  padding: '1px 8px',
                  fontSize: '13px',
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

// ─── Unsure-word walkthrough ──────────────────────────────────────────────────
// Steps through words Whisper decoded with low confidence, oldest first: plays
// the moment, shows the word in its line, and lets the reviewer keep it or fix
// it (optionally also saving the fix as a correction rule).

const WALK_THRESHOLD = 0.5
const LINE_PARTS = /^(\*\*\[([^\]]+)\] ([^:]+):\*\* )(.*)$/

interface WalkItem { lineIdx: number; ts: string; seconds: number; speaker: string; word: string; prob: number }

function wordRegex(word: string) {
  return new RegExp(`(^|[^A-Za-z0-9'])(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![A-Za-z0-9'])`, 'i')
}

function buildWalkItems(transcript: string, confidence: ConfidenceMap | null): WalkItem[] {
  if (!confidence) return []
  const lines = transcript.split('\n')
  const byTs = new Map<string, number[]>()
  lines.forEach((l, i) => {
    const m = l.match(LINE_PARTS)
    if (m) byTs.set(m[2], [...(byTs.get(m[2]) ?? []), i])
  })
  const items: WalkItem[] = []
  const seen = new Set<string>()
  for (const entry of confidence.lines) {
    const candidates = byTs.get(entry.ts) ?? []
    const lineIdx = candidates.find(i => lines[i].includes(`] ${entry.speaker}:**`)) ?? candidates[0]
    if (lineIdx === undefined) continue
    const m = lines[lineIdx].match(LINE_PARTS)!
    for (const w of entry.words) {
      if (w.prob >= WALK_THRESHOLD || w.word.length < 2) continue
      if (!wordRegex(w.word).test(m[4])) continue // already corrected since
      const key = `${lineIdx}|${w.word.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ lineIdx, ts: m[2], seconds: parseTimestampToSeconds(m[2]), speaker: m[3], word: w.word, prob: w.prob })
    }
  }
  return items.sort((a, b) => a.seconds - b.seconds || a.lineIdx - b.lineIdx)
}

function UnsureWalkthrough({
  items, transcript, sessionName, onClose, onShowLine, onPlay, onStop, onChanged,
}: {
  items: WalkItem[]
  transcript: string
  sessionName: string
  onClose: () => void
  onShowLine: (ts: string) => void
  onPlay: (from: number, until: number) => void
  onStop: () => void
  onChanged: () => void
}) {
  const apiUrl = useApiUrl()
  const { activeCampaign } = useCampaign()
  const { toast } = useToast()
  const [idx, setIdx] = useState(0)
  const [value, setValue] = useState(items[0]?.word ?? '')
  const [addRule, setAddRule] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fixed, setFixed] = useState(0)
  const lines = useMemo(() => transcript.split('\n'), [transcript])
  const item = items[idx]

  // Each stop: bring the line into view and play from just before it to the
  // next line (or 8s at most).
  useEffect(() => {
    if (!item) return
    setValue(item.word)
    setAddRule(false)
    onShowLine(item.ts)
    const next = items.slice(idx + 1).find(i => i.lineIdx !== item.lineIdx)?.seconds
    onPlay(Math.max(0, item.seconds - 0.5), Math.min(next ?? item.seconds + 8, item.seconds + 8))
  }, [idx])
  useEffect(() => () => onStop(), [])

  if (!item) {
    return (
      <div className="walkthrough" role="dialog" aria-label="Unsure words">
        <div style={{ fontSize: 19 }}>All {items.length} unsure words reviewed{fixed ? `, ${fixed} fixed` : ''}.</div>
        <button className="btn-primary" onClick={onClose} autoFocus>Done</button>
      </div>
    )
  }

  const text = lines[item.lineIdx]?.match(LINE_PARTS)?.[4] ?? ''
  const hit = wordRegex(item.word).exec(text)
  const at = hit ? hit.index + hit[1].length : -1
  const before = at >= 0 ? text.slice(Math.max(0, at - 90), at) : text
  const after = at >= 0 ? text.slice(at + item.word.length, at + item.word.length + 90) : ''
  const changed = value.trim() !== '' && value.trim() !== item.word

  const advance = () => setIdx(i => i + 1)

  const applyFix = async () => {
    const m = lines[item.lineIdx]?.match(LINE_PARTS)
    if (!m || !changed) return
    const replacement = value.trim()
    const newText = m[4].replace(wordRegex(item.word), (_all, pre) => `${pre}${replacement}`)
    setBusy(true)
    try {
      const r = await fetch(apiUrl(`/sessions/${sessionName}/transcript/line/${item.lineIdx + 1}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: m[1] + newText }),
      })
      if (!r.ok) { toast('Could not save the fix', 'error'); return }
      if (r.status === 202) toast('Fix sent to the DM for review', 'info')
      lines[item.lineIdx] = m[1] + newText
      if (addRule && activeCampaign) {
        const n = await addCorrectionRule(activeCampaign.slug, item.word, replacement, sessionName)
        if (n === null) toast('Fixed, but the rule could not be saved', 'error')
        else if (n > 0) toast(`Rule saved: ${item.word} → ${replacement} (${n} more fixed)`, 'success')
      }
      setFixed(f => f + 1)
      onChanged()
      advance()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="walkthrough" role="dialog" aria-label="Unsure words"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="walkthrough-head">
        <span>Unsure word {idx + 1} of {items.length}</span>
        <span style={{ color: 'var(--ink-faint)' }}>at {item.ts}, Whisper was {Math.round(item.prob * 100)}% sure</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="entry-action" onClick={onClose} aria-label="Close walkthrough"><CloseIcon /></button>
      </div>
      <p className="walkthrough-line">
        <span className="speaker-name" style={{ marginRight: 6 }}>{splitSpeaker(item.speaker).name}</span>
        {before.length < at ? '…' : ''}{before}
        <mark className="search-hit">{at >= 0 ? text.slice(at, at + item.word.length) : item.word}</mark>
        {after}{at + item.word.length + 90 < text.length ? '…' : ''}
      </p>
      <form
        className="walkthrough-actions"
        onSubmit={e => { e.preventDefault(); if (changed) applyFix(); else advance() }}
      >
        <input
          autoFocus
          className="written-line"
          value={value}
          onChange={e => setValue(e.target.value)}
          aria-label={`Correct spelling of ${item.word}`}
          style={{ width: 200 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, color: 'var(--ink-soft)' }}>
          <input type="checkbox" checked={addRule} onChange={e => setAddRule(e.target.checked)} disabled={!changed}
            style={{ accentColor: 'var(--rubric)' }} />
          also save as a rule
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn-ghost" onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}>Back</button>
        <button type="button" className="btn-ghost"
          onClick={() => onPlay(Math.max(0, item.seconds - 0.5), item.seconds + 8)}>Play again</button>
        <button type="submit" className={changed ? 'btn-primary' : 'btn-secondary'} disabled={busy}>
          {changed ? 'Fix' : 'Keep'}
        </button>
      </form>
      <div style={{ fontSize: 14, color: 'var(--ink-faint)' }}>Enter keeps the word (or applies your fix). Esc closes.</div>
    </div>
  )
}

// ─── Stats tab: talk time per speaker ─────────────────────────────────────────

interface SessionStats {
  duration_seconds: number
  lines: number
  words: number
  speakers: { label: string; name: string; player: string; lines: number; words: number; seconds: number; share: number }[]
}

function SessionStatsPanel({ sessionName }: { sessionName: string }) {
  const apiUrl = useApiUrl()
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    fetch(apiUrl(`/sessions/${sessionName}/stats`))
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setStats)
      .catch(() => setFailed(true))
  }, [sessionName, apiUrl])

  if (failed) return <EmptyTabState title="Stats unavailable" message="The transcript couldn't be counted. Try reloading." />
  if (!stats) return <div className="skeleton" style={{ height: 200, maxWidth: 820 }} />

  return (
    <div style={{ maxWidth: '820px' }}>
      <p className="stats-sentence">
        {formatDuration(stats.duration_seconds)} at the table, {stats.words.toLocaleString()} words
        across {stats.lines.toLocaleString()} lines from {stats.speakers.length} speaker{stats.speakers.length !== 1 ? 's' : ''}.
      </p>
      <p style={{ margin: '0 0 28px', fontSize: 15, color: 'var(--ink-faint)' }}>
        Talk time is estimated from words spoken, at about 160 words a minute.
      </p>
      <BarList
        title="Talk time"
        valueHeader="Talk time"
        rows={stats.speakers.map(sp => ({
          key: sp.label,
          label: <><span className="speaker-name">{sp.name}</span>{sp.player && <span className="speaker-player" style={{ marginLeft: 6 }}>{sp.player}</span>}</>,
          labelText: sp.player ? `${sp.name} (${sp.player})` : sp.name,
          value: sp.seconds,
          display: `${formatDuration(sp.seconds)}, ${percent(sp.share)}`,
          details: [`${sp.words.toLocaleString()} words`, `${sp.lines.toLocaleString()} lines`],
        }))}
      />
    </div>
  )
}

// ─── Names tab: unknown / likely-misheard words ───────────────────────────────

interface UnknownWord {
  word: string
  count: number
  low_conf_count: number
  suggestion: string | null
  examples: { line: number; ts: string; speaker: string | null; text: string }[]
}

/** Mirrors unknown_words.ignore_key: one Ignore covers "Mario's" / "Mario" / "Marios". */
function ignoreKey(word: string): string {
  let w = word.trim().toLowerCase()
  if (w.endsWith("'s")) w = w.slice(0, -2)
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  return w
}

function UnknownWordsPanel({
  sessionName,
  canEdit,
  onJump,
  onRuleAdded,
}: {
  sessionName: string
  canEdit: boolean
  onJump: (timestamp: string) => void
  onRuleAdded: () => void
}) {
  const apiUrl = useApiUrl()
  const { activeCampaign } = useCampaign()
  const { toast } = useToast()
  const [words, setWords] = useState<UnknownWord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [showOther, setShowOther] = useState(false)
  const [ignored, setIgnored] = useState<string[]>([])
  const [showIgnored, setShowIgnored] = useState(false)

  useEffect(() => {
    let cancelled = false
    setWords(null)
    setError(null)
    fetch(apiUrl(`/sessions/${sessionName}/unknown-words`))
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(data => {
        if (cancelled) return
        setWords(data.words)
        setIgnored(data.ignored ?? [])
        setTargets(Object.fromEntries(data.words.map((w: UnknownWord) => [w.word, w.suggestion ?? ''])))
      })
      .catch(() => { if (!cancelled) setError('Could not scan this transcript.') })
    return () => { cancelled = true }
  }, [sessionName, apiUrl])

  const drop = (word: string) => setWords(prev => prev?.filter(w => w.word !== word) ?? null)

  const addRule = async (w: UnknownWord) => {
    const right = (targets[w.word] ?? '').trim()
    if (!right || !activeCampaign) return
    setBusy(w.word)
    try {
      const replaced = await addCorrectionRule(activeCampaign.slug, w.word, right, sessionName)
      if (replaced === null) { toast('Failed to add rule', 'error'); return }
      toast(`Rule added: ${w.word} → ${right} (${replaced} fixed in this session)`, 'success')
      drop(w.word)
      onRuleAdded()
    } finally {
      setBusy(null)
    }
  }

  const ignore = async (w: UnknownWord) => {
    setBusy(w.word)
    try {
      const r = await fetch(apiUrl('/config/ignored-words'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: w.word }),
      })
      if (!r.ok) { toast('Failed to ignore word', 'error'); return }
      const data = await r.json()
      setIgnored(data.ignored_words ?? [])
      const key = ignoreKey(w.word)
      setWords(prev => prev?.filter(x => ignoreKey(x.word) !== key) ?? null)
    } finally {
      setBusy(null)
    }
  }

  const unignore = async (word: string) => {
    setBusy(word)
    try {
      const r = await fetch(apiUrl(`/config/ignored-words/${encodeURIComponent(word)}`), { method: 'DELETE' })
      if (!r.ok) { toast('Failed to un-ignore word', 'error'); return }
      const data = await r.json()
      setIgnored(data.ignored_words ?? [])
      toast(`"${word}" will be flagged again on the next scan`, 'info')
    } finally {
      setBusy(null)
    }
  }

  const ignoredSection = ignored.length > 0 && (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <button onClick={() => setShowIgnored(v => !v)} aria-expanded={showIgnored} style={{
        display: 'flex', alignItems: 'center', gap: 2,
        background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
        fontSize: '16px', fontWeight: 600, color: 'var(--text-muted)',
      }}>
        <Chevron open={showIgnored} style={{ marginRight: 6 }} />Ignored in this campaign ({ignored.length})
      </button>
      {showIgnored && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {ignored.map(word => (
            <span key={word} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              fontSize: '15px', color: 'var(--text-secondary)',
              border: '1px solid var(--border-default)', borderRadius: '3px', padding: '2px 4px 2px 10px',
            }}>
              {word}
              {canEdit && (
                <button onClick={() => unignore(word)} disabled={busy === word}
                  aria-label={`Un-ignore ${word}`} title="Un-ignore"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 4px', display: 'flex' }}>
                  <CloseIcon size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </section>
  )

  if (error) return <EmptyTabState title="Scan failed" message={error} />
  if (!words) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '820px' }}>
        {[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: 48 }} />)}
      </div>
    )
  }

  const nearMisses = words.filter(w => w.suggestion)
  const other = words.filter(w => !w.suggestion)
  if (words.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '820px' }}>
        <EmptyTabState title="Nothing unrecognized" message="Every word is either ordinary English, a known campaign term, or ignored." />
        {ignoredSection}
      </div>
    )
  }

  const row = (w: UnknownWord) => (
    <div key={w.word} style={{
      display: 'flex', flexDirection: 'column', gap: '4px',
      padding: '12px 0', borderBottom: '1px solid var(--rule)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '20px', color: 'var(--ink)' }}>{w.word}</span>
        <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>×{w.count}</span>
        {w.low_conf_count > 0 && (
          <span className="lowconf-badge" title="Whisper flagged this word as low-confidence">
            unsure ×{w.low_conf_count}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {canEdit && (
          <>
            <span style={{ fontSize: '15px', color: 'var(--text-muted)' }}>→</span>
            <input
              value={targets[w.word] ?? ''}
              onChange={e => setTargets(prev => ({ ...prev, [w.word]: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') addRule(w) }}
              placeholder="Correct spelling"
              aria-label={`Correct spelling for ${w.word}`}
              style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '3px',
                color: 'var(--text-primary)', padding: '4px 8px', fontSize: '15px', width: '140px', outline: 'none',
              }}
            />
            <button className="btn-ghost" style={{ fontSize: '15px', padding: '3px 10px' }}
              disabled={busy === w.word || !(targets[w.word] ?? '').trim()} onClick={() => addRule(w)}>
              Add rule
            </button>
            <button className="btn-ghost" style={{ fontSize: '15px', padding: '3px 10px' }}
              disabled={busy === w.word} onClick={() => ignore(w)}
              title="It's spelled right: stop flagging it (and its plural/possessive) in every session of this campaign">
              Ignore
            </button>
          </>
        )}
      </div>
      {w.examples.map(ex => (
        <button key={ex.line} onClick={() => onJump(ex.ts)} className="unknown-word-example"
          title="Show in transcript">
          <span style={{ fontVariantNumeric: 'lining-nums tabular-nums', color: 'var(--text-muted)', flexShrink: 0 }}>{ex.ts}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {renderMarked(ex.text, (() => {
              const i = ex.text.toLowerCase().indexOf(w.word.toLowerCase())
              return i >= 0 ? [{ start: i, end: i + w.word.length, search: true }] : []
            })())}
          </span>
        </button>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '820px' }}>
      <p style={{ margin: 0, fontSize: '15px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Words in this transcript that aren't English and aren't in the campaign's vocabulary (vault index,
        correction targets, player names). Adding a rule fixes this session now and every future transcript.
      </p>
      {nearMisses.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-secondary)' }}>
            Close to a known name ({nearMisses.length})
          </h3>
          {nearMisses.map(row)}
        </section>
      )}
      {other.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button onClick={() => setShowOther(v => !v)} aria-expanded={showOther} style={{
            display: 'flex', alignItems: 'center', gap: 2,
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
            fontSize: '16px', fontWeight: 600, color: 'var(--text-secondary)',
          }}>
            <Chevron open={showOther} style={{ marginRight: 6 }} />Other unrecognized words ({other.length})
          </button>
          {showOther && other.map(row)}
        </section>
      )}
      {ignoredSection}
    </div>
  )
}

function EmptyTabState({ title, message }: { icon?: string; title: string; message: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240, textAlign: 'center', padding: '32px' }}>
      <div style={{ fontSize: 24, color: 'var(--ink)', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 17, color: 'var(--ink-soft)', maxWidth: 400, lineHeight: 1.55 }}>{message}</div>
    </div>
  )
}
