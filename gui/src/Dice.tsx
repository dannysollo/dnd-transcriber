import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from './Toast'

// Roll20 dice (server: roll20.py). The DM uploads the campaign's chat archive;
// each session's rolls are placed in its recording by matching them to numbers
// said out loud, then shown under the transcript line they go with.

export interface Roll {
  id: string; at: number; line_ts: string | null; said: boolean; private: boolean
  username: string | null; label: string; formula: string | null; total: string | null
  d20: number | null; dice: [number, number][]
}
export interface SessionRolls {
  state: 'none' | 'unplaced' | 'placed'; count: number; trusted?: boolean; forced?: boolean
  shift?: number; rolls: Roll[]
}

const who = (label: string) => {
  const m = label.match(/^(.*?)\s*[[(]([^\])]+)[\])]\s*$/)
  return m ? (m[1] === 'DM' ? m[2] : m[1]) : label
}

/** One roll under its transcript line: "Kali rolled 20 (d20 17 +3)". */
export function RollChip({ roll, isDm }: { roll: Roll; isDm: boolean }) {
  const crit = roll.d20 === 20 ? 'nat20' : roll.d20 === 1 ? 'nat1' : undefined
  const at = new Date(roll.at * 1000).toISOString().slice(roll.at >= 3600 ? 12 : 14, 19).replace(/^0(?=\d:)/, '')
  return (
    <span className="roll-chip" data-crit={crit} data-private={roll.private ? '' : undefined}
      title={`${roll.label} at ${at}${roll.said ? '' : ' (placed by time)'}${roll.formula ? `: ${roll.formula}` : ''}${roll.private ? ' (private roll)' : ''}`}>
      <DieIcon />
      <span className="roll-who">{who(roll.label)}</span>
      <span className="roll-total">{roll.total ?? '?'}</span>
      {roll.formula && <span className="roll-formula">{roll.formula.replace(/\s+/g, '')}{roll.d20 !== null && roll.formula.replace(/\s/g, '') !== '1d20' ? ` (d20: ${roll.d20})` : ''}</span>}
      {crit && <span className="roll-crit">{crit === 'nat20' ? 'nat 20' : 'nat 1'}</span>}
      {roll.private && isDm && <span className="roll-private">private</span>}
    </span>
  )
}

function DieIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M12 2 21 7v10l-9 5-9-5V7z" /><path d="M12 2 7.5 16.5h9zM3 7l4.5 9.5M21 7l-4.5 9.5M7.5 16.5 12 22l4.5-5.5" />
    </svg>
  )
}

