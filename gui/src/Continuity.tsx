import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from './Toast'

// Continuity checks (server: continuity.json per session, worker/continuity.py):
// where the wiki disagrees with what happened in a session. Shown on the
// session's Wiki tab and, for the DM, on the wiki page concerned. Apply fix
// swaps the quoted wording for the suggested one through the wiki's own save
// (committed to the vault like any edit); nothing changes without a click.

export interface ContinuityItem {
  id: number; title: string; page: string; page_slug?: string | null
  kind: 'contradiction' | 'date' | 'spelling'; wiki: string; session: string; ts?: string | null
  fix?: string | null; status: 'open' | 'fixed' | 'dismissed'
}
interface SessionContinuityData { pending: boolean; generated: string | null; error: string | null; items: ContinuityItem[] }

/** Page wording for reading: without the markdown ("**Jul 2025** — [[Iji]]" -> "Jul 2025 — Iji"). Apply fix uses the exact text. */
const plain = (md: string) => md
  .replace(/^\s*[-*]\s+/, '')
  .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
  .replace(/(\*\*|__|\*|_)(.+?)\1/g, '$2')

const KIND = { contradiction: 'Contradicts the session', date: 'Wrong date', spelling: 'Spelling' }

/** Swap the quoted text for the fix on the page. Returns an error message, or null when saved. */
async function applyFix(slug: string, it: { page_slug?: string | null; wiki: string; fix?: string | null }): Promise<string | null> {
  if (!it.page_slug || !it.fix) return 'No fix to apply'
  const r = await fetch(`/campaigns/${slug}/wiki/pages/${encodeURIComponent(it.page_slug)}`)
  if (!r.ok) return 'Could not open the page'
  const page = await r.json()
  const md: string = page.markdown
  const at = md.indexOf(it.wiki)
  if (at < 0 || md.indexOf(it.wiki, at + 1) >= 0) return "The quoted text isn't on the page as written (or is there twice). Edit the page instead."
  const save = await fetch(`/campaigns/${slug}/wiki/pages/${encodeURIComponent(it.page_slug)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown: md.slice(0, at) + it.fix + md.slice(at + it.wiki.length), base_hash: page.hash }),
  })
  if (!save.ok) return (await save.json().catch(() => ({}))).detail ?? 'Could not save the page'
  return null
}

function ItemRow({ it, slug, canEdit, onJump, sessionLink, onStatus }: {
  it: ContinuityItem & { sessionName?: string }; slug: string; canEdit: boolean
  onJump?: (ts: string) => void; sessionLink?: boolean
  onStatus: (status: ContinuityItem['status']) => Promise<void>
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const done = it.status !== 'open'
  const fix = async () => {
    setBusy(true)
    try {
      const problem = await applyFix(slug, it)
      if (problem) { toast(problem, 'error'); return }
      await onStatus('fixed')
      toast(`${it.page.split('/').pop()?.replace(/\.md$/, '')} updated`, 'success')
    } finally { setBusy(false) }
  }
  const pageTitle = it.page.split('/').pop()?.replace(/\.md$/, '')
  return (
    <li className={'continuity-item' + (done ? ' done' : '')}>
      <div className="continuity-head">
        <span className="continuity-title">{it.title}</span>
        <span className="continuity-kind">{KIND[it.kind] ?? it.kind}</span>
        {done && <span className="continuity-kind">{it.status === 'fixed' ? 'fixed' : 'dismissed'}</span>}
      </div>
      <div className="continuity-row">
        <span className="continuity-label">
          {it.page_slug ? <Link to={`/campaigns/${slug}/wiki/${it.page_slug}`}>{pageTitle}</Link> : pageTitle} says
        </span>
        <span className="continuity-quote">{plain(it.wiki)}</span>
      </div>
      <div className="continuity-row">
        <span className="continuity-label">
          {sessionLink && it.sessionName
            ? <Link to={`/sessions/${encodeURIComponent(it.sessionName)}${it.ts ? `#t=${it.ts}` : ''}`}>{it.sessionName.split(' -- ')[0]}</Link>
            : 'The session'}
        </span>
        <span>
          {it.session}
          {it.ts && (onJump
            ? <> <button type="button" className="continuity-ts" onClick={() => onJump(it.ts!)}>[{it.ts}]</button></>
            : <> <span className="continuity-ts">[{it.ts}]</span></>)}
        </span>
      </div>
      {it.fix && (
        <div className="continuity-row">
          <span className="continuity-label">Suggested</span>
          <span className="continuity-fix">{plain(it.fix)}</span>
        </div>
      )}
      {canEdit && (
        <div className="continuity-actions">
          {done ? (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => onStatus('open')}>Reopen</button>
          ) : (
            <>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => onStatus('dismissed')}
                title="Not actually a problem">Dismiss</button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => onStatus('fixed')}
                title="You fixed it yourself">Mark fixed</button>
              {it.fix && it.page_slug && (
                <button type="button" className="btn-secondary" disabled={busy} onClick={fix}
                  title="Replace the quoted text on the page with the suggested wording">Apply fix</button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  )
}

/** The session's Wiki tab: what this session says the wiki has wrong. */
export function SessionContinuity({ slug, sessionName, canEdit, onJump }: {
  slug: string; sessionName: string; canEdit: boolean; onJump?: (ts: string) => void
}) {
  const { toast } = useToast()
  const [data, setData] = useState<SessionContinuityData | null>(null)
  const [showDone, setShowDone] = useState(false)
  const base = `/campaigns/${slug}/sessions/${encodeURIComponent(sessionName)}/continuity`
  const load = () => fetch(base).then(r => (r.ok ? r.json() : null)).then(setData).catch(() => setData(null))
  useEffect(() => { load() }, [slug, sessionName])
  // While a check is queued or running, look again every 20 s.
  useEffect(() => {
    if (!data?.pending) return
    const t = window.setInterval(load, 20000)
    return () => window.clearInterval(t)
  }, [data?.pending])

  if (!data) return null
  const open = data.items.filter(i => i.status === 'open')
  const done = data.items.filter(i => i.status !== 'open')
  const run = async () => {
    const r = await fetch(`${base}/run`, { method: 'POST' })
    if (!r.ok) { toast('Could not queue the check', 'error'); return }
    setData(await r.json())
  }
  const setStatus = async (it: ContinuityItem, status: ContinuityItem['status']) => {
    const r = await fetch(`${base}/${it.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    if (!r.ok) { toast('Could not update it', 'error'); return }
    setData(d => d && { ...d, items: d.items.map(x => (x.id === it.id ? { ...x, status } : x)) })
  }
  if (!canEdit && open.length === 0) return null

  return (
    <section className="continuity" aria-label="Continuity">
      <div className="continuity-bar">
        <h3>Continuity{open.length > 0 && <span className="continuity-count">{open.length} to check</span>}</h3>
        <span className="continuity-note">
          {data.pending ? 'Checking the wiki against this session… (on the worker)'
            : data.error ? `The last check failed: ${data.error}`
            : data.generated ? (open.length ? 'Where the wiki disagrees with this session.' : 'The wiki agrees with this session.')
            : 'Not checked yet.'}
        </span>
        {canEdit && !data.pending && (
          <button type="button" className="btn-ghost" onClick={run}>{data.generated ? 'Check again' : 'Check'}</button>
        )}
      </div>
      {open.length > 0 && (
        <ul className="continuity-list">
          {open.map(it => <ItemRow key={it.id} it={it} slug={slug} canEdit={canEdit} onJump={onJump} onStatus={s => setStatus(it, s)} />)}
        </ul>
      )}
      {done.length > 0 && canEdit && (
        <>
          <button type="button" className="continuity-toggle" onClick={() => setShowDone(v => !v)} aria-expanded={showDone}>
            {showDone ? 'Hide' : 'Show'} {done.length} dealt with
          </button>
          {showDone && (
            <ul className="continuity-list">
              {done.map(it => <ItemRow key={it.id} it={it} slug={slug} canEdit={canEdit} onJump={onJump} onStatus={s => setStatus(it, s)} />)}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

/** A wiki page (DM only): open findings about this page from any session. */
export function PageContinuity({ slug, path, onChanged }: { slug: string; path: string; onChanged: () => void }) {
  const { toast } = useToast()
  const [items, setItems] = useState<(ContinuityItem & { sessionName: string })[]>([])
  const load = () => fetch(`/campaigns/${slug}/continuity?page=${encodeURIComponent(path)}`)
    .then(r => (r.ok ? r.json() : { items: [] }))
    .then(d => setItems(d.items.map((it: ContinuityItem & { session: string; claim: string }) => ({ ...it, sessionName: it.session, session: it.claim }))))
    .catch(() => setItems([]))
  useEffect(() => { load() }, [slug, path])
  if (items.length === 0) return null
  const setStatus = async (it: ContinuityItem & { sessionName: string }, status: ContinuityItem['status']) => {
    const r = await fetch(`/campaigns/${slug}/sessions/${encodeURIComponent(it.sessionName)}/continuity/${it.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    })
    if (!r.ok) { toast('Could not update it', 'error'); return }
    if (status === 'fixed') onChanged()
    load()
  }
  return (
    <section className="continuity continuity-page" aria-label="Continuity">
      <div className="continuity-bar">
        <h3>Continuity<span className="continuity-count">{items.length} to check</span></h3>
        <span className="continuity-note">Sessions that disagree with this page.</span>
      </div>
      <ul className="continuity-list">
        {items.map(it => <ItemRow key={`${it.sessionName}|${it.id}`} it={it} slug={slug} canEdit sessionLink onStatus={s => setStatus(it, s)} />)}
      </ul>
    </section>
  )
}

/** Wiki DM tools: queue a check of every session, oldest first. */
export function ContinuityCheckAll({ slug }: { slug: string }) {
  const { toast } = useToast()
  const [state, setState] = useState<{ open: number; queued: number } | null>(null)
  const load = () => fetch(`/campaigns/${slug}/continuity`).then(r => (r.ok ? r.json() : null))
    .then(d => d && setState({ open: d.items.length, queued: d.queued })).catch(() => {})
  useEffect(() => { load() }, [slug])
  useEffect(() => {
    if (!state?.queued) return
    const t = window.setInterval(load, 30000)
    return () => window.clearInterval(t)
  }, [state?.queued])
  const runAll = async () => {
    const r = await fetch(`/campaigns/${slug}/continuity/run-all`, { method: 'POST' })
    if (!r.ok) { toast('Could not queue the checks', 'error'); return }
    const d = await r.json()
    toast(`Checking ${d.queued} sessions against the wiki, oldest first. Findings show on each page and session.`, 'success')
    load()
  }
  if (!state) return null
  return (
    <div className="continuity-all">
      <span>
        Continuity: {state.open ? `${state.open} finding${state.open !== 1 ? 's' : ''} to check` : 'nothing open'}
        {state.queued ? `, ${state.queued} session${state.queued !== 1 ? 's' : ''} still queued` : ''}
      </span>
      {!state.queued && <button type="button" className="btn-ghost" onClick={runAll}
        title="Check the wiki against every session, oldest first (one at a time on the worker)">Check every session</button>}
    </div>
  )
}
