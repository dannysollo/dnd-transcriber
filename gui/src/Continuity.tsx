import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from './Toast'

// Suggested fixes for the wiki, from two places: continuity checks (server:
// continuity.json per session, worker/continuity.py), where the wiki disagrees
// with what happened in a session; and reports people wrote on the wiki
// (wiki_reports.json, worker/wiki_fix.py; source "report"). Shown on the
// session's Wiki tab (its own checks), and for the DM on the wiki page concerned
// and in the wiki's review list. Apply fix swaps the quoted wording for the
// suggested one through the wiki's own save (committed to the vault like any
// edit); nothing changes without a click.

export interface ContinuityItem {
  id: number; title: string; page: string; page_slug?: string | null
  kind: 'contradiction' | 'date' | 'spelling' | 'report'; wiki: string; session: string; ts?: string | null
  source?: 'report'; reported?: string; by?: string; report_id?: number   // from a wiki report
  // dismissed = skipped (set aside, can be reopened); ignored = dismissed, the page left as it is
  fix?: string | null; status: 'open' | 'fixed' | 'dismissed' | 'ignored'
}
interface SessionContinuityData { pending: boolean; generated: string | null; error: string | null; items: ContinuityItem[] }

/** Page wording for reading: without the markdown ("**Jul 2025** — [[Iji]]" -> "Jul 2025 — Iji"). Apply fix uses the exact text. */
const plain = (md: string) => md
  .replace(/^\s*[-*]\s+/, '')
  .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
  .replace(/(\*\*|__|\*|_)(.+?)\1/g, '$2')

const KIND = { contradiction: 'Contradicts the session', date: 'Wrong date', spelling: 'Spelling', report: 'From a report' }

/** Where an item's status is saved: its session's continuity check, or the wiki's reports. */
export const statusUrl = (slug: string, it: ContinuityItem & { sessionName?: string }) => it.source === 'report'
  ? `/campaigns/${slug}/wiki/suggestions/${it.id}`
  : `/campaigns/${slug}/sessions/${encodeURIComponent(it.sessionName ?? '')}/continuity/${it.id}`
const itemKey = (it: ContinuityItem & { sessionName?: string }) => it.source === 'report' ? `report|${it.id}` : `${it.sessionName}|${it.id}`
const DONE: Record<ContinuityItem['status'], string> = { open: '', fixed: 'fixed', dismissed: 'skipped', ignored: 'dismissed' }

