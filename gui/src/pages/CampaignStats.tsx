import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BarList, PaceChart, TrendLine } from '../Charts'
import { formatDuration, percent } from '../chartFormat'
import { DownloadIcon, SpinnerIcon } from '../Icons'
import { useToast } from '../Toast'

interface Profile {
  person: string
  characters: string[]
  sessions: number
  words: number
  seconds: number
  share: number
  average_share: number
  share_by_session: { session: string; share: number | null }[]
  questions: number
  exclamations: number
  laughs: number
  quoted: number
  favorite_names: { name: string; count: number }[]
  signature_words: { word: string; count: number }[]
}

type Records = Record<string, Record<string, string | number>>

interface CampaignStatsData {
  sessions: number
  duration_seconds: number
  words: number
  per_session: { name: string; created_at: string | null; duration_seconds: number; words: number; lines: number; speakers: number; new_names?: number }[]
  people: { person: string; characters: string[]; words: number; seconds: number; sessions: number; share: number }[]
  mentions: { name: string; count: number; sessions: number; first_session?: string }[]
  records: Records
  profiles: Profile[]
  exchanges?: { a: string; b: string; count: number }[]
  pace?: { start: number; sessions: number; wpm: number }[]
}

const clock = (seconds: number) => `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`

const at = (session: string | number, ts: string | number) => (
  <Link to={`/sessions/${encodeURIComponent(String(session))}#t=${ts}`}>{session}, {ts}</Link>
)

/** Each record as a ledger entry: label, headline value, where it happened. */
function recordEntries(r: Records): { key: string; label: string; value: string; detail: ReactNode; excerpt?: string }[] {
  const out = []
  if (r.longest_monologue) out.push({
    key: 'longest_monologue', label: 'Longest speech',
    value: `${formatDuration(Number(r.longest_monologue.seconds))} from ${r.longest_monologue.person}`,
    detail: <>{Number(r.longest_monologue.words).toLocaleString()} words without a break, {at(r.longest_monologue.session, r.longest_monologue.ts)}</>,
    excerpt: String(r.longest_monologue.excerpt),
  })
  if (r.biggest_night) out.push({
    key: 'biggest_night', label: 'Biggest night',
    value: `${r.biggest_night.person}, ${formatDuration(Number(r.biggest_night.seconds))}`,
    detail: <>{Number(r.biggest_night.words).toLocaleString()} words in {String(r.biggest_night.session)}</>,
  })
  if (r.chattiest_session) out.push({
    key: 'chattiest_session', label: 'Chattiest session',
    value: `${r.chattiest_session.words_per_minute} words a minute`,
    detail: <>{String(r.chattiest_session.session)}</>,
  })
  if (r.liveliest_exchange) out.push({
    key: 'liveliest_exchange', label: 'Liveliest exchange',
    value: `${r.liveliest_exchange.turns} turns in one minute`,
    detail: <>{r.liveliest_exchange.speakers} people talking over each other, {at(r.liveliest_exchange.session, r.liveliest_exchange.ts)}</>,
  })
  if (r.longest_silence) out.push({
    key: 'longest_silence', label: 'Longest silence',
    value: `${r.longest_silence.seconds} seconds`,
    detail: <>broken by {String(r.longest_silence.broken_by)}, {at(r.longest_silence.session, r.longest_silence.ts)}</>,
  })
  if (r.quiet_ones_best_night) out.push({
    key: 'quiet_ones_best_night', label: "The quiet one's best night",
    value: `${r.quiet_ones_best_night.person}, ${percent(Number(r.quiet_ones_best_night.share))} of the talk`,
    detail: <>usually {percent(Number(r.quiet_ones_best_night.usual_share))}; in {String(r.quiet_ones_best_night.session)}</>,
  })
  if (r.most_curious) out.push({
    key: 'most_curious', label: 'Most curious',
    value: String(r.most_curious.person),
    detail: <>{Number(r.most_curious.questions).toLocaleString()} questions asked</>,
  })
  if (r.funniest_night) out.push({
    key: 'funniest_night', label: 'Funniest night',
    value: String(r.funniest_night.session),
    detail: <>{Number(r.funniest_night.laughs)} laughs written into the transcript</>,
  })
  if (r.name_dropper) out.push({
    key: 'name_dropper', label: 'Name-dropper',
    value: String(r.name_dropper.person),
    detail: <>{Number(r.name_dropper.names)} different names from the wiki, the most of any player</>,
  })
  if (r.most_quoted) out.push({
    key: 'most_quoted', label: 'Most quoted',
    value: String(r.most_quoted.person),
    detail: <>{r.most_quoted.quoted} line{Number(r.most_quoted.quoted) !== 1 ? 's' : ''} saved to Quotes</>,
  })
  return out
}

