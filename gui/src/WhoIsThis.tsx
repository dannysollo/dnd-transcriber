import { useEffect, useState } from 'react'
import { useApiUrl } from './CampaignContext'
import { useToast } from './Toast'
import { PlayIcon } from './Icons'

// A reconstructed session's voices the worker couldn't place ("Unknown voice
// N"): a few clips of each, and a pick of who it is. Choosing renames all of
// that voice's lines (the Speakers rename), and the voice drops off the list.

interface UnknownVoice { label: string; lines: number; clips: { start: number; end: number; ts: string; text: string }[] }
type Player = { name?: string; character?: string | null; role?: string }

function labelFor(username: string, p: Player): string {
  const name = p.name ?? username
  if (p.role === 'dm') return `DM (${name})`
  return p.character ? `${p.character} [${name}]` : name
}

export default function WhoIsThis({ sessionName, onPlay, onRenamed }: {
  sessionName: string
  onPlay?: (from: number, until: number) => void
  onRenamed: () => void
}) {
  const apiUrl = useApiUrl()
  const { toast } = useToast()
  const [voices, setVoices] = useState<UnknownVoice[]>([])
  const [players, setPlayers] = useState<[string, Player][]>([])
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => fetch(apiUrl(`/sessions/${sessionName}/unknown-voices`))
    .then(r => (r.ok ? r.json() : { voices: [] })).then(d => setVoices(d.voices ?? [])).catch(() => setVoices([]))
  useEffect(() => { load() }, [sessionName])
  useEffect(() => {
    if (!voices.length || players.length) return
    fetch(apiUrl('/config')).then(r => (r.ok ? r.json() : {}))
      .then((c: { players?: Record<string, Player> }) => setPlayers(Object.entries(c.players ?? {})))
      .catch(() => {})
  }, [voices.length])

  if (!voices.length) return null

  const apply = async (v: UnknownVoice) => {
    const pick = choice[v.label]
    const newName = pick === '__other' ? (other[v.label] ?? '').trim() : pick
    if (!newName) return
    setBusy(v.label)
    try {
      const r = await fetch(apiUrl(`/sessions/${sessionName}/rename-speaker`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_name: v.label, new_name: newName }),
      })
      if (!r.ok) { toast('Could not rename', 'error'); return }
      toast(`${v.label} is now ${newName}`, 'success')
      onRenamed()
      load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="who-is-this" aria-label="Who is this?">
      <h3 className="sc">Who is this?</h3>
      <p className="who-is-this-note">
        This session was reconstructed from one recording, and these voices didn't match anyone's voice
        profile. Listen to a few lines and pick who it is; all of their lines get the name.
      </p>
      {voices.map(v => (
        <div key={v.label} className="who-voice">
          <div className="who-voice-head">
            <span className="speaker-name">{v.label}</span>
            <span className="who-voice-count">{v.lines} line{v.lines !== 1 ? 's' : ''}</span>
          </div>
          <ul className="who-clips">
            {v.clips.map(c => (
              <li key={c.start}>
                {onPlay && (
                  <button type="button" className="example-play" onClick={() => onPlay(c.start, c.end)}
                    aria-label={`Play ${v.label} at ${c.ts}`} title="Play this line"><PlayIcon size={14} /></button>
                )}
                <span className="who-clip-ts">{c.ts}</span>
                <span className="who-clip-text">{c.text}</span>
              </li>
            ))}
          </ul>
          <div className="who-voice-pick">
            <select value={choice[v.label] ?? ''} onChange={e => setChoice({ ...choice, [v.label]: e.target.value })}
              aria-label={`Who is ${v.label}?`}>
              <option value="" disabled>Who is it?</option>
              {players.map(([u, p]) => <option key={u} value={labelFor(u, p)}>{labelFor(u, p)}</option>)}
              <option value="__other">Someone else…</option>
            </select>
            {choice[v.label] === '__other' && (
              <input className="written-line" value={other[v.label] ?? ''} placeholder="Their name"
                onChange={e => setOther({ ...other, [v.label]: e.target.value })} aria-label="Their name" />
            )}
            <button type="button" className="btn-primary" disabled={busy === v.label || !choice[v.label]
              || (choice[v.label] === '__other' && !(other[v.label] ?? '').trim())} onClick={() => apply(v)}>
              {busy === v.label ? 'Renaming…' : 'Name them'}
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}
