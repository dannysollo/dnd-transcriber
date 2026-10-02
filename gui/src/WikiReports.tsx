import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from './Toast'
import { useAuth } from './AuthContext'
import { Chevron } from './Icons'

// Wiki reports: what players and the DM say is wrong on the wiki, or should
// change. The worker takes every open report once a day (or when the DM asks)
// and works out the edits that would fix it. Nothing is changed on the wiki:
// the edits become suggested fixes in the DM's review list (Continuity.tsx,
// with the continuity check's), and each report shows them and how they were
// dealt with. Whoever wrote a report can withdraw it while it's still waiting.

interface Suggestion { id: number; page: string; page_title: string; wiki: string; fix: string; status: 'open' | 'fixed' | 'dismissed' | 'ignored' }
export interface Report {
  id: number; page_slug: string | null; page: string | null; page_title: string | null
  text: string; by: string; by_id: number | null; created: string
  status: 'open' | 'working' | 'suggested' | 'reviewed' | 'no_change' | 'failed' | 'dismissed'
  note?: string; suggestions?: Suggestion[]; done?: string; error?: string
}
interface ReportsState {
  items: Report[]; open: number; due: boolean; requested: boolean; running: boolean
  last_run: string | null; next_run: string | null; can_manage: boolean
}

const STATUS: Record<Report['status'], string> = {
  open: 'Waiting for the next run', working: 'Being worked on now', suggested: 'Fixes suggested, for the DM to review',
  reviewed: 'Reviewed', no_change: 'No change suggested', failed: "Couldn't suggest a fix", dismissed: 'Dismissed',
}

/** Still waiting on someone: the worker, or the DM to review its suggestions. */
const isWaiting = (it: Report) => it.status === 'open' || it.status === 'working' || it.status === 'suggested'

const SUGGESTION: Record<Suggestion['status'], string> = { open: 'to review', fixed: 'applied', dismissed: 'skipped', ignored: 'dismissed' }

const when = (iso: string) => new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
const shortDate = (iso: string) => when(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** "in about 5 hours" / "at the worker's next check". */
function nextRunText(st: ReportsState): string {
  if (st.running) return 'The worker is looking at them now.'
  if (st.requested || st.due) return "The worker looks at them when it next checks in."
  if (!st.next_run) return ''
  const hours = Math.max(1, Math.round((when(st.next_run).getTime() - Date.now()) / 3600000))
  return `The next daily run is in about ${hours} hour${hours !== 1 ? 's' : ''}.`
}

function useReports(slug: string, page?: string) {
  const [state, setState] = useState<ReportsState | null>(null)
  const load = () => fetch(`/campaigns/${slug}/wiki/reports${page ? `?page=${encodeURIComponent(page)}` : ''}`)
    .then(r => (r.ok ? r.json() : null)).then(setState).catch(() => setState(null))
  useEffect(() => { load() }, [slug, page])   // eslint-disable-line react-hooks/exhaustive-deps
  return { state, setState, load }
}

function ReportForm({ slug, page, onSent, autoFocus }: { slug: string; page?: string; onSent: () => void; autoFocus?: boolean }) {
  const { toast } = useToast()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const send = async () => {
    setSending(true)
    try {
      const r = await fetch(`/campaigns/${slug}/wiki/reports`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, page: page ?? null }),
      })
      if (!r.ok) { toast((await r.json().catch(() => ({}))).detail || 'Could not send it', 'error'); return }
      setText('')
      toast('Sent. The worker looks at it with the next daily run.', 'success')
      onSent()
    } finally { setSending(false) }
  }
  return (
    <div className="wr-form">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus={autoFocus} maxLength={4000}
        aria-label="What's wrong, or what should change"
        placeholder={page
          ? 'What’s wrong on this page, or what should change? e.g. “Pact of the Rot is Belle’s ability, not Kali’s.”'
          : 'What’s wrong on the wiki, or what should change? Name the pages it’s about.'} />
      <div className="wr-form-actions">
        <span className="wr-hint">Be specific: say what's wrong and what's right. The worker suggests fixes once a day, for the DM to review.</span>
        <button type="button" className="btn-primary" onClick={send} disabled={sending || !text.trim()}>{sending ? 'Sending…' : 'Send'}</button>
      </div>
    </div>
  )
}

