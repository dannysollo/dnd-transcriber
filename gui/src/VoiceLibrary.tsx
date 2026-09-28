import { useEffect, useState } from 'react'
import { useToast } from './Toast'

// Campaign Settings > Voices: who the worker has a voice profile for. The
// profiles themselves (numbers, no audio) never leave the server; this lists
// them, resets a bad one and names guests.

interface Voice {
  key: string; name: string; guest: boolean; minutes: number
  sessions: number; last_session: string | null; updated: string | null
}

export default function VoiceLibrary({ slug }: { slug: string }) {
  const { toast } = useToast()
  const [data, setData] = useState<{ people: Voice[]; players_without_profile: string[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [confirmReset, setConfirmReset] = useState<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [nameValue, setNameValue] = useState('')

  const load = () => fetch(`/campaigns/${slug}/voices`)
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(d => { setData(d); setFailed(false) })
    .catch(() => setFailed(true))
  useEffect(() => { load() }, [slug])

  const reset = async (v: Voice) => {
    if (confirmReset !== v.key) { setConfirmReset(v.key); return }
    setConfirmReset(null)
    const r = await fetch(`/campaigns/${slug}/voices/${encodeURIComponent(v.key)}`, { method: 'DELETE' })
    if (!r.ok) { toast('Could not reset the profile', 'error'); return }
    toast(`${v.name}'s profile reset. It's learned again from the next session.`, 'success')
    load()
  }

  const saveName = async (v: Voice) => {
    const name = nameValue.trim()
    if (!name || name === v.name) { setNaming(null); return }
    const r = await fetch(`/campaigns/${slug}/voices/${encodeURIComponent(v.key)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    })
    if (!r.ok) { toast('Could not rename', 'error'); return }
    setNaming(null)
    load()
  }

  if (failed) return <p className="barlist-note">The voice library couldn't be loaded. Try reloading.</p>
  if (!data) return <div className="skeleton" style={{ height: 160, maxWidth: 640 }} />

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')

  return (
    <section className="voice-library" aria-label="Voice library">
      <p className="voice-intro">
        The worker learns each person's voice from their own Craig track, every session. It uses these
        profiles to split a shared mic and to tell speakers apart in reconstructed sessions. Only numbers
        are stored, no audio.
      </p>

      {data.people.length === 0 ? (
        <p className="barlist-note">No voice profiles yet. They're learned the next time a Craig session is transcribed.</p>
      ) : (
        <ul className="voice-list">
          {data.people.map(v => (
            <li key={v.key} className="voice-row">
              <div className="voice-main">
                {naming === v.key ? (
                  <form className="voice-name-form" onSubmit={e => { e.preventDefault(); saveName(v) }}>
                    <input autoFocus value={nameValue} onChange={e => setNameValue(e.target.value)}
                      aria-label={`Name for ${v.name}`} onKeyDown={e => { if (e.key === 'Escape') setNaming(null) }} />
                    <button type="submit" className="btn-ghost">Save</button>
                  </form>
                ) : (
                  <span className="voice-name">{v.name}{v.guest && <span className="voice-guest">guest</span>}</span>
                )}
                <span className="voice-detail">
                  {v.minutes} min of speech from {v.sessions} session{v.sessions !== 1 ? 's' : ''}
                  {v.last_session ? <>, last from {v.last_session}</> : null}
                  {v.updated ? <> ({when(v.updated)})</> : null}
                </span>
              </div>
              <div className="voice-actions">
                {v.guest && naming !== v.key && (
                  <button type="button" className="btn-ghost" onClick={() => { setNaming(v.key); setNameValue(v.name) }}>Name</button>
                )}
                <button type="button" className={confirmReset === v.key ? 'btn-danger' : 'btn-ghost'} onClick={() => reset(v)}
                  title="Forget this profile; it's learned again from the next session">
                  {confirmReset === v.key ? 'Confirm reset' : 'Reset'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data.players_without_profile.length > 0 && (
        <p className="barlist-note">
          No profile yet: {data.players_without_profile.join(', ')}. Learned from their own track the next
          session they're at.
        </p>
      )}
    </section>
  )
}
