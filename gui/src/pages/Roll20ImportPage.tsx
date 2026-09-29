import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

// Where the "Send to Co-DM" bookmarklet (Dice.tsx) delivers a Roll20 chat
// archive. Roll20's pages may only send data to Roll20 itself, so the
// bookmarklet opens this page instead and hands it the archive by
// postMessage; this page uploads it with the DM's own login. The Roll20
// campaign id picks the Co-DM campaign (remembered from earlier imports).

const ROLL20_ORIGIN = 'https://app.roll20.net'

interface Campaign { slug: string; name: string; role: string }
type State =
  | { step: 'waiting' }
  | { step: 'choose'; html: string; roll20: string; campaigns: Campaign[] }
  | { step: 'importing'; name: string }
  | { step: 'done'; name: string; slug: string; added: number; total: number }
  | { step: 'error'; message: string }

async function importTo(slug: string, html: string) {
  const form = new FormData()
  form.append('file', new Blob([html], { type: 'text/html' }), 'chat-archive.html')
  const r = await fetch(`/campaigns/${slug}/roll20/import`, { method: 'POST', body: form })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.detail ?? `Import failed (${r.status})`)
  return d as { added: number; total: number }
}

export default function Roll20ImportPage() {
  const [state, setState] = useState<State>({ step: 'waiting' })
  const got = useRef(false)

  const run = async (c: Campaign, html: string) => {
    setState({ step: 'importing', name: c.name })
    try {
      const d = await importTo(c.slug, html)
      setState({ step: 'done', name: c.name, slug: c.slug, ...d })
    } catch (e) {
      setState({ step: 'error', message: (e as Error).message })
    }
  }

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      if (e.origin !== ROLL20_ORIGIN || e.data?.type !== 'codm-roll20-archive' || got.current) return
      got.current = true
      const html: string = e.data.html ?? ''
      const roll20 = String(e.data.campaign ?? '')
      ;(e.source as Window | null)?.postMessage({ type: 'codm-roll20-received' }, ROLL20_ORIGIN)
      const all: Campaign[] = await fetch('/campaigns').then(r => (r.ok ? r.json() : [])).catch(() => [])
      const mine = all.filter(c => c.role === 'dm')
      if (!mine.length) {
        setState({ step: 'error', message: 'Only a campaign\'s DM can import rolls. Log into Co-DM as the DM in this browser and click the bookmark again.' })
        return
      }
      // The campaign this Roll20 game was imported into before, else ask (or the only one).
      const known = await Promise.all(mine.map(c => fetch(`/campaigns/${c.slug}/roll20`)
        .then(r => (r.ok ? r.json() : null)).then(d => (d?.roll20_campaign === roll20 ? c : null)).catch(() => null)))
      const match = known.find(Boolean) ?? (mine.length === 1 ? mine[0] : null)
      if (match) run(match, html)
      else setState({ step: 'choose', html, roll20, campaigns: mine })
    }
    window.addEventListener('message', onMessage)
    // Tell the Roll20 tab we're ready (it waits for this before sending).
    const ping = () => window.opener?.postMessage({ type: 'codm-ready' }, ROLL20_ORIGIN)
    ping()
    const t = window.setInterval(() => { if (!got.current) ping() }, 1000)
    const giveUp = window.setTimeout(() => {
      if (!got.current) setState({ step: 'error', message: 'Nothing arrived from Roll20. Open your Roll20 campaign (or its Chat Archive) and click the "Send to Co-DM" bookmark there.' })
    }, 45000)
    return () => { window.removeEventListener('message', onMessage); window.clearInterval(t); window.clearTimeout(giveUp) }
  }, [])

  return (
    <div className="page-content roll20-import">
      <h1 className="sc">Roll20 dice</h1>
      {state.step === 'waiting' && <p>Receiving the chat archive from Roll20…</p>}
      {state.step === 'importing' && <p>Importing the rolls into {state.name}…</p>}
      {state.step === 'choose' && (
        <>
          <p>Which campaign are these rolls for? It's remembered for next time.</p>
          <div className="roll20-choose">
            {state.campaigns.map(c => (
              <button key={c.slug} type="button" className="btn-secondary" onClick={() => run(c, state.html)}>{c.name}</button>
            ))}
          </div>
        </>
      )}
      {state.step === 'done' && (
        <>
          <p>
            {state.added
              ? `${state.added.toLocaleString()} new roll${state.added !== 1 ? 's' : ''} imported into ${state.name}`
              : `No new rolls; ${state.name} already has all of them`} ({state.total.toLocaleString()} in all).
          </p>
          <p className="roll20-note">You can close this tab. <Link to={`/campaigns/${state.slug}/settings`}>See how each session's rolls were placed</Link>.</p>
        </>
      )}
      {state.step === 'error' && <p className="roll20-error">{state.message}</p>}
    </div>
  )
}