function ReportRow({ it, slug, base, canManage, showPage, onChanged }: {
  it: Report; slug: string; base: string; canManage: boolean; showPage: boolean; onChanged: (s: ReportsState) => void
}) {
  const { toast } = useToast()
  const myId = useAuth().user?.id
  const [showChanges, setShowChanges] = useState(false)
  const setStatus = async (status: 'open' | 'dismissed') => {
    const r = await fetch(`/campaigns/${slug}/wiki/reports/${it.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { toast(d.detail || 'Could not do that', 'error'); return }
    window.dispatchEvent(new Event('codm:reports-changed'))
    onChanged(d)
  }
  const own = myId != null && it.by_id === myId
  const changes = it.suggestions ?? []
  const toReview = changes.filter(c => c.status === 'open').length
  return (
    <li className={`wr-item wr-${it.status}`}>
      <div className="wr-head">
        {showPage && (it.page_slug
          ? <Link to={`${base}/${it.page_slug}`} className="wr-page">{it.page_title}</Link>
          : <span className="wr-page wr-general">The wiki in general</span>)}
        <span className="wr-meta">{it.by} · {shortDate(it.created)}</span>
        <span className={`wr-status wr-status-${it.status}`}>{STATUS[it.status]}</span>
      </div>
      <p className="wr-text">{it.text}</p>
      {it.note && <p className="wr-note">{it.note}</p>}
      {it.error && it.status === 'open' && <p className="wr-note wr-error">Last try failed: {it.error}</p>}
      {changes.length > 0 && (
        <>
          <button type="button" className="continuity-toggle wr-toggle" aria-expanded={showChanges} onClick={() => setShowChanges(v => !v)}>
            <Chevron open={showChanges} /> {changes.length} suggested fix{changes.length !== 1 ? 'es' : ''} on {[...new Set(changes.map(c => c.page_title))].join(', ')}
            {toReview > 0 && <span className="wr-count">{toReview} to review</span>}
          </button>
          {showChanges && (
            <ul className="wr-changes">
              {changes.map(c => (
                <li key={c.id}>
                  <span className="wr-change-page">{c.page_title} · {SUGGESTION[c.status]}</span>
                  <del className="wr-old">{c.wiki}</del>
                  <ins className="wr-new">{c.fix}</ins>
                </li>
              ))}
            </ul>
          )}
          {canManage && toReview > 0 && (
            <p className="wr-hint">Apply, edit, skip or dismiss them under Suggested fixes on the <Link to={base}>wiki's front page</Link>,
              or on each page concerned.</p>
          )}
        </>
      )}
      <div className="continuity-actions">
        {(canManage || own) && it.status === 'open' && (
          <button type="button" className="btn-ghost" onClick={() => setStatus('dismissed')}>{own && !canManage ? 'Withdraw' : 'Dismiss'}</button>
        )}
        {(canManage || own) && ['dismissed', 'failed', 'no_change'].includes(it.status) && (
          <button type="button" className="btn-ghost" onClick={() => setStatus('open')}>Try again</button>
        )}
      </div>
    </li>
  )
}

/** On a wiki page: report something about it, and see what's been reported. */
export function PageReports({ slug, base, page, canReport }: { slug: string; base: string; page: string; canReport: boolean }) {
  const { state, load } = useReports(slug, page)
  const [open, setOpen] = useState(false)
  const items = state?.items ?? []
  const waiting = items.filter(isWaiting).length
  if (!canReport && items.length === 0) return null
  return (
    <section className="wr wr-on-page" aria-label="Reports about this page">
      <button type="button" className="continuity-toggle wr-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <Chevron open={open} /> {canReport ? 'Report a mistake or suggest a change' : 'Reports about this page'}
        {items.length > 0 && <span className="wr-count">{waiting ? `${waiting} waiting` : `${items.length} earlier`}</span>}
      </button>
      {open && (
        <>
          {canReport && <ReportForm slug={slug} page={page} onSent={load} autoFocus />}
          {items.length > 0 && (
            <ul className="wr-list">
              {items.map(it => <ReportRow key={it.id} it={it} slug={slug} base={base} canManage={!!state?.can_manage}
                showPage={false} onChanged={() => load()} />)}
            </ul>
          )}
          {state && state.open > 0 && <p className="wr-hint">{nextRunText(state)}</p>}
        </>
      )}
    </section>
  )
}

/** The wiki's Reports page: everything reported, a form for the wiki in general, and the DM's run-now. */
export function ReportsPage({ slug, base, canReport }: { slug: string; base: string; canReport: boolean }) {
  const { toast } = useToast()
  const { state, setState, load } = useReports(slug)
  const [filter, setFilter] = useState<'waiting' | 'all'>('waiting')
  if (!state) return <div className="skeleton" style={{ height: 200, maxWidth: 820 }} />
  const shown = state.items.filter(it => filter === 'all' || isWaiting(it))
  const runNow = async () => {
    const r = await fetch(`/campaigns/${slug}/wiki/reports/run`, { method: 'POST' })
    if (!r.ok) { toast('Could not ask for a run', 'error'); return }
    setState(await r.json())
    toast("Queued: the worker looks at them at its next check-in.", 'success')
  }
  return (
    <div className="wr wr-page-view">
      <nav className="wiki-crumbs" aria-label="Breadcrumb"><Link to={base}>Wiki</Link> / Reports</nav>
      <h1 className="wiki-title">Reports</h1>
      <p className="wiki-note">Mistakes and changes people have asked for. Once a day the worker reads every waiting report,
        has Claude work out the edits that would fix it. They don't change the wiki by themselves: they go to the DM as suggested
        fixes, alongside the continuity check's, to apply, edit or turn down. {state.open > 0 && nextRunText(state)}</p>
      {state.can_manage && state.open > 0 && !state.running && !state.requested && (
        <div className="continuity-all"><button type="button" className="btn-ghost" onClick={runNow}>Look at them now</button>
          <span>(suggest fixes now instead of waiting for the daily run)</span></div>
      )}
      {canReport && <ReportForm slug={slug} onSent={load} />}
      <div className="wr-filter" role="group" aria-label="Show">
        <button type="button" className="index-link" aria-pressed={filter === 'waiting'} onClick={() => setFilter('waiting')}>Waiting ({state.items.filter(isWaiting).length})</button>
        <button type="button" className="index-link" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All ({state.items.length})</button>
      </div>
      {shown.length === 0
        ? <p className="wiki-note">{filter === 'waiting' ? 'Nothing waiting.' : 'Nothing reported yet.'}</p>
        : <ul className="wr-list">{shown.map(it => <ReportRow key={it.id} it={it} slug={slug} base={base}
            canManage={state.can_manage} showPage onChanged={() => load()} />)}</ul>}
    </div>
  )
}