/** Session Stats tab: who rolled what, and (for the DM) nudging or forcing the placement. */
export function DicePanel({ data, isDm, onShift }: {
  data: SessionRolls; isDm: boolean; onShift: (shift: number, force: boolean) => void
}) {
  if (data.state === 'none') return null
  const shift = data.shift ?? 0
  const byWho = new Map<string, { rolls: number; d20: number[]; nat20: number; nat1: number }>()
  for (const r of data.rolls) {
    const k = r.label
    const e = byWho.get(k) ?? { rolls: 0, d20: [], nat20: 0, nat1: 0 }
    e.rolls++
    if (r.d20 !== null) { e.d20.push(r.d20); if (r.d20 === 20) e.nat20++; if (r.d20 === 1) e.nat1++ }
    byWho.set(k, e)
  }
  const rows = [...byWho.entries()].sort((a, b) => b[1].rolls - a[1].rolls)
  return (
    <section className="dice-panel" aria-label="Dice">
      <h3 className="sc">Dice</h3>
      {data.state === 'unplaced' ? (
        <p className="dice-note">
          {data.count} Roll20 roll{data.count !== 1 ? 's' : ''} this session, but too few were said out loud to tell where
          in the recording they go.
          {isDm && <> <button type="button" className="btn-ghost" onClick={() => onShift(shift, true)}>Place them anyway</button></>}
        </p>
      ) : (
        <>
          <table className="dice-table">
            <thead><tr><th>Who</th><th>Rolls</th><th>Average d20</th><th>Nat 20s</th><th>Nat 1s</th></tr></thead>
            <tbody>
              {rows.map(([label, e]) => (
                <tr key={label}>
                  <td>{who(label)}</td>
                  <td>{e.rolls}</td>
                  <td>{e.d20.length ? (e.d20.reduce((a, b) => a + b, 0) / e.d20.length).toFixed(1) : '–'}</td>
                  <td>{e.nat20 || '–'}</td>
                  <td>{e.nat1 || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {isDm && (
            <p className="dice-note">
              Rolls are placed where someone says their number, or by time. Showing up early or late?
              <span className="dice-shift">
                <button type="button" className="btn-ghost" onClick={() => onShift(shift - 10, !!data.forced)}>10 s earlier</button>
                <span>{shift ? `${shift > 0 ? '+' : ''}${shift} s` : 'as found'}</span>
                <button type="button" className="btn-ghost" onClick={() => onShift(shift + 10, !!data.forced)}>10 s later</button>
                {data.forced && <button type="button" className="btn-ghost" onClick={() => onShift(0, false)}>Unplace</button>}
              </span>
            </p>
          )}
        </>
      )}
    </section>
  )
}

interface Roll20Status {
  imported: string | null; total: number
  players: { id: string; names: string[]; count: number; username: string | null }[]
  sessions: { name: string; count: number; state: string; trusted?: boolean; forced?: boolean }[]
}

/** Campaign Settings > Dice: import the chat archive, and who's who. */
export function Roll20Settings({ slug }: { slug: string }) {
  const { toast } = useToast()
  const [status, setStatus] = useState<Roll20Status | null>(null)
  const [players, setPlayers] = useState<Record<string, { name?: string; character?: string }>>({})
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const load = () => fetch(`/campaigns/${slug}/roll20`).then(r => (r.ok ? r.json() : null)).then(setStatus).catch(() => setStatus(null))
  useEffect(() => {
    load()
    fetch(`/campaigns/${slug}/config`).then(r => (r.ok ? r.json() : null)).then(c => setPlayers(c?.players ?? {})).catch(() => {})
  }, [slug])

  const upload = async (f: File) => {
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', f)
      const r = await fetch(`/campaigns/${slug}/roll20/import`, { method: 'POST', body: form })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast(d.detail ?? 'Import failed', 'error'); return }
      toast(d.added ? `${d.added} new roll${d.added !== 1 ? 's' : ''} imported (${d.total} in all)` : `No new rolls (${d.total} already imported)`, 'success')
      load()
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  const map = async (id: string, username: string) => {
    const r = await fetch(`/campaigns/${slug}/roll20/players`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ players: { [id]: username || null } }),
    })
    if (!r.ok) { toast('Could not save', 'error'); return }
    load()
  }

  const placed = status?.sessions.filter(s => s.state === 'placed').length ?? 0
  return (
    <section className="voice-library dice-settings" aria-label="Dice">
      <p className="voice-intro">
        Rolls from Roll20 show under the transcript line they go with, and each session's Stats tab counts them.
        In Roll20, open the campaign's <strong>Chat Archive</strong>, choose <strong>Show on One Page</strong>, save the
        page (Ctrl+S, "Webpage, HTML only") and upload it here. Upload a newer one any time: only new rolls are added.
      </p>
      <div className="dice-upload">
        <input ref={input} type="file" accept=".html,.htm" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
        <button type="button" className="btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Importing…' : status?.total ? 'Upload a newer chat archive' : 'Upload the chat archive'}
        </button>
        {status?.imported && <span className="voice-detail">{status.total.toLocaleString()} rolls, last imported {new Date(status.imported + 'Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
      </div>

      {status && status.players.length > 0 && (
        <>
          <h3 className="sc dice-h">Who rolled</h3>
          <ul className="voice-list">
            {status.players.map(p => (
              <li key={p.id} className="voice-row">
                <div className="voice-main">
                  <span className="voice-name">{p.names.join(', ') || p.id}</span>
                  <span className="voice-detail">{p.count.toLocaleString()} rolls</span>
                </div>
                <select className="audio-speed" value={p.username ?? ''} onChange={e => map(p.id, e.target.value)} aria-label={`Who is ${p.names[0] ?? p.id}`}>
                  <option value="">A guest (shown by their Roll20 name)</option>
                  {Object.entries(players).map(([u, info]) => (
                    <option key={u} value={u}>{info.name ?? u}{info.character ? ` (${info.character})` : ''}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </>
      )}

      {status && status.sessions.length > 0 && (
        <>
          <h3 className="sc dice-h">Sessions</h3>
          <p className="voice-detail" style={{ margin: '0 0 8px' }}>
            {placed} of {status.sessions.length} sessions with rolls are placed in their recording.
            {placed < status.sessions.length && ' The rest had too few rolls said out loud to line up; their Stats tab can place them anyway.'}
          </p>
          <ul className="dice-sessions">
            {status.sessions.map(s => (
              <li key={s.name}>
                <Link to={`/sessions/${encodeURIComponent(s.name)}`}>{s.name}</Link>
                <span className="voice-detail">{s.count} roll{s.count !== 1 ? 's' : ''}{s.state === 'placed' ? (s.forced ? ', placed by hand' : '') : ', not placed'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
