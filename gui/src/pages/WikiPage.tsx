import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useToast } from '../Toast'
import WorkerOffline from '../WorkerOffline'
import WikiGraph from '../WikiGraph'
import { PageReports, ReportsPage } from '../WikiReports'
import { ContinuityCheckAll, PageContinuity } from '../Continuity'

// The campaign wiki: its vault's pages (server: /campaigns/{slug}/wiki, wiki.py),
// read here instead of on the old Netlify site. [[Wikilinks]] resolve to pages
// by title; ones with no page show as missing. DMs edit in place; a save is
// committed to the vault repo, so Obsidian stays in step.

interface PageSummary { title: string; slug: string; section: string; excerpt: string; backlinks: number; broken: number; aliases?: string[] }
interface WikiIndex { name: string; public: boolean; can_edit: boolean; can_manage?: boolean; can_report?: boolean; is_member?: boolean; open_reports?: number; has_wiki: boolean; pages: PageSummary[]; broken?: number }
interface WikiPageData { title: string; slug: string; section: string; path: string; markdown: string; body?: string; facts?: { label: string; value: string }[]; status?: string; hash: string; broken: string[]; backlinks: { title: string; slug: string }[] }

const WIKILINK = /\[\[([^\]\n]+)\]\]/g
const REPORTS_PAGE = '_reports'  // reported mistakes and asked-for changes (not a page slug either)
const GRAPH_PAGE = '_graph'   // the relationship graph's route (not a page slug: those never start with _)
const INDEX_SLUG = 'index'    // the vault's Index.md: the wiki's front page

/** A page's markdown, with [[wikilinks]] as links (or, for a DM, a way to create a missing page). */
function WikiMarkdown({ markdown, bySlug, base, canEdit, onMissing, inline = false, dated = false }: {
  markdown: string; bySlug: Map<string, string>; base: string; canEdit: boolean; onMissing: (title: string) => void; inline?: boolean; dated?: boolean
}) {
  const components = {
    ...(inline ? { p: ({ children }: { children?: ReactNode }) => <>{children}</> } : {}),
    ...(dated ? { li: TimelineItem } : {}),
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      if (href?.startsWith('#missing:')) {
        const name = decodeURIComponent(href.slice(9))
        return canEdit
          ? <button type="button" className="wiki-missing" title={`No page for ${name} yet: create it`} onClick={() => onMissing(name)}>{children}</button>
          : <span className="wiki-missing" title="No page yet">{children}</span>
      }
      if (href?.startsWith('/campaigns/')) return <Link to={href} className="wiki-link">{children}</Link>
      return <a href={href} target="_blank" rel="noreferrer">{children}</a>
    },
  }
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{linkify(markdown, bySlug, base)}</ReactMarkdown>
}

/** "- **Oct 2025** — what happened": the date in its own column (styled only
 * only under a Timeline heading; other lists with a bold lead-in read as written). */
function TimelineItem({ node, children }: { node?: { children?: { type: string; tagName?: string; value?: string }[] }; children?: ReactNode }) {
  const kids = node?.children?.filter(c => !(c.type === 'text' && !c.value?.trim())) ?? []
  const parts = Array.isArray(children) ? children.filter(c => !(typeof c === 'string' && !c.trim())) : null
  if (!parts || parts.length < 2 || kids[0]?.type !== 'element' || kids[0]?.tagName !== 'strong') return <li>{children}</li>
  const [when, ...rest] = parts
  if (typeof rest[0] === 'string') rest[0] = rest[0].replace(/^\s*[—–:-]\s*/, '')
  return <li className="wiki-dated"><span className="wiki-when">{when}</span><span>{rest}</span></li>
}

