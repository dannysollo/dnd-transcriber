import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from './Toast'

// Campaign Settings > Worker: everything waiting for the worker, of every kind
// (transcriptions, summaries, continuity checks, a wiki generation), with a
// way to take any one of them, a whole kind, or everything off the queue.

interface QueueItem { kind: 'transcription' | 'analysis' | 'continuity' | 'wiki'; label: string; session: string | null; state: 'queued' | 'running'; since: string | null; detail?: string }

const PLURAL: Record<QueueItem['kind'], string> = {
  transcription: 'transcriptions', analysis: 'summaries', continuity: 'continuity checks', wiki: 'wiki generation',
}

export default function WorkerQueue({ slug }: { slug: string }) {
  const { toast } = useToast()
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const load = () => fetch(`/campaigns/${slug}/queue`).then(r => (r.ok ? r.json() : null)).then(d => d && setItems(d.items)).catch(() => {})
  useEffect(() => {
    load()
    const t = window.setInterval(load, 15000)
    return () => window.clearInterval(t)
  }, [slug])

  const remove = async (url: string, what: string) => {
    const r = await fetch(url, { method: 'DELETE' })
    if (!r.ok) { toast(`Could not remove ${what}`, 'error'); return }
    const d = await r.json()
    setItems(d.items)
    if (!d.removed) toast('Nothing to remove (it may just have finished)', 'info')
  }
  const removeOne = (it: QueueItem) => remove(
    `/campaigns/${slug}/queue/${it.kind}${it.session ? `?session=${encodeURIComponent(it.session)}` : ''}`,
    `the ${it.label.toLowerCase()}`)
  const removeKind = (kind: QueueItem['kind']) => remove(`/campaigns/${slug}/queue/${kind}`, `the ${PLURAL[kind]}`)
  const clearAll = async () => {
    if (!confirmClear) { setConfirmClear(true); return }
    setConfirmClear(false)
    await remove(`/campaigns/${slug}/queue`, 'the queue')
  }

  if (!items) return <div className="skeleton" style={{ height: 80, maxWidth: 640 }} />
  const kinds = [...new Set(items.map(i => i.kind))]
  const running = items.some(i => i.state === 'running')
  return (
    <section className="worker-queue" aria-label="Queue">
      <div className="worker-queue-head">
        <h3 className="sc">Queue</h3>
        <span className="voice-detail">
          {items.length ? `${items.length} job${items.length !== 1 ? 's' : ''}` : 'Nothing waiting for the worker.'}
        </span>
        <span style={{ flex: 1 }} />
        {items.length > 0 && (
          <button type="button" className={confirmClear ? 'btn-danger' : 'btn-ghost'} onClick={clearAll}
            onBlur={() => setConfirmClear(false)} title="Remove every job. Ones already running on the worker finish.">
            {confirmClear ? 'Confirm: clear all' : 'Clear all'}
          </button>
        )}
      </div>
      {kinds.length > 1 && (
        <div className="worker-queue-kinds">
          {kinds.map(kind => (
            <button key={kind} type="button" className="btn-ghost" onClick={() => removeKind(kind)}>
              Clear {PLURAL[kind]} ({items.filter(i => i.kind === kind).length})
            </button>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <ul className="voice-list">
          {items.map(it => (
            <li key={`${it.kind}|${it.session ?? ''}`} className="voice-row">
              <div className="voice-main">
                <span className="voice-name">
                  {it.session ? <Link to={`/sessions/${encodeURIComponent(it.session)}`}>{it.session}</Link> : it.label}
                </span>
                <span className="voice-detail">
                  {it.session ? it.label : it.detail ?? ''}
                  {' · '}
                  <span className={it.state === 'running' ? 'worker-queue-running' : undefined}>{it.state === 'running' ? 'running now' : 'waiting'}</span>
                </span>
              </div>
              <div className="voice-actions">
                <button type="button" className="btn-ghost" onClick={() => removeOne(it)}
                  title={it.state === 'running' ? 'Take it off the queue. The worker finishes what it already started.' : 'Take it off the queue'}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {running && <p className="voice-detail" style={{ marginTop: 8 }}>A job already running on the worker finishes even if you remove it; it just won't be tried again.</p>}
    </section>
  )
}