const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

/** The campaign as a whole: totals, records, who talks, each player's profile, and what comes up most. */
export default function CampaignStats({ slug }: { slug: string }) {
  const { toast } = useToast()
  const [data, setData] = useState<CampaignStatsData | null>(null)
  const [failed, setFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [version, setVersion] = useState(0)

  // Stats are computed from the transcripts on every request, so a refresh
  // (or a new PDF) always reflects the latest corrections and sessions.
  useEffect(() => {
    fetch(`/campaigns/${slug}/stats`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { setData(d); setFailed(false) })
      .catch(() => setFailed(true))
      .finally(() => setRefreshing(false))
  }, [slug, version])

  const refresh = () => { setRefreshing(true); setVersion(v => v + 1) }

  /** Build a fresh PDF on the server and save it. */
  const generatePdf = async () => {
    setGenerating(true)
    try {
      const r = await fetch(`/campaigns/${slug}/stats.pdf`)
      if (!r.ok) { toast('Could not generate the PDF', 'error'); return }
      const name = r.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? `${slug}-stats.pdf`
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url; a.download = name
      document.body.append(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast('Stats PDF downloaded', 'success')
    } catch {
      toast('Could not generate the PDF', 'error')
    } finally {
      setGenerating(false)
    }
  }

  if (failed) return <p style={{ color: 'var(--ink-soft)' }}>Stats couldn't be loaded. Try reloading the page.</p>
  if (!data) return <div className="skeleton" style={{ height: 240, maxWidth: 820 }} />
  if (data.sessions === 0) {
    return <p style={{ color: 'var(--ink-soft)', fontSize: 17 }}>No transcribed sessions yet. Stats appear once the first transcript is in.</p>
  }

  const longest = data.per_session.reduce((a, b) => (b.duration_seconds > a.duration_seconds ? b : a))
  const shareMax = Math.max(0.05, ...data.profiles.flatMap(p => p.share_by_session.map(s => s.share ?? 0)))
  const records = recordEntries(data.records)

  return (
    <div style={{ maxWidth: '860px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
        <p className="stats-sentence" style={{ flex: '1 1 420px' }}>
          {data.sessions} session{data.sessions !== 1 ? 's' : ''} recorded, {formatDuration(data.duration_seconds)} at the table
          and {data.words.toLocaleString()} words spoken. The longest was {longest.name}, at {formatDuration(longest.duration_seconds)}.
        </p>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button type="button" className="btn-ghost" onClick={refresh} disabled={refreshing}
            title="Recount everything from the current transcripts">
            {refreshing ? 'Refreshing…' : 'Refresh stats'}
          </button>
          <button type="button" className="btn-primary" onClick={generatePdf} disabled={generating}
            title="Build a fresh PDF of these stats from the current transcripts and download it"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {generating ? <><SpinnerIcon /> Generating PDF…</> : <><DownloadIcon /> Generate PDF</>}
          </button>
        </div>
      </div>
      <p style={{ margin: '0 0 28px', fontSize: 15, color: 'var(--ink-faint)' }}>
        Talk time is estimated from words spoken, at about 160 words a minute.
      </p>

      {records.length > 0 && (
        <section aria-label="Records">
          <div className="barlist-head"><h3 className="sc">Records</h3></div>
          <div className="records">
            {records.map(r => (
              <div key={r.key} className="record">
                <div className="record-label">{r.label}</div>
                <div className="record-value">{r.value}</div>
                <div className="record-detail">{r.detail}</div>
                {r.excerpt && <div className="record-excerpt">“{r.excerpt}”</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <BarList
        title="Who talks most"
        valueHeader="Talk time"
        rows={data.people.map(p => ({
          key: p.person,
          label: <>{p.person}{p.characters.length > 0 && <span className="speaker-player" style={{ marginLeft: 6 }}>{p.characters.join(', ')}</span>}</>,
          labelText: p.characters.length ? `${p.person} (${p.characters.join(', ')})` : p.person,
          value: p.seconds,
          display: `${formatDuration(p.seconds)}, ${percent(p.share)}`,
          details: [`${p.words.toLocaleString()} words`, `in ${p.sessions} session${p.sessions !== 1 ? 's' : ''}`],
        }))}
      />

      <section aria-label="Players" style={{ marginBottom: 36 }}>
        <div className="barlist-head"><h3 className="sc">Players</h3></div>
        <p className="barlist-note">Share of the table's talk, session by session, on the same scale for everyone.</p>
        {data.profiles.map(p => (
          <div key={p.person} className="profile">
            <div>
              <div className="profile-name">
                {p.person}
                {p.characters.length > 0 && <span className="speaker-name" style={{ marginLeft: 10, fontSize: 18 }}>{p.characters.join(', ')}</span>}
              </div>
              <p className="profile-line">
                <b>{p.sessions}</b> session{p.sessions !== 1 ? 's' : ''}, <b>{formatDuration(p.seconds)}</b> of talk,
                usually <b>{percent(p.average_share)}</b> of a session.
              </p>
              <p className="profile-line">
                Asked <b>{p.questions.toLocaleString()}</b> questions, exclaimed <b>{p.exclamations.toLocaleString()}</b> times
                {p.laughs > 0 && <>, laughed out loud <b>{p.laughs}</b> times</>}
                {p.quoted > 0 && <>, quoted <b>{p.quoted}</b> time{p.quoted !== 1 ? 's' : ''}</>}.
              </p>
              {p.favorite_names.length > 0 && (
                <p className="profile-line">Talks most about {list(p.favorite_names.map(n => n.name))}.</p>
              )}
              {p.signature_words.length > 0 && (
                <p className="profile-line">Signature words: {list(p.signature_words.map(w => `“${w.word}”`))}.</p>
              )}
            </div>
            <div>
              <div className="profile-trend-label">Share of talk per session</div>
              <TrendLine
                label={`${p.person}'s share of talk per session`}
                max={shareMax}
                format={percent}
                points={p.share_by_session.map(s => ({ label: s.session, value: s.share }))}
              />
            </div>
          </div>
        ))}
      </section>

      {data.sessions > 1 && <Attendance profiles={data.profiles} sessions={data.per_session.map(s => s.name)} />}

      <PaceChart
        title="Pace through the night"
        note="Words a minute in each half hour, averaged over every session that ran that long."
        points={(data.pace ?? []).map(p => ({
          label: `${clock(p.start)}–${clock(p.start + 1800)}`,
          value: p.wpm,
        }))}
      />

      {(data.exchanges ?? []).length > 0 && (
        <BarList
          title="Who talks to whom"
          note="How often the conversation passed directly between two people, across every session."
          valueHeader="Exchanges"
          rows={data.exchanges!.map(e => ({
            key: `${e.a}|${e.b}`,
            label: `${e.a} and ${e.b}`,
            labelText: `${e.a} and ${e.b}`,
            value: e.count,
            display: e.count.toLocaleString(),
          }))}
        />
      )}

      <BarList
        title="Session length"
        note="In the order sessions were added."
        valueHeader="Length"
        rows={data.per_session.map(s => ({
          key: s.name,
          label: s.name,
          labelText: s.name,
          value: s.duration_seconds,
          display: formatDuration(s.duration_seconds),
          details: [`${s.words.toLocaleString()} words`, `${s.speakers} speakers`,
            ...(s.new_names ? [`${s.new_names} name${s.new_names !== 1 ? 's' : ''} mentioned for the first time`] : [])],
        }))}
      />

      {data.mentions.length > 0 && (
        <BarList
          title="Most mentioned"
          note="Names from the campaign wiki, not counting the players and their characters."
          valueHeader="Mentions"
          rows={data.mentions.map(m => ({
            key: m.name,
            label: m.name,
            labelText: m.name,
            value: m.count,
            display: m.count.toLocaleString(),
            details: [`in ${m.sessions} session${m.sessions !== 1 ? 's' : ''}`, ...(m.first_session ? [`first in ${m.first_session}`] : [])],
          }))}
        />
      )}
    </div>
  )
}

/** Who was at which session: one row per person, one column per session in order. */
function Attendance({ profiles, sessions }: { profiles: Profile[]; sessions: string[] }) {
  const everyone = profiles.every(p => p.share_by_session.every(s => s.share !== null))
  return (
    <section aria-label="Attendance" style={{ marginBottom: 36 }}>
      <div className="barlist-head"><h3 className="sc">Attendance</h3></div>
      {everyone ? (
        <p className="barlist-note">Everyone has been at every session.</p>
      ) : (
        <>
          <p className="barlist-note">Sessions numbered in the order they were added. Hover a number for its name.</p>
          <div className="attendance-wrap">
            <table className="attendance">
              <thead>
                <tr><td />{sessions.map((s, i) => <th key={s} scope="col" title={s}>{i + 1}</th>)}<th scope="col">Missed</th></tr>
              </thead>
              <tbody>
                {profiles.map(p => {
                  const missed = p.share_by_session.filter(s => s.share === null).length
                  return (
                    <tr key={p.person}>
                      <th scope="row">{p.person}</th>
                      {p.share_by_session.map(s => (
                        <td key={s.session} title={`${s.session}: ${s.share === null ? 'absent' : 'present'}`}>
                          <span className={s.share === null ? 'gap' : 'mark'} aria-label={s.share === null ? 'absent' : 'present'} />
                        </td>
                      ))}
                      <td>{missed}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
