import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApiUrl, useCampaign } from '../CampaignContext'
import { useAuth } from '../AuthContext'
import { useToast } from '../Toast'

type SortKey = 'name' | 'date_added' | 'modified'

interface Session {
  name: string
  status: string
  has_transcript: boolean
  has_summary: boolean
  has_wiki: boolean
  created_at: string | null
  modified_at: string | null
}

interface TranscriptionJob {
  session_name: string
  status: string
  created_at: string | null
  error_message: string | null
}

const statusColors: Record<string, { bg: string; text: string; label: string }> = {
  complete:       { bg: 'rgba(34,197,94,0.15)',   text: '#4ade80', label: 'Complete' },
  has_transcript: { bg: 'rgba(124,108,252,0.15)', text: '#a78bfa', label: 'Has transcript' },
  transcribed:    { bg: 'rgba(59,130,246,0.15)',  text: '#60a5fa', label: 'Transcribed' },
  has_audio:      { bg: 'rgba(251,191,36,0.15)',  text: '#fbbf24', label: 'Has audio' },
  empty:          { bg: 'rgba(100,116,139,0.15)', text: '#64748b', label: 'Empty' },
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso + 'Z').getTime()
  const mins = Math.floor(ms / 60000)
  const hours = Math.floor(ms / 3600000)
  const days = Math.floor(ms / 86400000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(iso + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [renamingSession, setRenamingSession] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [dragOverSession, setDragOverSession] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [jobMap, setJobMap] = useState<Record<string, TranscriptionJob>>({})
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounters = useRef<Record<string, number>>({})
  const navigate = useNavigate()
  const apiUrl = useApiUrl()
  const { isLoggedIn, authEnabled } = useAuth()
  const { activeCampaign } = useCampaign()
  const { toast } = useToast()

  const loadJobs = async () => {
    if (!activeCampaign) return
    const r = await fetch(apiUrl(`/worker/jobs/all`))
    if (r.ok) {
      const jobs: TranscriptionJob[] = await r.json()
      const map: Record<string, TranscriptionJob> = {}
      for (const j of jobs) map[j.session_name] = j
      setJobMap(map)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(apiUrl('/sessions'))
      setSessions(await r.json())
      await loadJobs()
    } finally {
      setLoading(false)
    }
  }

  // Poll every 15s while any job is pending or claimed
  useEffect(() => {
    const hasActive = Object.values(jobMap).some(j => j.status === 'pending' || j.status === 'claimed')
    if (hasActive) {
      if (!pollTimerRef.current) {
        pollTimerRef.current = setInterval(loadJobs, 15000)
      }
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
    return () => {}
  }, [jobMap])

  useEffect(() => {
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current) }
  }, [])

  useEffect(() => { load() }, [apiUrl])

  const requestTranscription = async (sessionName: string) => {
    const r = await fetch(apiUrl(`/sessions/${sessionName}/transcribe`), { method: 'POST' })
    if (r.status === 409) {
      const data = await r.json()
      toast(`Already queued (status: ${data.status ?? data.detail?.status ?? 'pending'})`, 'warning')
      return
    }
    if (r.ok) {
      const job = await r.json()
      setJobMap(prev => ({ ...prev, [sessionName]: job }))
      toast('Transcription queued', 'success')
    } else {
      toast('Failed to queue transcription', 'error')
    }
  }

  const requestWikiSummary = async (sessionName: string) => {
    const r = await fetch(apiUrl('/pipeline/run'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionName, transcribe_only: false, wiki_only: true }),
    })
    if (r.status === 409) {
      toast('Pipeline is already running — wait for it to finish', 'warning')
      return
    }
    if (r.ok) {
      toast('Wiki summary generation started', 'success')
    } else {
      toast('Failed to start wiki summary generation', 'error')
    }
  }

  const createSession = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const r = await fetch(apiUrl('/sessions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (r.ok) {
        setNewName('')
        load()
        toast('Session created', 'success')
      } else {
        const err = await r.json()
        toast(err.detail || 'Error creating session', 'error')
      }
    } finally {
      setCreating(false)
    }
  }

  const renameSession = async (oldName: string, newNameVal: string) => {
    if (!newNameVal.trim() || newNameVal.trim() === oldName) {
      setRenamingSession(null)
      return
    }
    const r = await fetch(apiUrl(`/sessions/${oldName}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: newNameVal.trim() }),
    })
    if (r.ok) {
      setRenamingSession(null)
      load()
      toast('Session renamed', 'success')
    } else {
      const err = await r.json()
      toast(err.detail || 'Rename failed', 'error')
    }
  }

  const uploadFiles = async (sessionName: string, files: FileList) => {
    if (!files.length) return
    setUploadingFor(sessionName)
    const form = new FormData()
    for (const f of Array.from(files)) form.append('files', f)
    const r = await fetch(apiUrl(`/sessions/${sessionName}/upload`), { method: 'POST', body: form })
    setUploadingFor(null)
    if (r.ok) {
      load()
      toast('Audio uploaded', 'success')
    } else {
      toast('Upload failed', 'error')
    }
  }

  const uploadFilesArray = async (sessionName: string, files: File[]) => {
    setUploadingFor(sessionName)
    const form = new FormData()
    files.forEach(f => form.append('files', f))
    const r = await fetch(apiUrl(`/sessions/${sessionName}/upload`), { method: 'POST', body: form })
    setUploadingFor(null)
    if (r.ok) { load(); toast('Audio uploaded', 'success') }
    else toast('Upload failed', 'error')
  }

  const importZip = async (sessionName: string, file: File) => {
    setUploadingFor(sessionName)
    const form = new FormData()
    form.append('file', file)
    const r = await fetch(apiUrl(`/sessions/${sessionName}/import-zip`), { method: 'POST', body: form })
    setUploadingFor(null)
    if (r.ok) { load(); toast('ZIP imported', 'success') }
    else toast('ZIP import failed', 'error')
  }

  const deleteSession = async (name: string) => {
    const r = await fetch(apiUrl(`/sessions/${name}`), { method: 'DELETE' })
    if (r.ok) {
      setConfirmDelete(null)
      load()
      toast('Session deleted', 'success')
    } else {
      toast('Delete failed', 'error')
    }
  }

  const sortedSessions = [...sessions].sort((a, b) => {
    if (sortKey === 'name') return b.name.localeCompare(a.name)
    if (sortKey === 'date_added') return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    if (sortKey === 'modified') return new Date(b.modified_at ?? 0).getTime() - new Date(a.modified_at ?? 0).getTime()
    return 0
  })

  const handleDragEnter = (e: React.DragEvent, name: string) => {
    e.preventDefault()
    dragCounters.current[name] = (dragCounters.current[name] || 0) + 1
    setDragOverSession(name)
  }

  const handleDragLeave = (e: React.DragEvent, name: string) => {
    e.preventDefault()
    dragCounters.current[name] = (dragCounters.current[name] || 0) - 1
    if ((dragCounters.current[name] || 0) <= 0) {
      dragCounters.current[name] = 0
      setDragOverSession(prev => prev === name ? null : prev)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = async (e: React.DragEvent, sessionName: string) => {
    e.preventDefault()
    dragCounters.current[sessionName] = 0
    setDragOverSession(null)
    const files = Array.from(e.dataTransfer.files)
    const zipFiles = files.filter(f => f.name.toLowerCase().endsWith('.zip'))
    const audioFiles = files.filter(f => /\.(flac|mp3|ogg|wav|m4a)$/i.test(f.name))
    if (zipFiles.length > 0) {
      await importZip(sessionName, zipFiles[0])
    } else if (audioFiles.length > 0) {
      await uploadFilesArray(sessionName, audioFiles)
    }
  }

  return (
    <div style={{ padding: '32px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#e2e8f0' }}>
            Sessions
            {!loading && sessions.length > 0 && (
              <span style={{ marginLeft: 10, fontSize: 14, fontWeight: 400, color: '#475569' }}>
                {sessions.length}
              </span>
            )}
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            {activeCampaign ? activeCampaign.name : 'All recording sessions'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {(['name', 'date_added', 'modified'] as SortKey[]).map(k => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              style={{
                background: sortKey === k ? 'rgba(124,108,252,0.15)' : 'transparent',
                border: `1px solid ${sortKey === k ? 'rgba(124,108,252,0.4)' : '#2a2d3a'}`,
                borderRadius: 6, color: sortKey === k ? '#a89cff' : '#475569',
                padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {k === 'name' ? 'Name' : k === 'date_added' ? 'Date Added' : 'Modified'}
            </button>
          ))}
        </div>

        {(!authEnabled || (isLoggedIn && activeCampaign != null)) && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createSession()}
              placeholder="2026-03-15"
              style={{
                background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '8px',
                color: '#e2e8f0', padding: '8px 12px', fontSize: '13px', width: '160px', outline: 'none',
              }}
            />
            <button
              onClick={createSession}
              disabled={creating || !newName.trim()}
              style={{
                background: '#7c6cfc', border: 'none', borderRadius: '8px', color: '#fff',
                padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                opacity: (creating || !newName.trim()) ? 0.5 : 1,
              }}
            >
              + New
            </button>
          </div>
        )}
      </div>

      {/* Hidden file input for uploads */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".flac,.mp3,.ogg,.wav,.m4a"
        style={{ display: 'none' }}
        onChange={e => {
          if (uploadingFor && e.target.files) uploadFiles(uploadingFor, e.target.files)
          e.target.value = ''
        }}
      />

      {!activeCampaign ? (
        <div style={{
          background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '12px',
          padding: '48px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚔️</div>
          <div style={{ color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>No campaign selected</div>
          <div style={{ color: '#475569', fontSize: 13 }}>Pick a campaign from the dropdown above to see its sessions.</div>
        </div>
      ) : loading ? (
        <div style={{ color: '#64748b', fontSize: '14px' }}>Loading...</div>
      ) : sessions.length === 0 ? (
        <div style={{
          background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '12px',
          padding: '48px', textAlign: 'center', color: '#64748b',
        }}>
          No sessions yet. Create one above.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {sortedSessions.map(s => {
            const sc = statusColors[s.status] || statusColors.empty
            const isRenaming = renamingSession === s.name
            const isDragOver = dragOverSession === s.name
            const isUploading = uploadingFor === s.name

            // Inline delete confirmation
            if (confirmDelete === s.name) {
              return (
                <div
                  key={s.name}
                  style={{
                    background: '#1a1d27',
                    border: '1px solid rgba(248,113,113,0.4)',
                    borderRadius: '10px',
                    padding: '14px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <span style={{ flex: 1, fontSize: '14px', color: '#f87171' }}>
                    Delete <strong>{s.name}</strong>?
                  </span>
                  <button
                    onClick={() => deleteSession(s.name)}
                    style={{
                      background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.4)',
                      borderRadius: '6px', color: '#f87171', padding: '5px 14px',
                      fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    Yes, delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    style={{
                      background: 'transparent', border: '1px solid #2a2d3a',
                      borderRadius: '6px', color: '#94a3b8', padding: '5px 14px',
                      fontSize: '13px', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )
            }

            const job = jobMap[s.name]

            return (
              <div
                key={s.name}
                onDragEnter={e => handleDragEnter(e, s.name)}
                onDragLeave={e => handleDragLeave(e, s.name)}
                onDragOver={handleDragOver}
                onDrop={e => handleDrop(e, s.name)}
                style={{
                  background: isDragOver ? 'rgba(124,108,252,0.06)' : '#1a1d27',
                  border: isDragOver ? '1px solid #7c6cfc' : '1px solid #2a2d3a',
                  boxShadow: isDragOver ? '0 0 0 2px rgba(124,108,252,0.25)' : 'none',
                  borderRadius: '10px',
                  padding: '14px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
              >
                {/* Name / rename */}
                <div style={{ flex: 1 }}>
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') renameSession(s.name, renameValue)
                        if (e.key === 'Escape') setRenamingSession(null)
                      }}
                      onBlur={() => renameSession(s.name, renameValue)}
                      style={{
                        background: '#0f1117', border: '1px solid #7c6cfc', borderRadius: '6px',
                        color: '#e2e8f0', padding: '4px 8px', fontSize: '14px', fontWeight: 600, outline: 'none',
                      }}
                    />
                  ) : (
                    <div onClick={() => navigate(`/sessions/${s.name}`)} style={{ cursor: 'pointer' }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>{s.name}</div>
                      {(sortKey === 'date_added' ? s.created_at : s.modified_at) && (
                        <div style={{ fontSize: '11px', color: '#334155', marginTop: 2 }}>
                          {sortKey === 'date_added' ? 'Added' : 'Modified'} {relativeTime(sortKey === 'date_added' ? s.created_at : s.modified_at)}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Drag hint when hovering */}
                {isDragOver && (
                  <span style={{ fontSize: '12px', color: '#a78bfa' }}>
                    Drop to upload
                  </span>
                )}

                {/* File badges */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  {s.has_transcript && <Badge label="transcript" />}
                  {s.has_summary && <Badge label="summary" />}
                  {s.has_wiki && <Badge label="wiki" />}
                </div>

                {/* Status badge */}
                <div style={{
                  background: sc.bg, color: sc.text, borderRadius: '20px',
                  padding: '3px 10px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap',
                }}>
                  {sc.label}
                </div>

                {/* Job status badge */}
                {job && <JobStatusBadge job={job} />}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  {(!authEnabled || isLoggedIn) && (
                    <ActionBtn
                      title={job && job.status === 'claimed' ? 'Reset stuck job and re-queue' : 'Queue transcription'}
                      onClick={() => requestTranscription(s.name)}
                    >
                      {job && job.status === 'claimed' ? '🔁' : '🎙️'}
                    </ActionBtn>
                  )}
                  {(!authEnabled || isLoggedIn) && s.has_transcript && (!authEnabled || activeCampaign?.role === 'dm') && (
                    <ActionBtn
                      title="Generate wiki summary"
                      onClick={() => requestWikiSummary(s.name)}
                    >
                      📖
                    </ActionBtn>
                  )}
                  <ActionBtn
                    title="Upload audio files"
                    onClick={() => {
                      setUploadingFor(s.name)
                      fileInputRef.current?.click()
                    }}
                    loading={isUploading}
                  >
                    {isUploading ? '⏳' : '📁'}
                  </ActionBtn>
                  <ActionBtn
                    title="Rename session"
                    onClick={() => { setRenamingSession(s.name); setRenameValue(s.name) }}
                  >
                    ✏️
                  </ActionBtn>
                  <ActionBtn
                    title="Delete session"
                    onClick={() => setConfirmDelete(s.name)}
                    danger
                  >
                    🗑️
                  </ActionBtn>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Badge({ label }: { label: string }) {
  return (
    <span style={{
      background: 'rgba(124,108,252,0.1)', color: '#7c6cfc',
      borderRadius: '4px', padding: '2px 7px', fontSize: '10px', fontWeight: 600,
    }}>
      {label}
    </span>
  )
}

const JOB_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: 'rgba(251,191,36,0.15)',  text: '#fbbf24', label: '⏳ Queued' },
  claimed:   { bg: 'rgba(59,130,246,0.15)',  text: '#60a5fa', label: '🔄 Transcribing' },
  done:      { bg: 'rgba(34,197,94,0.15)',   text: '#4ade80', label: '✅ Done' },
  error:     { bg: 'rgba(248,113,113,0.15)', text: '#f87171', label: '❌ Error' },
}

function JobStatusBadge({ job }: { job: TranscriptionJob }) {
  const b = JOB_BADGE[job.status]
  if (!b) return null
  return (
    <div
      title={job.status === 'error' ? (job.error_message ?? undefined) : undefined}
      style={{
        background: b.bg, color: b.text, borderRadius: '20px',
        padding: '3px 10px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap',
        cursor: job.status === 'error' ? 'help' : 'default',
      }}
    >
      {b.label}
    </div>
  )
}

function ActionBtn({ children, onClick, title, loading, danger }: {
  children: React.ReactNode; onClick: () => void; title?: string; loading?: boolean; danger?: boolean
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      title={title}
      disabled={loading}
      style={{
        background: 'transparent',
        border: `1px solid ${danger ? 'rgba(248,113,113,0.3)' : '#2a2d3a'}`,
        borderRadius: '6px',
        color: danger ? '#f87171' : '#94a3b8',
        padding: '4px 8px',
        fontSize: '13px',
        cursor: 'pointer',
        opacity: loading ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}
