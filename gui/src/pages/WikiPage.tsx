import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useToast } from '../Toast'

// The campaign wiki: its vault's pages (server: /campaigns/{slug}/wiki, wiki.py),
// read here instead of on the old Netlify site. [[Wikilinks]] resolve to pages
// by title; ones with no page show as missing. DMs edit in place; a save is
// committed to the vault repo, so Obsidian stays in step.

interface PageSummary { title: string; slug: string; section: string; excerpt: string; backlinks: number; broken: number }
interface WikiIndex { name: string; public: boolean; can_edit: boolean; has_wiki: boolean; pages: PageSummary[]; broken?: number }
interface WikiPageData { title: string; slug: string; section: string; path: string; markdown: string; hash: string; broken: string[]; backlinks: { title: string; slug: string }[] }

const WIKILINK = /\[\[([^\]\n]+)\]\]/g

function linkTarget(inner: string): [string, string] {
  const [target, shown] = inner.split('|')
  const clean = target.split('#')[0].trim()
  return [clean.split('/').pop()!.trim(), (shown ?? clean).trim()]
}

/** [[Page|text]] -> markdown links: to the page, or to #missing when there's no such page. */
function linkify(md: string, bySlug: Map<string, string>, base: string): string {
  return md.replace(WIKILINK, (_, inner: string) => {
    const [name, shown] = linkTarget(inner)
    const slug = bySlug.get(name.toLowerCase())
    const text = shown.replace(/[[\]]/g, '')
    return slug ? `[${text}](${base}/${slug})` : `[${text}](#missing:${encodeURIComponent(name)})`
  })
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
      const key = p.section || 'Other'
      groups.set(key, [...(groups.get(key) ?? []), p])
    }
    return [...groups.entries()]
  }, [index.pages])

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
          {index.can_edit && <> <button type="button" className="index-link" onClick={togglePublic}>
            {index.public ? 'Make it members only' : 'Make it public'}</button></>}
        </p>
        <div className="wiki-tools">
          <input className="written-line wiki-search" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search the wiki" aria-label="Search the wiki" />
          {index.can_edit && <button type="button" className="btn-ghost" onClick={() => setCreating(c => !c)}>New page</button>}
        </div>
        {creating && <NewPageForm slug={slug} sections={sections.map(([s]) => s)}
          onCreated={s => { onChanged(); navigate(`${base}/${s}`) }} onCancel={() => setCreating(false)} />}
      </header>

      {!index.has_wiki ? (
        <p className="wiki-note">This campaign has no wiki yet.</p>
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
      ) : (
        <div className="wiki-sections">
          {sections.map(([section, pages]) => (
            <section key={section} className="wiki-section" aria-label={section}>
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

  const bySlug = useMemo(() => new Map(index.pages.map(p => [p.title.toLowerCase(), p.slug])), [index.pages])

  if (missing) return <div className="page-content wiki"><p className="wiki-note">There's no page here. <Link to={base}>Back to the wiki</Link></p></div>
  if (!data) return <div className="page-content wiki"><div className="skeleton" style={{ height: 320, maxWidth: 820 }} /></div>

  // The file usually starts with its own "# Title"; the page shows the title already.
  const body = data.markdown.replace(new RegExp(`^\\s*#\\s+${data.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n`, 'i'), '')

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

  const components = {
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      if (href?.startsWith('#missing:')) {
        const name = decodeURIComponent(href.slice(9))
        return index.can_edit
          ? <button type="button" className="wiki-missing" title={`No page for ${name} yet: create it`} onClick={() => setCreatingTitle(name)}>{children}</button>
          : <span className="wiki-missing" title="No page yet">{children}</span>
      }
      if (href?.startsWith('/campaigns/')) return <Link to={href} className="wiki-link">{children}</Link>
      return <a href={href} target="_blank" rel="noreferrer">{children}</a>
    },
  }

  return (
    <div className="page-content wiki" ref={topRef}>
      <nav className="wiki-crumbs" aria-label="Breadcrumb">
        <Link to={base}>Wiki</Link>
        {data.section && <span> / {data.section.split('/').join(' / ')}</span>}
      </nav>
      <header className="wiki-article-head">
        <h1 className="wiki-title">{data.title}</h1>
        {index.can_edit && !editing && (
          <button type="button" className="btn-ghost" onClick={() => { setDraft(data.markdown); setEditing(true) }}>Edit</button>
        )}
      </header>
      {creatingTitle && (
        <NewPageForm slug={slug} sections={[...new Set(index.pages.map(p => p.section))]} initialTitle={creatingTitle}
          onCreated={s => { onChanged(); navigate(`${base}/${s}`) }} onCancel={() => setCreatingTitle(null)} />
      )}

      {editing ? (
        <div className="wiki-editor">
          <p className="wiki-note">Markdown, with [[Page name]] or [[Page name|shown text]] for links. Saving commits it to the vault.</p>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} aria-label={`Edit ${data.title}`} spellCheck />
          <div className="wiki-editor-actions">
            <button type="button" className="btn-primary" onClick={save} disabled={saving || draft === data.markdown}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="wiki-layout">
          <article className="wiki-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{linkify(body, bySlug, base)}</ReactMarkdown>
          </article>
          {data.backlinks.length > 0 && (
            <aside className="wiki-backlinks" aria-label="What links here">
              <h2 className="sc">What links here</h2>
              <ul>{data.backlinks.map(b => <li key={b.slug}><Link to={`${base}/${b.slug}`}>{b.title}</Link></li>)}</ul>
            </aside>
          )}
        </div>
      )}
    </div>
  )
}