/** "2 fixed, 1 skipped" for a list of handled items. */
export const handledSummary = (items: { status: ContinuityItem['status'] }[]) =>
  (['fixed', 'dismissed', 'ignored'] as const)
    .map(st => [items.filter(i => i.status === st).length, DONE[st]] as const)
    .filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`).join(', ')

/** Swap the quoted text for the fix (or `text`, written by hand) on the page. Returns an error message, or null when saved. */
async function applyFix(slug: string, it: { page_slug?: string | null; wiki: string; fix?: string | null }, text?: string): Promise<string | null> {
  const replacement = text ?? it.fix
  if (!it.page_slug || replacement == null) return 'No fix to apply'
  const r = await fetch(`/campaigns/${slug}/wiki/pages/${encodeURIComponent(it.page_slug)}`)
  if (!r.ok) return 'Could not open the page'
  const page = await r.json()
  const md: string = page.markdown
  const at = md.indexOf(it.wiki)
  if (at < 0 || md.indexOf(it.wiki, at + 1) >= 0) return "The quoted text isn't on the page as written (or is there twice). Edit the page instead."
  const save = await fetch(`/campaigns/${slug}/wiki/pages/${encodeURIComponent(it.page_slug)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown: md.slice(0, at) + replacement + md.slice(at + it.wiki.length), base_hash: page.hash }),
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
  const [draft, setDraft] = useState<string | null>(null)   // the line, being written by hand
  const done = it.status !== 'open'
  const fix = async (text?: string) => {
    setBusy(true)
    try {
      const problem = await applyFix(slug, it, text)
      if (problem) { toast(problem, 'error'); return }
      await onStatus('fixed')
      setDraft(null)
      toast(`${it.page.split('/').pop()?.replace(/\.md$/, '')} updated`, 'success')
    } finally { setBusy(false) }
  }
  const pageTitle = it.page.split('/').pop()?.replace(/\.md$/, '')
  return (
    <li className={'continuity-item' + (done ? ' done' : '')}>
      <div className="continuity-head">
        <span className="continuity-title">{it.title}</span>
        <span className="continuity-kind">{KIND[it.kind] ?? it.kind}</span>
        {done && <span className="continuity-kind">{DONE[it.status]}</span>}
      </div>
      <div className="continuity-row">
        <span className="continuity-label">
          {it.page_slug ? <Link to={`/campaigns/${slug}/wiki/${it.page_slug}`}>{pageTitle}</Link> : pageTitle} says
        </span>
        <span className="continuity-quote">{plain(it.wiki)}</span>
      </div>
      {it.source === 'report' ? (
        <div className="continuity-row">
          <span className="continuity-label">
            <Link to={`/campaigns/${slug}/wiki/_reports`}>{it.by ?? 'Someone'} reported</Link>
          </span>
          <span>
            “{it.reported}”
            {it.session && <span className="continuity-why">{it.session}</span>}
          </span>
        </div>
      ) : (
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
      )}
      {it.fix && (
        <div className="continuity-row">
          <span className="continuity-label">Suggested</span>
          <span className="continuity-fix">{plain(it.fix)}</span>
        </div>
      )}
      {canEdit && draft !== null && (
        <div className="continuity-edit">
          <label className="continuity-label" htmlFor={`ce-${it.id}`}>Replace the quoted line with</label>
          <textarea id={`ce-${it.id}`} value={draft} onChange={e => setDraft(e.target.value)} rows={3} autoFocus spellCheck />
          <div className="continuity-actions">
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className="btn-secondary" disabled={busy || draft === it.wiki} onClick={() => fix(draft)}>Save to the page</button>
          </div>
        </div>
      )}
      {canEdit && draft === null && (
        <div className="continuity-actions">
          {done ? (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => onStatus('open')}>Reopen</button>
          ) : (
            <>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => onStatus('dismissed')}
                title="Set it aside for now; it stays under the handled ones and can be reopened">Skip</button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => onStatus('ignored')}
                title="Not a problem: leave the page as it is">Dismiss</button>
              {it.page_slug && (
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => setDraft(it.fix ?? it.wiki)}
                  title="Write the replacement for the quoted line yourself">Edit line</button>
              )}
              {it.fix && it.page_slug && (
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => fix()}
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
            {showDone ? 'Hide' : 'Show'} the {done.length} handled ({handledSummary(done)})
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
    const r = await fetch(statusUrl(slug, it), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    })
    if (!r.ok) { toast('Could not update it', 'error'); return }
    if (status === 'fixed') onChanged()
    load()
  }
  return (
    <section className="continuity continuity-page" aria-label="Continuity">
      <div className="continuity-bar">
        <h3>Suggested fixes<span className="continuity-count">{items.length} to review</span></h3>
        <span className="continuity-note">From continuity checks (sessions that disagree with this page) and reports.</span>
      </div>
      <ul className="continuity-list">
        {items.map(it => <ItemRow key={itemKey(it)} it={it} slug={slug} canEdit sessionLink onStatus={s => setStatus(it, s)} />)}
      </ul>
    </section>
  )
}

/** Wiki DM tools: queue a check of every session not checked yet, oldest first.
 * Meant to be rare: once to catch a wiki up, then every dozen sessions or so. */
type CampaignItem = ContinuityItem & { sessionName: string }

/** Oldest session first ("M-D-YYYY -- Title"). */
const sessionKey = (name?: string) => {
  const m = (name ?? '').match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
  return m ? Number(m[3]) * 10000 + Number(m[1]) * 100 + Number(m[2]) : 99999999
}

/** "3 unchecked sessions", "2 changed sessions", "3 unchecked and 2 changed sessions". */
function checkLabel(unchecked: number, changed: number): string {
  const n = unchecked + changed
  const what = [unchecked && `${unchecked} unchecked`, changed && `${changed} changed`].filter(Boolean).join(' and ')
  return `${what} session${n !== 1 ? 's' : ''}`
}

