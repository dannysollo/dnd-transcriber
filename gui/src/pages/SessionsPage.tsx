import { useEffect, useRef, useState } from 'react'
import { CloseIcon } from '../Icons'
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
  has_craig_link?: boolean
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
const LinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
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
  const [newCraigUrl, setNewCraigUrl] = useState('')
  const [craigFor, setCraigFor] = useState<string | null>(null)
  const [craigValue, setCraigValue] = useState('')
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
        body: JSON.stringify({ name: newName.trim(), craig_url: newCraigUrl.trim() || null }),
      })
      if (r.ok) {
        const data = await r.json()
        const sessionName = newName.trim()
        setNewName('')
        setNewCraigUrl('')
        load()
        if (data.job) {
          setJobMap(prev => ({ ...prev, [sessionName]: data.job }))
          toast('Session created — the worker will download it from Craig', 'success')
        } else {
          toast('Session created', 'success')
        }
      } else {
        const err = await r.json()
        toast(err.detail || 'Error creating session', 'error')
      }
    } finally {
      setCreating(false)
    }
  }

  const attachCraigLink = async (sessionName: string) => {
    const url = craigValue.trim()
    if (!url) { setCraigFor(null); return }
    const r = await fetch(apiUrl(`/sessions/${sessionName}/craig-link`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, queue: true }),
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) {
      toast(data?.detail ?? 'Could not attach Craig link', 'error')
      return
    }
    setCraigFor(null)
    setCraigValue('')
    if (data?.job) setJobMap(prev => ({ ...prev, [sessionName]: data.job }))
    load()
    toast('Craig link attached — transcription queued', 'success')
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
    <div className="page-content" style={{ padding: '40px 56px', maxWidth: '920px' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: '34px', lineHeight: 1.15, color: 'var(--ink)' }}>
            Sessions
            {!loading && sessions.length > 0 && (
              <span style={{ marginLeft: 12, fontSize: 20, color: 'var(--ink-faint)' }}>
                {sessions.length} {sessions.length === 1 ? 'entry' : 'entries'}
              </span>
            )}
          </h1>
        </div>

        {/* Sort + Filter + New session row */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, color: 'var(--ink-faint)', marginRight: 4, minWidth: 64 }}>Order by</span>
            {(['name', 'date_added', 'modified'] as SortKey[]).map(k => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                aria-pressed={sortKey === k}
                className="index-link"
              >
                {k === 'name' ? 'name' : k === 'date_added' ? 'date added' : 'last changed'}
              </button>
            ))}
          </div>


          {(!authEnabled || (isLoggedIn && activeCampaign != null)) && (
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 14 }}>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createSession()}
                placeholder="New session, e.g. 3-22-2026"
                aria-label="New session name"
                className="written-line"
                style={{ flex: '1 1 220px' }}
              />
              {(!authEnabled || activeCampaign?.role === 'dm') && activeCampaign && (
                <input
                  type="url"
                  value={newCraigUrl}
                  onChange={e => setNewCraigUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createSession()}
                  placeholder="Craig link (optional)"
                  title="Paste the Craig download link — the worker fetches the audio and transcribes it"
                  aria-label="Craig download link (optional)"
                  className="written-line"
                  style={{ flex: '1 1 220px', minWidth: 0 }}
                />
              )}
              <button
                onClick={createSession}
                disabled={creating || !newName.trim()}
                className="btn-primary"
                style={{ whiteSpace: 'nowrap' }}
              >
                Create session
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
        <EmptyState title="No campaign selected" body="Pick a campaign from the dropdown above to see its sessions." />
      ) : loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[0,1,2].map(i => (
            <div key={i} className="session-card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="skeleton" style={{ height: 18, width: '60%' }} />
              <div className="skeleton" style={{ height: 13, width: '85%' }} />
              <div className="skeleton" style={{ height: 12, width: '30%' }} />
            </div>
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--text-muted)' }}>
          <h3 style={{ margin: '0 0 8px', color: 'var(--ink)', fontSize: '24px' }}>The journal is empty</h3>
          <p style={{ margin: 0, fontSize: '17px', maxWidth: '380px', marginLeft: 'auto', marginRight: 'auto', color: 'var(--ink-soft)' }}>
            Name your first session above. Paste its Craig link too and the worker will fetch the audio and transcribe it.
          </p>
        </div>
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
                  style={{ border: '1px solid color-mix(in srgb, var(--rubric) 40%, transparent)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}
                >
                  <span style={{ flex: 1, fontSize: '17px', color: 'var(--danger)' }}>
                    Delete <strong>{s.name}</strong>?
                  </span>
                  <button onClick={() => deleteSession(s.name)} className="btn-danger" style={{ padding: '5px 14px', fontSize: '16px', borderRadius: '3px' }}>
                    Yes, delete
                  </button>
                  <button onClick={() => setConfirmDelete(null)} className="btn-ghost" style={{ padding: '5px 14px', fontSize: '16px', borderRadius: '3px' }}>
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
                  background: isDragOver ? 'color-mix(in srgb, var(--rubric) 6%, transparent)' : undefined,
                  border: isDragOver ? '1px solid var(--accent)' : undefined,
                  boxShadow: isDragOver ? '0 0 0 2px color-mix(in srgb, var(--rubric) 20%, transparent)' : undefined,
                  padding: '18px 4px 16px',
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
                      background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: '3px',
                      color: 'var(--text-primary)', padding: '6px 10px', fontSize: '18px', fontWeight: 600,
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
                          fontSize: '23px', color: 'var(--ink)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          lineHeight: 1.25,
                        }}>
                          {s.name}
                        </div>
                      </div>

                      {/* Status badges — top right */}
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {s.has_craig_link && !s.has_transcript && (
                          <span title="Audio comes from a Craig link" style={{ color: 'var(--text-muted)', display: 'flex' }}>
                            <LinkIcon />
                          </span>
                        )}
                        {job && job.status !== 'done' && (
                          <JobStatusBadge job={job} onCancel={() => cancelJob(s.name)} />
                        )}
                        {isDragOver && (
                          <span style={{ fontSize: '14px', color: 'var(--accent-text)' }}>
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
                          fontSize: '16px',
                          color: 'var(--text-secondary)',
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
                      <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                        {timestamp ? `${timestampLabel} ${relativeTime(timestamp)}` : ''}
                      </span>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: '4px', flexShrink: 0, alignItems: 'center' }}>
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
                        {activeCampaign && (!authEnabled || activeCampaign.role === 'dm') && (
                          <ActionBtn
                            title={s.has_craig_link ? 'Replace Craig link' : 'Attach Craig link'}
                            onClick={() => { setCraigFor(craigFor === s.name ? null : s.name); setCraigValue('') }}
                          >
                            <LinkIcon />
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

                    {craigFor === s.name && (
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                        <input
                          autoFocus
                          type="url"
                          value={craigValue}
                          onChange={e => setCraigValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') attachCraigLink(s.name)
                            if (e.key === 'Escape') setCraigFor(null)
                          }}
                          placeholder="https://craig.horse/rec/…?key=…"
                          aria-label={`Craig link for ${s.name}`}
                          style={{
                            background: 'var(--bg-base)', border: '1px solid var(--border-default)', borderRadius: '3px',
                            color: 'var(--text-primary)', padding: '6px 10px', fontSize: '16px', flex: 1, minWidth: 0, outline: 'none',
                          }}
                        />
                        <button className="btn-primary" style={{ fontSize: '15px', padding: '5px 12px', whiteSpace: 'nowrap' }}
                          disabled={!craigValue.trim()} onClick={() => attachCraigLink(s.name)}>
                          Fetch &amp; transcribe
                        </button>
                        <button className="btn-ghost" style={{ fontSize: '15px', padding: '5px 10px' }} onClick={() => setCraigFor(null)}>
                          Cancel
                        </button>
                      </div>
                    )}
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

function EmptyState({ title, body }: { icon?: string; title: string; body: string }) {
  return (
    <div style={{ padding: '56px 32px', textAlign: 'center', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }}>
      <div style={{ color: 'var(--ink)', marginBottom: 6, fontSize: 24 }}>{title}</div>
      <div style={{ color: 'var(--ink-soft)', fontSize: 17 }}>{body}</div>
    </div>
  )
}

const JOB_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: 'color-mix(in srgb, var(--ochre) 12%, transparent)',  text: 'var(--ochre)', label: 'Queued' },
  claimed:   { bg: 'color-mix(in srgb, var(--gilt) 12%, transparent)',  text: 'var(--gilt-ink)', label: 'Transcribing' },
  done:      { bg: 'color-mix(in srgb, var(--moss) 12%, transparent)',   text: 'var(--moss)', label: 'Done' },
  error:     { bg: 'color-mix(in srgb, var(--rubric) 12%, transparent)', text: 'var(--rubric)', label: 'Error' },
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
          color: b.text,
          fontSize: '16px',
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
            cursor: 'pointer', fontSize: '15px', padding: '0 2px', lineHeight: 1,
          }}
        ><CloseIcon /></button>
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
      aria-label={title}
      className={'entry-action' + (danger ? ' danger' : '')}
      style={{ opacity: loading ? 0.5 : undefined }}
    >
      {children}
    </button>
  )
}


