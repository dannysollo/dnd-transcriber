import { useEffect, useState } from 'react'
import { useToast } from './Toast'

// Sessions > "From a single recording": for a session recorded without Craig
// (an OBS capture, a video). Upload the file, tick who was there; the worker
// transcribes it and tells speakers apart by the voice library
// (worker/reconstruct.py). Voices it can't place become "Unknown voice N",
// which the session page asks about.

interface Person { key: string; name: string; hasProfile: boolean; guest: boolean }

export default function NewFromRecording({ slug, defaultName, onDone }: {
  slug: string
  defaultName: string
  onDone: (sessionName: string, job: unknown) => void
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const [file, setFile] = useState<File | null>(null)
  const [people, setPeople] = useState<Person[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [guests, setGuests] = useState<string[]>([])
  const [guestDraft, setGuestDraft] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open && !name) setName(defaultName) }, [open])
  useEffect(() => {
    if (!open || people) return
    Promise.all([
      fetch(`/campaigns/${slug}/config`).then(r => (r.ok ? r.json() : {})) as Promise<{ players?: Record<string, { name?: string }> }>,
      fetch(`/campaigns/${slug}/voices`).then(r => (r.ok ? r.json() : { people: [] })),
    ]).then(([config, lib]) => {
      const profiles = new Map<string, { name: string; guest: boolean }>(
        (lib.people ?? []).map((p: { key: string; name: string; guest: boolean }) => [p.key, p]))
      const players = Object.entries(config.players ?? {})
        .map(([u, info]) => ({ key: u, name: info?.name ?? u, hasProfile: profiles.has(u), guest: false }))
      const knownGuests = [...profiles.entries()].filter(([, p]) => p.guest)
        .map(([k, p]) => ({ key: k, name: p.name, hasProfile: true, guest: true }))
      setPeople([...players, ...knownGuests])
      setPicked(new Set(players.map(p => p.key)))  // regulars ticked by default
    }).catch(() => setPeople([]))
  }, [open, slug])

  const toggle = (key: string) => setPicked(prev => {
    const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next
  })
  const addGuest = () => {
    const g = guestDraft.trim()
    if (g && !guests.includes(g)) setGuests([...guests, g])
    setGuestDraft('')
  }

  // XHR rather than fetch: recordings run to hundreds of MB and an upload
  // progress bar needs the upload's progress events.
  const upload = (sessionName: string, f: File) => new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/campaigns/${slug}/sessions/${encodeURIComponent(sessionName)}/recording`)
    xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(e.loaded / e.total) }
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText || `HTTP ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('Network error'))
    const body = new FormData(); body.append('file', f)
    xhr.send(body)
  })

  const submit = async () => {
    const sessionName = name.trim()
    if (!sessionName || !file || (picked.size === 0 && guests.length === 0)) return
    setBusy(true); setProgress(0)
    try {
      const created = await fetch(`/campaigns/${slug}/sessions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: sessionName }),
      })
      if (!created.ok) { toast((await created.json().catch(() => null))?.detail ?? 'Could not create the session', 'error'); return }
      await upload(sessionName, file)
      setProgress(null)
      const r = await fetch(`/campaigns/${slug}/sessions/${encodeURIComponent(sessionName)}/reconstruct`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendees: [...picked], guests }),
      })
      if (!r.ok) { toast((await r.json().catch(() => null))?.detail ?? 'Could not queue it', 'error'); return }
      toast('Uploaded. The worker will transcribe it and tell the voices apart.', 'success')
      onDone(sessionName, (await r.json()).job)
      setOpen(false); setFile(null); setGuests([]); setName('')
    } catch (e) {
      toast(`Upload failed: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setBusy(false); setProgress(null)
    }
  }

  if (!open) {
    return (
      <button type="button" className="index-link" onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start', fontSize: 16 }}>
        Or make one from a single recording (no Craig)
      </button>
    )
  }

  const noProfile = (people ?? []).filter(p => picked.has(p.key) && !p.hasProfile).map(p => p.name)
  return (
    <section className="from-recording" aria-label="New session from a recording">
      <p className="from-recording-intro">
        For a session recorded without Craig: an OBS capture, a video, any single audio file. The worker
        transcribes it and tells people apart by their voices. Anyone it can't place, you identify afterwards
        from short clips.
      </p>
      <label className="from-recording-field">
        <span>Session name</span>
        <input className="written-line" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 11-9-2025 -- Bethsaida" />
      </label>
      <label className="from-recording-field">
        <span>Recording</span>
        <input type="file" accept="audio/*,video/*,.mkv,.webm,.m4a,.opus"
          onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <fieldset className="from-recording-people">
        <legend>Who was there</legend>
        {!people ? <div className="skeleton" style={{ height: 60 }} /> : people.map(p => (
          <label key={p.key} className="from-recording-person">
            <input type="checkbox" checked={picked.has(p.key)} onChange={() => toggle(p.key)} />
            <span>{p.name}{p.guest && <span className="voice-guest">guest</span>}</span>
            {!p.hasProfile && <span className="from-recording-note">no voice profile yet</span>}
          </label>
        ))}
        {guests.map(g => (
          <label key={g} className="from-recording-person">
            <input type="checkbox" checked onChange={() => setGuests(guests.filter(x => x !== g))} />
            <span>{g}<span className="voice-guest">guest</span></span>
            <span className="from-recording-note">no voice profile yet</span>
          </label>
        ))}
        <div className="from-recording-guest">
          <input className="written-line" value={guestDraft} onChange={e => setGuestDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGuest() } }} placeholder="Add a guest" aria-label="Guest name" />
          <button type="button" className="btn-ghost" onClick={addGuest} disabled={!guestDraft.trim()}>Add</button>
        </div>
      </fieldset>
      {noProfile.length + guests.length > 0 && (
        <p className="from-recording-note">
          {[...noProfile, ...guests].join(', ')} {noProfile.length + guests.length === 1 ? 'has' : 'have'} no voice
          profile, so their lines will show up as "Unknown voice" for you to name.
        </p>
      )}
      {progress !== null && (
        <div className="upload-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
          <span>Uploading… {Math.round(progress * 100)}%</span>
        </div>
      )}
      <div className="from-recording-actions">
        <button type="button" className="btn-primary" onClick={submit}
          disabled={busy || !name.trim() || !file || (picked.size === 0 && guests.length === 0)}>
          {busy ? 'Uploading…' : 'Upload and transcribe'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      </div>
    </section>
  )
}
