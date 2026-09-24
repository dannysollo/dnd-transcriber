import { useEffect, useState } from 'react'
import { BarList } from '../Charts'
import { formatDuration, percent } from '../chartFormat'

interface CampaignStatsData {
  sessions: number
  duration_seconds: number
  words: number
  per_session: { name: string; created_at: string | null; duration_seconds: number; words: number; lines: number; speakers: number }[]
  people: { person: string; characters: string[]; words: number; seconds: number; sessions: number; share: number }[]
  mentions: { name: string; count: number; sessions: number }[]
}

/** The campaign as a whole: totals, who talks, how long sessions run, and what comes up most. */
export default function CampaignStats({ slug }: { slug: string }) {
  const [data, setData] = useState<CampaignStatsData | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch(`/campaigns/${slug}/stats`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true))
  }, [slug])

  if (failed) return <p style={{ color: 'var(--ink-soft)' }}>Stats couldn't be loaded. Try reloading the page.</p>
  if (!data) return <div className="skeleton" style={{ height: 240, maxWidth: 820 }} />
  if (data.sessions === 0) {
    return <p style={{ color: 'var(--ink-soft)', fontSize: 17 }}>No transcribed sessions yet. Stats appear once the first transcript is in.</p>
  }

  const longest = data.per_session.reduce((a, b) => (b.duration_seconds > a.duration_seconds ? b : a))

  return (
    <div style={{ maxWidth: '820px' }}>
      <p className="stats-sentence">
        {data.sessions} session{data.sessions !== 1 ? 's' : ''} recorded, {formatDuration(data.duration_seconds)} at the table
        and {data.words.toLocaleString()} words spoken. The longest was {longest.name}, at {formatDuration(longest.duration_seconds)}.
      </p>
      <p style={{ margin: '0 0 28px', fontSize: 15, color: 'var(--ink-faint)' }}>
        Talk time is estimated from words spoken, at about 160 words a minute.
      </p>

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
          details: [`${s.words.toLocaleString()} words`, `${s.speakers} speakers`],
        }))}
      />

      {data.mentions.length > 0 && (
        <BarList
          title="Most mentioned"
          note="Campaign names from the vault index and correction rules, not counting the players and their characters."
          valueHeader="Mentions"
          rows={data.mentions.map(m => ({
            key: m.name,
            label: m.name,
            labelText: m.name,
            value: m.count,
            display: m.count.toLocaleString(),
            details: [`in ${m.sessions} session${m.sessions !== 1 ? 's' : ''}`],
          }))}
        />
      )}
    </div>
  )
}