/** Split the body at its "## " headings, so each standard section can be styled. */
function sections(md: string): { key: string; md: string }[] {
  const out: { key: string; md: string }[] = []
  for (const chunk of md.split(/\n(?=## )/)) {
    const h = chunk.match(/^## +(.+)/)
    out.push({ key: h ? h[1].trim().toLowerCase().replace(/[^a-z]+/g, '-') : 'lead', md: chunk })
  }
  return out
}

/** The italic one-liner under the title ("*Player character, the Scion*"), which the header shows. */
function takeDescriptor(md: string): [string | null, string] {
  const m = md.match(/^\s*\*([^*\n]+)\*\s*(?:\n|$)/)
  return m ? [m[1].trim(), md.slice(m[0].length)] : [null, md]
}

/** How a status reads at a glance: gone, in doubt, or fine. The words carry it too. */
function statusTone(s: string): string {
  if (/\b(dead|deceased|died|killed|destroyed|fallen|slain)\b/i.test(s)) return 'gone'
  if (/\b(missing|captured|captive|imprisoned|unknown|lost|cursed|dormant|sealed)\b/i.test(s)) return 'doubt'
  return 'fine'
}

/** The file usually starts with its own "# Title"; the page shows the title already. */
function withoutTitle(md: string, title: string): string {
  return md.replace(new RegExp(`^\\s*#\\s+[^\\n]*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\n`, 'i'), '')
}

function linkTarget(inner: string): [string, string] {
  const [target, shown] = inner.split('|')
  const clean = target.split('#')[0].trim()
  return [clean.split('/').pop()!.trim(), (shown ?? clean).trim()]
}

/** [[Page|text]] -> markdown links: to the page, or to #missing when there's no such page.
 * Comments, HTML and Obsidian's %% %% (Index.md's page-list markers), are dropped. */
function linkify(md: string, bySlug: Map<string, string>, base: string): string {
  return md.replace(/<!--[\s\S]*?-->\n?/g, '').replace(/%%[\s\S]*?%%\n?/g, '').replace(WIKILINK, (_, inner: string) => {
    const [name, shown] = linkTarget(inner)
    const slug = bySlug.get(name.toLowerCase())
    const text = shown.replace(/[[\]]/g, '')
    return slug ? `[${text}](${base}/${slug})` : `[${text}](#missing:${encodeURIComponent(name)})`
  })
}

/** Lowercased title or alias -> page slug, as Obsidian resolves [[links]]. */
function linkMap(pages: PageSummary[]): Map<string, string> {
  const m = new Map(pages.map(p => [p.title.toLowerCase(), p.slug]))
  for (const p of pages) for (const a of p.aliases ?? []) if (!m.has(a.toLowerCase())) m.set(a.toLowerCase(), p.slug)
  return m
}

function useWikiIndex(slug: string) {
  const [index, setIndex] = useState<WikiIndex | null>(null)
  const [error, setError] = useState<{ status: number; detail: string } | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    fetch(`/campaigns/${slug}/wiki`)
      .then(async r => { if (!r.ok) throw { status: r.status, detail: (await r.json().catch(() => ({})))?.detail ?? '' }; return r.json() })
      .then(d => { setIndex(d); setError(null) })
      .catch(e => setError({ status: e?.status ?? 0, detail: e?.detail ?? 'The wiki could not be loaded.' }))
  }, [slug, version])
  return { index, error, reload: () => setVersion(v => v + 1) }
}

export default function WikiPage() {
  const { slug = '', page } = useParams()
  const [params] = useSearchParams()
  const { index, error, reload } = useWikiIndex(slug)
  const base = `/campaigns/${slug}/wiki`

  if (error) {
    return (
      <div className="page-content wiki">
        <h1 className="wiki-title">Wiki</h1>
        <p className="wiki-note">{error.status === 401
          ? <>This wiki is for campaign members. <a href="/auth/discord">Log in with Discord</a> to read it.</>
          : error.detail}</p>
      </div>
    )
  }
  if (!index) return <div className="page-content wiki"><div className="skeleton" style={{ height: 240, maxWidth: 820 }} /></div>
  if (page === REPORTS_PAGE) return <div className="page-content wiki"><ReportsPage slug={slug} base={base} canReport={!!index.can_report} /></div>
  if (page === GRAPH_PAGE) return <div className="page-content wiki wiki-wide"><WikiGraph slug={slug} base={base} focus={params.get('focus')} /></div>
  return page
    ? <WikiArticle slug={slug} page={page} index={index} base={base} onChanged={reload} />
    : <WikiHome slug={slug} index={index} base={base} onChanged={reload} />
}

// ─── Index: sections, search, settings ───────────────────────────────────────

function WikiHome({ slug, index, base, onChanged }: { slug: string; index: WikiIndex; base: string; onChanged: () => void }) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ title: string; slug: string; section: string; snippet: string }[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [filling, setFilling] = useState(false)
  const hasIndexPage = index.pages.some(p => p.slug === INDEX_SLUG)
  const [showAll, setShowAll] = useState(false)
  const [front, setFront] = useState<string | null>(null)
  // ?section=Mechanics (a page's breadcrumb): the list of all pages, at that section.
  const [params] = useSearchParams()
  const focusSection = params.get('section')
  const [creatingTitle, setCreatingTitle] = useState<string | null>(null)
  const bySlug = useMemo(() => linkMap(index.pages), [index.pages])
  useEffect(() => {
    if (!hasIndexPage) return
    fetch(`/campaigns/${slug}/wiki/pages/${INDEX_SLUG}`).then(r => (r.ok ? r.json() : null)).then(d => d && setFront(d.markdown)).catch(() => {})
  }, [slug, hasIndexPage, index])

  useEffect(() => {
    if (!q.trim()) { setResults(null); return }
    const id = window.setTimeout(() => {
      fetch(`/campaigns/${slug}/wiki/search?q=${encodeURIComponent(q)}`).then(r => r.json()).then(d => setResults(d.results)).catch(() => {})
    }, 200)
    return () => window.clearTimeout(id)
  }, [q, slug])

  const sections = useMemo(() => {
    const groups = new Map<string, PageSummary[]>()
    for (const p of index.pages) {
      if (p.slug === INDEX_SLUG) continue
      const key = p.section || 'Other'
      groups.set(key, [...(groups.get(key) ?? []), p])
    }
    return [...groups.entries()]
  }, [index.pages])

  useEffect(() => {
    if (!focusSection) return
    setShowAll(true)
    const id = window.requestAnimationFrame(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.wiki-section[data-section]')]
        .find(e => e.dataset.section === focusSection || e.dataset.section!.startsWith(focusSection + '/'))
      el?.scrollIntoView({ block: 'start' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [focusSection, sections.length, showAll])

  const togglePublic = async () => {
    const r = await fetch(`/campaigns/${slug}/wiki/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ public: !index.public }),
    })
    if (!r.ok) { toast('Could not change who can read the wiki', 'error'); return }
    onChanged()
  }

  return (
    <div className="page-content wiki">
      <header className="wiki-head">
        <h1 className="wiki-title">{index.name} Wiki</h1>
        <p className="wiki-note">
          {index.pages.length} pages. {index.public ? 'Anyone with the link can read it.' : 'Only campaign members can read it.'}
          {index.can_manage && <> <button type="button" className="index-link" onClick={togglePublic}>
            {index.public ? 'Make it members only' : 'Make it public'}</button></>}
        </p>
        <div className="wiki-tools">
          <input className="written-line wiki-search" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search the wiki" aria-label="Search the wiki" />
          {index.has_wiki && index.pages.length > 0 && <>
            <Link to={`${base}/${GRAPH_PAGE}`} className="btn-ghost">Relationship graph</Link>
            {index.is_member && <Link to={`${base}/${REPORTS_PAGE}`} className="btn-ghost">
              Reports{index.open_reports ? <span className="wr-count">{index.open_reports} waiting</span> : null}</Link>}
            {hasIndexPage && <button type="button" className="btn-ghost" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Hide all pages' : 'All pages'}</button>}
          </>}
          {index.can_edit && <button type="button" className="btn-ghost" onClick={() => setCreating(c => !c)}>New page</button>}
          {index.can_manage && hasIndexPage && <Link to={`${base}/${INDEX_SLUG}`} className="btn-ghost">Edit the front page</Link>}
          {index.can_manage && index.has_wiki && index.pages.length > 0 &&
            <button type="button" className="btn-ghost" aria-expanded={filling} onClick={() => setFilling(v => !v)}>Fill in missing pages</button>}
        </div>
        {creating && <NewPageForm slug={slug} sections={sections.map(([s]) => s)}
          onCreated={s => { onChanged(); navigate(`${base}/${s}`) }} onCancel={() => setCreating(false)} />}
      </header>

      {index.can_manage && <WikiGenerate slug={slug} empty={!index.has_wiki || index.pages.length === 0} onDone={onChanged}
        asked={filling} onClose={() => setFilling(false)} />}
      {index.can_manage && index.has_wiki && index.pages.length > 0 && <ContinuityCheckAll slug={slug} />}

      {!index.has_wiki || index.pages.length === 0 ? (
        !index.can_edit && <p className="wiki-note">This campaign has no wiki yet.</p>
      ) : results ? (
        <ol className="wiki-results">
          {results.length === 0 && <li className="wiki-note">Nothing matches “{q}”.</li>}
          {results.map(r => (
            <li key={r.slug}>
              <Link to={`${base}/${r.slug}`} className="wiki-result-title">{r.title}</Link>
              <span className="wiki-result-section">{r.section}</span>
              {r.snippet && <p className="wiki-result-snippet">{r.snippet.replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')}</p>}
            </li>
          ))}
        </ol>
      ) : hasIndexPage && !showAll ? (
        <>
          {creatingTitle && (
            <NewPageForm slug={slug} sections={sections.map(([s]) => s)} initialTitle={creatingTitle}
              onCreated={s => { onChanged(); navigate(`${base}/${s}`) }} onCancel={() => setCreatingTitle(null)} />
          )}
          {front === null ? <div className="skeleton" style={{ height: 320, maxWidth: 820 }} /> : (
            <article className="wiki-body wiki-front">
              <WikiMarkdown markdown={withoutTitle(front, 'Index')} bySlug={bySlug} base={base} canEdit={index.can_edit} onMissing={setCreatingTitle} />
            </article>
          )}
        </>
      ) : (
        <div className="wiki-sections">
          {sections.map(([section, pages]) => (
            <section key={section} className="wiki-section" aria-label={section} data-section={section}>
              <h2 className="sc">{section.split('/').join(' · ')}</h2>
              <ul>
                {pages.map(p => (
                  <li key={p.slug}><Link to={`${base}/${p.slug}`} title={p.excerpt}>{p.title}</Link></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Generating the wiki from the sessions (worker/wiki_gen.py) ──────────────

interface Proposed { title: string; folder: string; aliases?: string[]; note?: string }
interface GenJob { state: 'none' | 'queued' | 'running' | 'review' | 'done' | 'error'; mode?: string; done?: number; total?: number; message?: string; warning?: string | null; finished?: string; proposed?: Proposed[] }

/** Writing pages from the sessions. The worker first proposes a page list; the
 * DM ticks which to write ("review"), then the worker writes those. `asked` is
 * the toolbar's "Fill in missing pages" button. */
function WikiGenerate({ slug, empty, onDone, asked, onClose }: { slug: string; empty: boolean; onDone: () => void; asked: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const [job, setJob] = useState<GenJob | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // A finished run's "Wrote N pages" shows only if it finished while this page was open.
  const [watched, setWatched] = useState(false)
  const load = () => fetch(`/campaigns/${slug}/wiki/generate`).then(r => (r.ok ? r.json() : null)).then(d => d && setJob(d)).catch(() => {})
  useEffect(() => { load() }, [slug])
  const active = job?.state === 'queued' || job?.state === 'running'
  useEffect(() => {
    if (!active) return
    setWatched(true)
    const id = window.setInterval(() => { load() }, 8000)
    return () => window.clearInterval(id)
  }, [active])
  const prev = useRef(job?.state)
  useEffect(() => {
    if (prev.current && prev.current !== 'done' && job?.state === 'done') onDone()
    if (job?.state === 'review' && prev.current !== 'review') setPicked(new Set(job.proposed?.map(p => p.title)))
    prev.current = job?.state
  }, [job?.state])

  const start = async (mode: 'new' | 'fill') => {
    onClose()
    const r = await fetch(`/campaigns/${slug}/wiki/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { toast(d.detail ?? 'Could not start', 'error'); return }
    setJob(d)
  }
  const approve = async (titles: string[]) => {
    const r = await fetch(`/campaigns/${slug}/wiki/generate/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titles }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { toast(d.detail ?? 'Could not do that', 'error'); return }
    setJob(d)
  }

  if (!job) return null
  if (active) {
    const pct = job.total ? Math.round((job.done ?? 0) / job.total * 100) : 0
    return (
      <div className="wiki-gen" role="status">
        <WorkerOffline waiting what="the wiki" />
        <p className="wiki-gen-title">{job.state === 'queued' ? (job.total ? `Waiting for the worker to write ${job.total} pages…` : 'Waiting for the worker to look through the sessions…') : job.message}</p>
        {job.total ? <div className="upload-progress"><div style={{ width: `${pct}%` }} /><span>{job.done} of {job.total} pages</span></div> : <span className="throbber" aria-hidden="true" />}
        <p className="wiki-note">{job.total ? "Pages appear as they're written; you can leave this page." : "You'll get the list of pages to approve before anything is written; you can leave this page."}</p>
      </div>
    )
  }
  if (job.state === 'review') {
    const list = job.proposed ?? []
    const groups = new Map<string, Proposed[]>()
    for (const p of list) groups.set(p.folder, [...(groups.get(p.folder) ?? []), p])
    const toggle = (t: string) => setPicked(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n })
    return (
      <div className="wiki-gen wiki-gen-review">
        <p className="wiki-gen-title">{list.length ? `Write these ${list.length} pages?` : 'Nothing is missing'}</p>
        {list.length ? <>
          <p className="wiki-note">Untick any you don't want. Nothing is written until you say so.{' '}
            <button type="button" className="index-link" onClick={() => setPicked(new Set(list.map(p => p.title)))}>All</button>{' '}
            <button type="button" className="index-link" onClick={() => setPicked(new Set())}>None</button></p>
          <div className="wiki-gen-pick">
            {[...groups].map(([folder, pages]) => (
              <fieldset key={folder}>
                <legend className="sc">{folder.split('/').join(' · ')}</legend>
                {pages.map(p => (
                  <label key={p.title} title={p.aliases?.length ? `Also: ${p.aliases.join(', ')}` : undefined}>
                    <input type="checkbox" checked={picked.has(p.title)} onChange={() => toggle(p.title)} />
                    <span>{p.title}</span>{p.note && <span className="wiki-gen-note">{p.note}</span>}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="wiki-gen-actions">
            <button type="button" className="btn-primary" disabled={!picked.size} onClick={() => approve([...picked])}>
              Write {picked.size} {picked.size === 1 ? 'page' : 'pages'}</button>
            <button type="button" className="btn-ghost" onClick={() => approve([])}>Cancel</button>
          </div>
        </> : <p className="wiki-note">Every page the sessions call for already exists.{' '}
          <button type="button" className="index-link" onClick={() => approve([])}>OK</button></p>}
      </div>
    )
  }
  const finished = job.state === 'done' && watched
  if (empty) return (
    <div className="wiki-gen">
      {job.state === 'error' && <p className="wiki-note">The last generation stopped: {job.message}</p>}
      <p className="wiki-gen-title">Write this campaign's wiki from its sessions</p>
      <p className="wiki-note">
        Claude reads every session's summary and wiki notes, picks out the characters, places, factions,
        events and items that matter, and writes a short page for each in the standard format: an abstract,
        key facts, a timeline and relationships. You approve the page list first. It runs on the worker and takes a while.
      </p>
      <button type="button" className="btn-primary" onClick={() => start('new')}>Generate the wiki</button>
    </div>
  )
  // A failure shows when it happened in front of you, or when you go to start another.
  const failed = job.state === 'error' && (watched || asked)
  if (!asked && !finished && !failed) return null
  return (
    <div className="wiki-gen quiet">
      {finished && <p className="wiki-note">{job.message}{job.warning ? `. ${job.warning}` : '.'}</p>}
      {failed && <p className="wiki-note">The last generation stopped: {job.message}</p>}
      {asked && (
        <p className="wiki-note">
          Look through the sessions for anything that doesn't have a page yet? You'll see the list before anything is written.{' '}
          <button type="button" className="index-link" onClick={() => start('fill')}>Find missing pages</button>{' '}
          <button type="button" className="index-link" onClick={onClose}>Cancel</button>
        </p>
      )}
    </div>
  )
}

function NewPageForm({ slug, sections, onCreated, onCancel, initialTitle = '' }: {
  slug: string; sections: string[]; onCreated: (slug: string) => void; onCancel: () => void; initialTitle?: string
}) {
  const { toast } = useToast()
  const [title, setTitle] = useState(initialTitle)
  const [section, setSection] = useState(sections.find(s => s.startsWith('Characters')) ?? sections[0] ?? '')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      const r = await fetch(`/campaigns/${slug}/wiki/pages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), section, markdown: `# ${title.trim()}\n\n` }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast(d.detail ?? 'Could not create the page', 'error'); return }
      if (d.warning) toast(d.warning, 'info')
      onCreated(d.slug)
    } finally { setBusy(false) }
  }
  return (
    <form className="wiki-new" onSubmit={e => { e.preventDefault(); create() }}>
      <input className="written-line" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Page title" aria-label="Page title" />
      <select value={section} onChange={e => setSection(e.target.value)} aria-label="Section">
        {sections.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>Create</button>
      <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
    </form>
  )
}

// ─── A page ──────────────────────────────────────────────────────────────────

function WikiArticle({ slug, page, index, base, onChanged }: { slug: string; page: string; index: WikiIndex; base: string; onChanged: () => void }) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [data, setData] = useState<WikiPageData | null>(null)
  const [missing, setMissing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [creatingTitle, setCreatingTitle] = useState<string | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const load = () => fetch(`/campaigns/${slug}/wiki/pages/${page}`)
    .then(r => { if (r.status === 404) { setMissing(true); return null } return r.json() })
    .then(d => { if (d) { setData(d); setMissing(false) } })
  useEffect(() => { setData(null); setEditing(false); setCreatingTitle(null); load(); topRef.current?.scrollIntoView() }, [slug, page])

  const bySlug = useMemo(() => linkMap(index.pages), [index.pages])

  if (missing) return <div className="page-content wiki"><p className="wiki-note">There's no page here. <Link to={base}>Back to the wiki</Link></p></div>
  if (!data) return <div className="page-content wiki"><div className="skeleton" style={{ height: 320, maxWidth: 820 }} /></div>

  const [descriptor, body] = takeDescriptor(withoutTitle(data.body ?? data.markdown, data.title))
  const md = (text: string, inline = false, dated = false) =>
    <WikiMarkdown markdown={text} bySlug={bySlug} base={base} canEdit={index.can_edit} onMissing={setCreatingTitle} inline={inline} dated={dated} />

  const save = async () => {
    setSaving(true)
    try {
      const r = await fetch(`/campaigns/${slug}/wiki/pages/${page}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: draft, base_hash: data.hash }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast(d.detail ?? 'Could not save', 'error'); return }
      toast(d.warning ? `Saved. ${d.warning}` : 'Saved to the wiki', d.warning ? 'info' : 'success')
      setEditing(false)
      await load()
      onChanged()
    } finally { setSaving(false) }
  }

  return (
    <div className="page-content wiki" ref={topRef}>
      <nav className="wiki-crumbs" aria-label="Breadcrumb">
        <Link to={base}>Wiki</Link>
        {/* Each part of the section links to its place in the list of all pages. */}
        {data.section && data.section.split('/').map((part, i, parts) => (
          <span key={i}> / <Link to={`${base}?section=${encodeURIComponent(parts.slice(0, i + 1).join('/'))}`}>{part}</Link></span>
        ))}
      </nav>
      <header className="wiki-article-head">
        <div>
          <h1 className="wiki-title">{data.title}</h1>
          {descriptor && !editing && <p className="wiki-descriptor">{md(descriptor, true)}</p>}
        </div>
        <div className="wiki-head-side">
          {data.status && !editing && (
            <span className={`wiki-status ${statusTone(data.status)}`}><i aria-hidden="true" />{md(data.status, true)}</span>
          )}
          {index.can_edit && (index.can_manage || data.slug !== INDEX_SLUG) && !editing && (
            <button type="button" className="btn-ghost" onClick={() => { setDraft(data.markdown); setEditing(true) }}>Edit</button>
          )}
        </div>
      </header>
      {!editing && !!data.facts?.length && (
        <dl className="wiki-facts" aria-label="Key facts">
          {data.facts.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{md(f.value, true)}</dd></div>)}
        </dl>
      )}
      {index.is_member && !editing && <PageReports slug={slug} base={base} page={data.slug} canReport={!!index.can_report} />}
      {index.can_manage && !editing && <PageContinuity slug={slug} path={data.path} onChanged={() => { load(); onChanged() }} />}
      {creatingTitle && (
        <NewPageForm slug={slug} sections={[...new Set(index.pages.map(p => p.section))]} initialTitle={creatingTitle}
          onCreated={s => { onChanged(); navigate(`${base}/${s}`) }} onCancel={() => setCreatingTitle(null)} />
      )}

      {editing ? (
        <div className="wiki-editor">
          <p className="wiki-note">Markdown, with [[Page name]] or [[Page name|shown text]] for links. Key facts go in the properties between the --- lines at the top (see the wiki format guide). Saving commits it to the vault.</p>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} aria-label={`Edit ${data.title}`} spellCheck />
          <div className="wiki-editor-actions">
            <button type="button" className="btn-primary" onClick={save} disabled={saving || draft === data.markdown}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="wiki-layout">
          <article className="wiki-body">
            {sections(body).map((sec, i) => <section key={i} className={`wiki-sec wiki-sec-${sec.key}`}>{md(sec.md, false, sec.key === 'timeline')}</section>)}
          </article>
          <aside className="wiki-backlinks" aria-label="What links here">
            <Link to={`${base}/${GRAPH_PAGE}?focus=${data.slug}`} className="index-link">See it in the graph</Link>
            {data.backlinks.length > 0 && <>
              <h2 className="sc">What links here</h2>
              <ul>{data.backlinks.map(b => <li key={b.slug}><Link to={`${base}/${b.slug}`}>{b.title}</Link></li>)}</ul>
            </>}
          </aside>
        </div>
      )}
    </div>
  )
}
