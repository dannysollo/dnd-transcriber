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
  description: string | null
}

interface TranscriptionJob {
  session_name: string
  status: string
  created_at: string | null
  error_message: string | null
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

// SVG icons
const MicIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>
    <line x1="8" y1="22" x2="16" y2="22"/>
  </svg>
)
const BookIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
  </svg>
)
const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
)
const PenIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)
const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
)

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
  const [sortKey, setSortKey] = useState<SortKey>('date_added')
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

  const cancelJob = async (sessionName: string) => {
    const r = await fetch(apiUrl(`/sessions/${sessionName}/transcribe`), { method: 'DELETE' })
    if (r.ok || r.status === 204) {
      setJobMap(prev => { const n = { ...prev }; delete n[sessionName]; return n })
      toast('Job cancelled', 'success')
    } else if (r.status === 409) {
      toast('Cannot cancel — job is currently being processed', 'warning')
    } else {
      toast('Failed to cancel job', 'error')
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
    if (newNameVal.includes('/') || newNameVal.includes('\\')) {
      toast('Session name cannot contain slashes', 'error')
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
    if (sortKey === 'name') return a.name.localeCompare(b.name)
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
    <div className="page-content" style={{ padding: '24px 28px', maxWidth: '860px' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Sessions
            {!loading && sessions.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>
                {sessions.length}
              </span>
            )}
          </h1>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {activeCampaign ? activeCampaign.name : 'All sessions'}
          </span>
        </div>

        {/* Sort + New session row */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginRight: 2 }}>Sort:</span>
            {(['name', 'date_added', 'modified'] as SortKey[]).map(k => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                style={{
                  background: sortKey === k ? 'color-mix(in srgb, var(--accent2) 12%, transparent)' : 'transparent',
                  border: `1px solid ${sortKey === k ? 'var(--accent2)' : 'var(--border-default)'}`,
                  borderRadius: 5, color: sortKey === k ? 'var(--accent2-text)' : 'var(--text-muted)',
                  padding: '3px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.15s ease',
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
                placeholder="Session name, e.g. 2026-03-15"
                style={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px',
                  color: 'var(--text-primary)', padding: '8px 12px', fontSize: '13px', flex: 1, outline: 'none',
                }}
              />
              <button
                onClick={createSession}
                disabled={creating || !newName.trim()}
                className="btn-primary"
                style={{ whiteSpace: 'nowrap' }}
              >
                + New
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input */}
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
        <EmptyState icon="⚔️" title="No campaign selected" body="Pick a campaign from the dropdown above to see its sessions." />
      ) : loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading...</div>
      ) : sessions.length === 0 ? (
        <EmptyState icon="📜" title="No sessions yet" body="Create your first session above to get started." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {sortedSessions.map(s => {
            const isRenaming = renamingSession === s.name
            const isDragOver = dragOverSession === s.name
            const isUploading = uploadingFor === s.name
            const job = jobMap[s.name]
            const timestamp = sortKey === 'date_added' ? s.created_at : s.modified_at
            const timestampLabel = sortKey === 'date_added' ? 'Added' : 'Modified'

            if (confirmDelete === s.name) {
              return (
                <div
                  key={s.name}
                  className="session-card"
                  style={{ border: '1px solid rgba(239,68,68,0.4)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}
                >
                  <span style={{ flex: 1, fontSize: '14px', color: 'var(--danger)' }}>
                    Delete <strong>{s.name}</strong>?
                  </span>
                  <button onClick={() => deleteSession(s.name)} className="btn-danger" style={{ padding: '5px 14px', fontSize: '13px', borderRadius: '6px' }}>
                    Yes, delete
                  </button>
                  <button onClick={() => setConfirmDelete(null)} className="btn-ghost" style={{ padding: '5px 14px', fontSize: '13px', borderRadius: '6px' }}>
                    Cancel
                  </button>
                </div>
              )
            }

            return (
              <div
                key={s.name}
                className="session-card"
                onDragEnter={e => handleDragEnter(e, s.name)}
                onDragLeave={e => handleDragLeave(e, s.name)}
                onDragOver={handleDragOver}
                onDrop={e => handleDrop(e, s.name)}
                style={{
                  background: isDragOver ? 'rgba(124,108,252,0.06)' : undefined,
                  border: isDragOver ? '1px solid var(--accent)' : undefined,
                  boxShadow: isDragOver ? '0 0 0 2px rgba(124,108,252,0.2)' : undefined,
                  padding: '13px 16px',
                  overflow: 'hidden',
                }}
              >
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
                      background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: '6px',
                      color: 'var(--text-primary)', padding: '6px 10px', fontSize: '15px', fontWeight: 600,
                      outline: 'none', width: '100%', boxSizing: 'border-box',
                    }}
                  />
                ) : (
                  <>
                    {/* Top row: title + badges */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: s.description ? 5 : 0 }}>
                      <div
                        onClick={() => navigate(`/sessions/${s.name}`)}
                        style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                      >
                        <div style={{
                          fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          lineHeight: 1.3,
                        }}>
                          {s.name}
                        </div>
                      </div>

                      {/* Status badges — top right */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        {s.has_transcript && (
                          <span style={{
                            background: 'color-mix(in srgb, var(--accent2) 15%, transparent)',
                            color: 'var(--accent2-text)',
                            border: '1px solid color-mix(in srgb, var(--accent2) 35%, transparent)',
                            borderRadius: '4px', padding: '2px 7px',
                            fontSize: '10px', fontWeight: 700, letterSpacing: '0.03em',
                            textTransform: 'uppercase',
                          }}>
                            Transcript
                          </span>
                        )}
                        {job && job.status !== 'done' && (
                          <JobStatusBadge job={job} onCancel={() => cancelJob(s.name)} />
                        )}
                        {isDragOver && (
                          <span style={{ fontSize: '11px', color: 'var(--accent-text)', fontStyle: 'italic' }}>
                            Drop to upload
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Description blurb */}
                    {s.description && (
                      <p
                        onClick={() => navigate(`/sessions/${s.name}`)}
                        style={{
                          margin: '0 0 8px 0',
                          fontSize: '13px',
                          color: 'var(--text-secondary)',
                          fontStyle: 'italic',
                          lineHeight: 1.55,
                          cursor: 'pointer',
                          // Clamp to 2 lines
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {s.description}
                      </p>
                    )}

                    {/* Bottom row: timestamp + actions */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: s.description ? 0 : 10 }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {timestamp ? `${timestampLabel} ${relativeTime(timestamp)}` : ''}
                      </span>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                        {(!authEnabled || isLoggedIn) && (
                          <ActionBtn
                            title={job && job.status === 'claimed' ? 'Reset stuck job and re-queue' : 'Queue transcription'}
                            onClick={() => requestTranscription(s.name)}
                          >
                            {job && job.status === 'claimed' ? <RefreshIcon /> : <MicIcon />}
                          </ActionBtn>
                        )}
                        {(!authEnabled || isLoggedIn) && s.has_transcript && (!authEnabled || activeCampaign?.role === 'dm') && (
                          <ActionBtn title="Generate summary + wiki" onClick={() => requestWikiSummary(s.name)}>
                            <BookIcon />
                          </ActionBtn>
                        )}
                        <ActionBtn
                          title="Upload audio files"
                          onClick={() => { setUploadingFor(s.name); fileInputRef.current?.click() }}
                          loading={isUploading}
                        >
                          <FolderIcon />
                        </ActionBtn>
                        <ActionBtn
                          title="Rename session"
                          onClick={() => { setRenamingSession(s.name); setRenameValue(s.name) }}
                        >
                          <PenIcon />
                        </ActionBtn>
                        <ActionBtn title="Delete session" onClick={() => setConfirmDelete(s.name)} danger>
                          <TrashIcon />
                        </ActionBtn>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '12px',
      padding: '56px 32px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 36, marginBottom: 14 }}>{icon}</div>
      <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 6, fontSize: 15 }}>{title}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{body}</div>
    </div>
  )
}

const JOB_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: 'rgba(251,191,36,0.12)',  text: '#fbbf24', label: 'Queued' },
  claimed:   { bg: 'rgba(59,130,246,0.12)',  text: '#60a5fa', label: 'Transcribing' },
  done:      { bg: 'rgba(34,197,94,0.12)',   text: '#4ade80', label: 'Done' },
  error:     { bg: 'rgba(248,113,113,0.12)', text: '#f87171', label: 'Error' },
}

function JobStatusBadge({ job, onCancel }: { job: TranscriptionJob; onCancel?: () => void }) {
  const b = JOB_BADGE[job.status]
  if (!b) return null
  const canCancel = onCancel && job.status !== 'done'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div
        title={job.status === 'error' ? (job.error_message ?? undefined) : undefined}
        style={{
          background: b.bg, color: b.text, borderRadius: '4px',
          padding: '2px 8px', fontSize: '10px', fontWeight: 700,
          letterSpacing: '0.03em', textTransform: 'uppercase',
          whiteSpace: 'nowrap', cursor: job.status === 'error' ? 'help' : 'default',
        }}
      >
        {b.label}
      </div>
      {canCancel && (
        <button
          onClick={e => { e.stopPropagation(); onCancel() }}
          title="Cancel job"
          style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: '12px', padding: '0 2px', lineHeight: 1,
          }}
        >✕</button>
      )}
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
        border: `1px solid ${danger ? 'rgba(248,113,113,0.25)' : 'var(--border-default)'}`,
        borderRadius: '6px',
        color: danger ? '#f87171' : 'var(--text-muted)',
        padding: '5px 7px',
        fontSize: '13px',
        cursor: 'pointer',
        opacity: loading ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s ease',
      }}
    >
      {children}
    </button>
  )
}
