import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApiUrl, useCampaign } from '../CampaignContext'
import { useAuth } from '../AuthContext'
import { useToast } from '../Toast'
import { CloseIcon, DownloadIcon, PauseIcon, PlayIcon } from '../Icons'

interface Quote {
  id: string
  session: string
  ts: string
  start: number
  end: number | null
  speaker: string | null
  text: string
  saved_by: string | null
  saved_by_id: number | null
  saved_at: string
  has_audio: boolean
}

/** "Kali [Marko]" -> {name: Kali, player: Marko} */
function splitSpeaker(speaker: string | null) {
  if (!speaker) return { name: '', player: '' }
  const m = speaker.match(/^(.*?)\s*[[(]([^\])]+)[\])]\s*$/)
  return m ? { name: m[1], player: m[2] } : { name: speaker, player: '' }
}

export default function QuotesPage() {
  const apiUrl = useApiUrl()
  const { activeCampaign } = useCampaign()
  const { user, authEnabled } = useAuth()
  const { toast } = useToast()
  const [quotes, setQuotes] = useState<Quote[] | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const slug = activeCampaign?.slug
  useEffect(() => {
    if (!slug) return
    fetch(apiUrl('/quotes'))
      .then(r => (r.ok ? r.json() : []))
      .then(setQuotes)
      .catch(() => setQuotes([]))
  }, [slug, apiUrl])

  const clipUrl = (q: Quote, download = false) => {
    const params = new URLSearchParams({ start: String(q.start) })
    if (q.end) params.set('end', String(q.end))
    if (download) params.set('download', 'true')
    return apiUrl(`/sessions/${encodeURIComponent(q.session)}/clip?${params}`)
  }

  const togglePlay = (q: Quote) => {
    const el = audioRef.current
    if (!el) return
    if (playing === q.id) { el.pause(); setPlaying(null); return }
    el.src = clipUrl(q)
    el.play().then(() => setPlaying(q.id)).catch(() => toast('Could not play this clip', 'error'))
  }

  const remove = async (q: Quote) => {
    const r = await fetch(apiUrl(`/sessions/${encodeURIComponent(q.session)}/quotes/${q.id}`), { method: 'DELETE' })
    if (r.ok || r.status === 204) setQuotes(prev => prev?.filter(x => x.id !== q.id) ?? null)
    else toast(r.status === 403 ? 'Only whoever saved this quote, or a DM, can remove it' : 'Could not remove the quote', 'error')
  }

  const isDm = !authEnabled || activeCampaign?.role === 'dm'

  return (
    <div className="page-content" style={{ padding: '40px 56px', maxWidth: '920px' }}>
      <audio ref={audioRef} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)} hidden />
      <h1 style={{ margin: 0, fontSize: '34px', lineHeight: 1.15 }}>
        Quotes
        {quotes && quotes.length > 0 && (
          <span style={{ marginLeft: 12, fontSize: 20, color: 'var(--ink-faint)' }}>{quotes.length}</span>
        )}
      </h1>
      <p style={{ margin: '4px 0 28px', color: 'var(--ink-soft)', fontSize: '17px' }}>
        Lines the table saved from any session. Save one by hovering a transcript line and clicking the quote mark.
      </p>

      {!activeCampaign ? (
        <p style={{ color: 'var(--ink-soft)' }}>Pick a campaign to see its quotes.</p>
      ) : quotes === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: 64 }} />)}
        </div>
      ) : quotes.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }}>
          <div style={{ fontSize: 24, color: 'var(--ink)', marginBottom: 6 }}>No quotes yet</div>
          <div style={{ fontSize: 17, color: 'var(--ink-soft)' }}>
            Open a session, hover a line worth remembering, and click the quote mark beside it.
          </div>
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--rule)' }}>
          {quotes.map(q => {
            const who = splitSpeaker(q.speaker)
            const mine = user && q.saved_by_id === user.id
            return (
              <article key={q.id} className="quote-entry">
                <blockquote>{q.text}</blockquote>
                <div className="quote-meta">
                  <span>
                    {who.name && <span className="speaker-name" style={{ marginRight: 6 }}>{who.name}</span>}
                    {who.player && <span className="speaker-player" style={{ marginRight: 10 }}>{who.player}</span>}
                    <Link to={`/sessions/${encodeURIComponent(q.session)}#t=${q.ts}`} className="quote-source">
                      {q.session}, {q.ts}
                    </Link>
                  </span>
                  <span style={{ flex: 1 }} />
                  {q.has_audio && (
                    <>
                      <button type="button" className="audio-play" onClick={() => togglePlay(q)}
                        aria-label={playing === q.id ? 'Pause clip' : 'Play clip'}>
                        {playing === q.id ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
                      </button>
                      <a className="entry-action" href={clipUrl(q, true)} aria-label="Download clip" title="Download clip (MP3)">
                        <DownloadIcon />
                      </a>
                    </>
                  )}
                  {(mine || isDm) && (
                    <button type="button" className="entry-action danger" onClick={() => remove(q)}
                      aria-label="Remove quote" title="Remove quote">
                      <CloseIcon />
                    </button>
                  )}
                </div>
                {q.saved_by && (
                  <div style={{ fontSize: 14, color: 'var(--ink-faint)', marginTop: 2 }}>
                    Saved by {q.saved_by}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