export function ContinuityCheckAll({ slug }: { slug: string }) {
  const { toast } = useToast()
  const [state, setState] = useState<{ queued: number; unchecked: number; changed: number } | null>(null)
  const [items, setItems] = useState<CampaignItem[]>([])
  const [reviewing, setReviewing] = useState(false)
  const load = () => fetch(`/campaigns/${slug}/continuity`).then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (!d) return
      setState({ queued: d.queued, unchecked: d.unchecked ?? 0, changed: d.changed ?? 0 })
      // The campaign endpoint names the session "session" and the finding's text "claim".
      setItems(d.items.map((it: ContinuityItem & { session: string; claim: string }) => ({ ...it, sessionName: it.session, session: it.claim })))
    }).catch(() => {})
  useEffect(() => { load() }, [slug])
  // While sessions are queued, new findings keep arriving: look again every 30 s.
  useEffect(() => {
    if (!state?.queued) return
    const t = window.setInterval(load, 30000)
    return () => window.clearInterval(t)
  }, [state?.queued])
  const runAll = async () => {
    const r = await fetch(`/campaigns/${slug}/continuity/run-all`, { method: 'POST' })
    if (!r.ok) { toast('Could not queue the checks', 'error'); return }
    const d = await r.json()
    toast(`Checking ${d.queued} session${d.queued !== 1 ? 's' : ''} against the wiki on the worker, oldest first. Findings show on each page and session.`, 'success')
    load()
  }
  const stopAll = async () => {
    const r = await fetch(`/campaigns/${slug}/continuity/queue`, { method: 'DELETE' })
    if (!r.ok) { toast('Could not stop the checks', 'error'); return }
    const d = await r.json()
    toast(`Stopped ${d.stopped} queued check${d.stopped !== 1 ? 's' : ''}. One already running on the worker finishes.`, 'info')
    load()
  }
  const setStatus = async (it: CampaignItem, status: ContinuityItem['status']) => {
    const r = await fetch(statusUrl(slug, it), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    })
    if (!r.ok) { toast('Could not update it', 'error'); return }
    // Handled: it leaves the list (it's still on its session or report, under the handled ones).
    if (status !== 'open') setItems(prev => prev.filter(x => itemKey(x) !== itemKey(it)))
  }
  if (!state) return null

  // Grouped by page, the page with the most findings first; within a page, oldest session first.
  const groups = new Map<string, CampaignItem[]>()
  for (const it of items) groups.set(it.page, [...(groups.get(it.page) ?? []), it])
  const pages = [...groups.entries()]
    .map(([page, list]) => [page, list.sort((a, b) => sessionKey(a.sessionName) - sessionKey(b.sessionName))] as const)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))

  return (
    <div className="continuity-all-wrap">
      <div className="continuity-all">
        <span>
          Suggested fixes: {items.length ? `${items.length} to review` : 'nothing to review'}
          {state.queued ? `, ${state.queued} session${state.queued !== 1 ? 's' : ''} still queued` : ''}
        </span>
        {state.queued > 0 && (
          <button type="button" className="btn-ghost" onClick={stopAll} title="Take the queued sessions off the queue">Stop</button>
        )}
        {items.length > 0 && (
          <button type="button" className="btn-ghost" aria-expanded={reviewing} onClick={() => { setReviewing(v => !v); if (!reviewing) load() }}>
            {reviewing ? 'Hide them' : `Review ${items.length}`}
          </button>
        )}
        {!state.queued && state.unchecked + state.changed > 0 && <button type="button" className="btn-ghost" onClick={runAll}
          title="Check the wiki against each session that hasn't been checked, or whose summary or checked pages changed since its last check, oldest first (one at a time on the worker).">
          Check {checkLabel(state.unchecked, state.changed)}</button>}
      </div>
      {reviewing && (
        <section className="continuity continuity-review" aria-label="Continuity findings">
          <p className="continuity-note">
            From continuity checks of the sessions and from reports people wrote on the wiki, grouped by page. <strong>Apply fix</strong> puts the suggested wording on the page in place of the struck-through
            line; <strong>Edit line</strong> lets you write that replacement yourself. <strong>Dismiss</strong> if it isn't a
            real problem (the page stays as it is); <strong>Skip</strong> to set it aside for now. Each leaves this list and can
            be reopened from its session or report{state.queued ? '; new findings appear as the queued sessions are checked' : ''}.
          </p>
          {pages.map(([page, list]) => {
            const title = page.split('/').pop()?.replace(/\.md$/, '')
            const pageSlug = list[0].page_slug
            return (
              <div key={page} className="continuity-group">
                <h3 className="continuity-group-title">
                  {pageSlug ? <Link to={`/campaigns/${slug}/wiki/${pageSlug}`}>{title}</Link> : title}
                  <span className="continuity-count">{list.length}</span>
                </h3>
                <ul className="continuity-list">
                  {list.map(it => (
                    <ItemRow key={itemKey(it)} it={it} slug={slug} canEdit sessionLink onStatus={st => setStatus(it, st)} />
                  ))}
                </ul>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
