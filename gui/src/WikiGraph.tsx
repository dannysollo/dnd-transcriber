import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from 'd3-force'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { drag } from 'd3-drag'
import 'd3-transition'   // adds .transition() to selections, for eased zooms
import { CloseIcon, FitIcon, MinusIcon, PlusIcon, SlidersIcon } from './Icons'

// The wiki's relationship graph: every page, a line wherever one links to
// another. Colour is the page's kind (a fixed slot per kind, validated for
// colour-blind separation on both page colours; the legend and labels carry
// it too). Bigger dots have more links. Laid out up front, then still: drag
// a dot to move it, scroll or pinch to zoom, click a dot to see its links,
// click again (or "Open page") to open it. The Adjust panel re-lays it out
// live, like the old campaign site's sliders; settings stay in this browser.

interface Node extends SimulationNodeDatum { id: string; title: string; section: string; degree: number; excerpt?: string; faction?: string | null }
interface Edge { source: string | Node; target: string | Node }

// Kinds in legend order, each with its fixed colour slot (index.css --wg-*).
const KINDS: { key: string; label: string; slot: number }[] = [
  { key: 'Characters/PCs', label: 'Player characters', slot: 8 },
  { key: 'Characters/NPCs', label: 'NPCs', slot: 1 },
  { key: 'Characters/Sephirot', label: 'Sephirot', slot: 4 },
  { key: 'Locations', label: 'Locations', slot: 6 },
  { key: 'Factions', label: 'Factions', slot: 7 },
  { key: 'Events', label: 'Events', slot: 2 },
  { key: 'Items', label: 'Items', slot: 3 },
  { key: 'Mechanics', label: 'Mechanics', slot: 5 },
]
function kindOf(section: string): string {
  if (KINDS.some(k => k.key === section)) return section
  const top = section.split('/')[0]
  return KINDS.find(k => k.key === top || k.key.startsWith(top + '/'))?.key ?? 'Other'
}
const kindLabelOf = (kind: string) => KINDS.find(k => k.key === kind)?.label ?? 'Other'
const colorOf = (kind: string) => {
  const k = KINDS.find(x => x.key === kind)
  return k ? `var(--wg-${k.slot})` : 'var(--wg-other)'
}
// Names fill in as you zoom in from the whole-graph view, best-connected first:
// all of them by NAMES_ALL times that view's zoom.
const NAMES_ALL = 2.5

interface Settings {
  spacing: number      // how hard pages push apart (many-body charge, negated)
  linkLength: number   // resting length of a link
  linkPull: number     // how strongly a link holds that length
  dotSize: number      // multiplier on the dot radius
  textSize: number     // label size on screen, px
  names: number        // best-connected pages always named
  hideLonely: boolean  // leave out pages with no links
  softenHubs: boolean  // links to much-linked pages pull less (d3's own default), so the rest branch out
  groupByFaction: boolean // each faction's pages gather in their own place around a circle
  groupPull: number    // grouped, how strongly pages hold to their faction's place
}
const DEFAULTS: Settings = { spacing: 700, linkLength: 120, linkPull: 0.12, dotSize: 1, textSize: 13, names: 14, hideLonely: false, softenHubs: true, groupByFaction: false, groupPull: 0.5 }
const STORAGE_KEY = 'wikiGraph.settings'
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* storage blocked: defaults */ }
  return DEFAULTS
}

const SLIDERS: { key: keyof Settings; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
  { key: 'spacing', label: 'Spacing', min: 50, max: 2000, step: 10, fmt: v => String(v) },
  { key: 'linkLength', label: 'Link length', min: 20, max: 300, step: 5, fmt: v => String(v) },
  { key: 'linkPull', label: 'Link pull', min: 0.01, max: 1, step: 0.01, fmt: v => v.toFixed(2) },
  { key: 'groupPull', label: 'Group pull', min: 0.02, max: 1, step: 0.01, fmt: v => v.toFixed(2) },
  { key: 'dotSize', label: 'Dot size', min: 0.4, max: 3, step: 0.1, fmt: v => v.toFixed(1) + '×' },
  { key: 'textSize', label: 'Name size', min: 9, max: 22, step: 1, fmt: v => v + 'px' },
  { key: 'names', label: 'Names shown', min: 0, max: 60, step: 1, fmt: v => (v ? String(v) : 'on hover') },
]

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

interface GraphApi {
  relayout: (refit?: boolean) => void
  restyle: () => void
  zoomBy: (k: number) => void
  fitAll: () => void
  select: (id: string | null, pan?: boolean) => void
}

export default function WikiGraph({ slug, base, focus }: { slug: string; base: string; focus?: string | null }) {
  const navigate = useNavigate()
  const svgRef = useRef<SVGSVGElement>(null)
  const apiRef = useRef<GraphApi | null>(null)
  const [data, setData] = useState<{ nodes: Node[]; links: Edge[]; groups?: { id: string; title: string }[] } | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [tip, setTip] = useState<{ x: number; y: number; node: Node } | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [panelOpen, setPanelOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(focus ?? null)
  const [query, setQuery] = useState('')
  const narrow = typeof window !== 'undefined' && window.innerWidth < 600

  useEffect(() => {
    fetch(`/campaigns/${slug}/wiki/graph`).then(r => r.json()).then(setData).catch(() => setData({ nodes: [], links: [] }))
  }, [slug])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch { /* private mode */ }
  }, [settings])

  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const n of data?.nodes ?? []) c.set(kindOf(n.section), (c.get(kindOf(n.section)) ?? 0) + 1)
    return c
  }, [data])

  const byId = useMemo(() => new Map((data?.nodes ?? []).map(n => [n.id, n])), [data])
  const neighbourIds = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of data?.links ?? []) {
      const a = l.source as string, b = l.target as string
      m.set(a, (m.get(a) ?? new Set()).add(b))
      m.set(b, (m.get(b) ?? new Set()).add(a))
    }
    return m
  }, [data])

  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl || !data || !data.nodes.length) return
    const width = svgEl.clientWidth, height = svgEl.clientHeight
    const s0 = settingsRef.current
    const nodes: Node[] = data.nodes
      .filter(n => !hidden.has(kindOf(n.section)) && !(s0.hideLonely && !n.degree))
      .map(n => ({ ...n }))
    const ids = new Set(nodes.map(n => n.id))
    const links: Edge[] = data.links.filter(l => ids.has(l.source as string) && ids.has(l.target as string)).map(l => ({ ...l }))
    const neighbours = new Map<string, Set<string>>()
    for (const l of links) {
      const a = l.source as string, b = l.target as string
      neighbours.set(a, (neighbours.get(a) ?? new Set()).add(b))
      neighbours.set(b, (neighbours.get(b) ?? new Set()).add(a))
    }
    const radius = (d: Node) => (4 + Math.sqrt(d.degree) * 1.7) * settingsRef.current.dotSize
    // links per page among what's shown (hiding a kind removes its links)
    const shownDegree = new Map<string, number>()
    for (const [id, near] of neighbours) shownDegree.set(id, near.size)
    const idOf = (e: string | Node) => (typeof e === 'string' ? e : e.id)
    const groupOf = (n: Node) => n.faction ?? ''   // '' = no faction
    const groupOfId = new Map(nodes.map(n => [n.id, groupOf(n)]))

    // Group by faction: each faction shown gets a point on a circle (the party
    // first, then the biggest); pages with no faction stay in the middle.
    const groupsShown = (data.groups ?? []).filter(gr => nodes.some(n => n.faction === gr.id))
    const groupIds = groupsShown.map(gr => gr.id)
    const unaffiliated = nodes.filter(n => !n.faction).length
    const anchor = (group: string) => {
      const i = groupIds.indexOf(group)
      if (i < 0) return { x: width / 2, y: height / 2, dx: 0, dy: 0 }
      const a = (i / groupIds.length) * 2 * Math.PI - Math.PI / 2
      // the circle clears the pages with no faction in the middle, and gives each group room around it
      const sp = Math.sqrt(settingsRef.current.spacing / 100)
      const r = sp * (22 * Math.sqrt(unaffiliated) + 60 * groupIds.length / Math.PI)
      return { x: width / 2 + r * Math.cos(a), y: height / 2 + r * Math.sin(a), dx: Math.cos(a), dy: Math.sin(a) }
    }

    const linkForce = forceLink<Node, Edge>(links).id(d => d.id)
    const chargeForce = forceManyBody<Node>().distanceMax(900)
    const collide = forceCollide<Node>()
    const xForce = forceX<Node>(), yForce = forceY<Node>()
    const setForces = () => {
      const s = settingsRef.current
      linkForce.distance(s.linkLength).strength(l => {
        let pull = s.linkPull
        if (s.softenHubs) {
          // a link pulls less the busier its quieter end is; a page with one link still holds on
          const least = Math.min(shownDegree.get(idOf(l.source)) ?? 1, shownDegree.get(idOf(l.target)) ?? 1)
          pull = Math.min(1, (s.linkPull * 8) / Math.max(1, least))
        }
        // grouped, links between groups only lean on each other, or they'd drag the groups back into one ball
        if (s.groupByFaction && groupOfId.get(idOf(l.source)) !== groupOfId.get(idOf(l.target))) pull *= 0.12
        return pull
      })
      chargeForce.strength(-s.spacing)
      collide.radius(d => radius(d) + 6)
      if (s.groupByFaction) {
        // factions hold to their places; the unaffiliated only loosely to the middle
        xForce.x(d => anchor(groupOf(d)).x).strength(d => (groupOf(d) ? s.groupPull : s.groupPull * 0.24))
        yForce.y(d => anchor(groupOf(d)).y).strength(d => (groupOf(d) ? s.groupPull : s.groupPull * 0.24))
      } else {
        // pages with no links would drift to the edges and shrink the fitted view
        xForce.x(width / 2).strength(d => (d.degree ? 0.035 : 0.3))
        yForce.y(height / 2).strength(d => (d.degree ? 0.035 : 0.3))
      }
    }
    const sim: Simulation<Node, Edge> = forceSimulation(nodes)
      .force('link', linkForce)
      .force('charge', chargeForce)
      .force('x', xForce)
      .force('y', yForce)
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', collide)
      .stop()
    setForces()   // after the simulation has the nodes, so per-link strengths see them
    for (let i = 0; i < 450; i++) sim.tick()   // lay out up front: no drifting animation on arrival

    const svg = select(svgEl)
    svg.selectAll('*').remove()
    const g = svg.append('g')
    const line = g.append('g').attr('class', 'wg-links').selectAll('line').data(links).join('line')
    const dot = g.append('g').attr('class', 'wg-nodes').selectAll<SVGCircleElement, Node>('circle').data(nodes).join('circle')
      .attr('fill', d => colorOf(kindOf(d.section))).attr('class', 'wg-node')
      .attr('tabindex', 0).attr('role', 'link').attr('aria-label', d => `${d.title}, ${d.degree} links`)
    const groupLabel = g.append('g').attr('class', 'wg-groups').selectAll<SVGTextElement, { id: string; title: string }>('text')
      .data(groupsShown).join('text').text(gr => gr.title)
    const label = g.append('g').attr('class', 'wg-labels').selectAll<SVGTextElement, Node>('text').data(nodes).join('text')
      .text(d => d.title)

    let k = 1
    let named = new Set<string>()
    const byDegree = [...nodes].sort((a, b) => b.degree - a.degree)
    let kAll = 1   // the zoom that fits the whole graph; names fill in relative to it
    const place = () => {
      line.attr('x1', d => (d.source as Node).x!).attr('y1', d => (d.source as Node).y!)
        .attr('x2', d => (d.target as Node).x!).attr('y2', d => (d.target as Node).y!)
      dot.attr('cx', d => d.x!).attr('cy', d => d.y!)
      label.attr('x', d => d.x!).attr('y', d => d.y!)
      placeGroups()
    }
    // group names sit just outside their group, on the side facing away from the middle;
    // their size is fixed on screen, so this runs on zoom too
    // where each group's name goes at zoom kk (in graph units; the names' size is fixed on screen)
    const spotsAt = (kk: number) => {
      const size = (width < 600 ? 12 : 17) / kk
      const spots = groupsShown.map(gr => {
        const members = nodes.filter(n => n.faction === gr.id)
        const cx = members.reduce((t, n) => t + n.x!, 0) / members.length
        const cy = members.reduce((t, n) => t + n.y!, 0) / members.length
        const { dx, dy } = anchor(gr.id)
        const reach = Math.max(...members.map(n => (n.x! - cx) * dx + (n.y! - cy) * dy))
        // small caps run about 0.62 of the font size per letter
        return { id: gr.id, x: cx + dx * (reach + 34 / kk), y: cy + dy * (reach + 34 / kk), dy, half: gr.title.length * size * 0.31, size }
      })
      // names that would overlap step apart, away from the middle
      for (let pass = 0; pass < 4; pass++) {
        for (const a of spots) for (const b of spots) {
          if (a === b || Math.abs(a.x - b.x) > a.half + b.half || Math.abs(a.y - b.y) > size * 1.2) continue
          const outer = Math.abs(a.dy) >= Math.abs(b.dy) ? a : b
          outer.y += (outer.dy >= 0 ? 1 : -1) * (size * 1.25 - Math.abs(a.y - b.y))
        }
      }
      return spots
    }
    // group names sit just outside their group, on the side facing away from the middle;
    // their size is fixed on screen, so this runs on zoom too
    const placeGroups = () => {
      const grouped = settingsRef.current.groupByFaction
      groupLabel.classed('on', grouped)
      if (!grouped) return
      const at = new Map(spotsAt(k).map(sp => [sp.id, sp]))
      groupLabel.attr('x', gr => at.get(gr.id)!.x).attr('y', gr => at.get(gr.id)!.y)
    }
    // sizes and which names stand: dots scale with the setting, names stay a
    // readable size on screen at any zoom
    const restyle = () => {
      const s = settingsRef.current
      // fewer standing names on a narrow screen, where they'd pile up in the middle
      const standing = width < 600 ? Math.min(s.names, 5) : s.names
      kAll = fitTransform(nodes, WHOLE).k   // the layout may have spread or shrunk since the last fit
      const t = Math.min(1, Math.max(0, (k / kAll - 1) / (NAMES_ALL - 1)))
      const count = Math.round(standing + (nodes.length - standing) * t ** 1.5)
      named = new Set(byDegree.slice(0, count).map(n => n.id))
      dot.attr('r', radius)
      groupLabel.attr('font-size', (width < 600 ? 12 : 17) / k).attr('stroke-width', 4 / k)
      label.attr('font-size', s.textSize / k).attr('stroke-width', 3 / k).attr('dy', d => -radius(d) - 4 / k)
        .classed('on', d => named.has(d.id))
    }
    place()

    let pinned: string | null = selected && ids.has(selected) ? selected : null
    const highlight = (id: string | null) => {
      const near = id ? new Set([id, ...(neighbours.get(id) ?? [])]) : null
      dot.classed('dim', d => !!near && !near.has(d.id)).classed('sel', d => d.id === pinned)
      label.classed('hot', d => !!near && near.has(d.id)).classed('dim', d => !!near && !near.has(d.id))
      line.classed('hot', d => !!id && ((d.source as Node).id === id || (d.target as Node).id === id))
        .classed('dim', d => !!id && (d.source as Node).id !== id && (d.target as Node).id !== id)
    }

    const zoomer: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 6]).on('zoom', e => {
      const t: ZoomTransform = e.transform
      g.attr('transform', t.toString())
      k = t.k
      restyle()
      placeGroups()
    })
    svg.call(zoomer).on('dblclick.zoom', null)

    const duration = reducedMotion() ? 0 : 450
    const fitTransform = (subset: Node[], maxScale: number) => {
      const xs = subset.map(n => n.x!), ys = subset.map(n => n.y!)
      let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
      const pad = 40   // on screen
      const scaleFor = () => Math.max(0.05, Math.min(maxScale, (width - 2 * pad) / Math.max(1, x1 - x0), (height - 2 * pad) / Math.max(1, y1 - y0)))
      let s = scaleFor()
      // grouped, frame the group names too; where they fall depends on the zoom, so settle it in a few rounds
      if (settingsRef.current.groupByFaction && subset.length === nodes.length) {
        const nx0 = x0, nx1 = x1, ny0 = y0, ny1 = y1
        for (let round = 0; round < 3; round++) {
          x0 = nx0; x1 = nx1; y0 = ny0; y1 = ny1
          for (const sp of spotsAt(s)) {
            x0 = Math.min(x0, sp.x - sp.half); x1 = Math.max(x1, sp.x + sp.half)
            y0 = Math.min(y0, sp.y - sp.size); y1 = Math.max(y1, sp.y + sp.size)
          }
          s = scaleFor()
        }
      }
      return zoomIdentity.translate(width / 2 - s * (x0 + x1) / 2, height / 2 - s * (y0 + y1) / 2).scale(s)
    }
    const WHOLE = 1.4   // the most a whole-graph fit zooms in
    const fit = (subset: Node[], maxScale: number, animate = true) => {
      if (!subset.length) return
      const t = fitTransform(subset, maxScale)
      if (animate && duration) svg.transition().duration(duration).call(zoomer.transform, t)
      else svg.call(zoomer.transform, t)
    }
    const around = (id: string) => nodes.filter(n => n.id === id || neighbours.get(id)?.has(n.id))

    const choose = (id: string | null, pan = false) => {
      pinned = id
      highlight(id)
      setSelected(id)
      if (id && pan) fit(around(id), 2.2)
    }

    dot.on('mouseenter', (e: MouseEvent, d) => { highlight(d.id); setTip({ x: e.clientX, y: e.clientY, node: d }) })
      .on('mousemove', (e: MouseEvent, d) => setTip({ x: e.clientX, y: e.clientY, node: d }))
      .on('mouseleave', () => { highlight(pinned); setTip(null) })
      .on('focus', (_e, d) => highlight(d.id)).on('blur', () => highlight(pinned))
      // first click picks a page and shows its links; a second opens it
      .on('click', (e: MouseEvent, d) => { e.stopPropagation(); if (pinned === d.id) navigate(`${base}/${d.id}`); else choose(d.id) })
      .on('keydown', (e: KeyboardEvent, d) => { if (e.key === 'Enter') navigate(`${base}/${d.id}`) })
      .call(drag<SVGCircleElement, Node>()
        .on('start', (_e, d) => { d.fx = d.x; d.fy = d.y })
        .on('drag', (e, d) => {
          d.fx = d.x = e.x; d.fy = d.y = e.y
          // a light local settle so neighbours follow a little
          sim.alpha(0.05); for (let i = 0; i < 2; i++) sim.tick()
          place()
        })
        .on('end', (_e, d) => { d.fx = null; d.fy = null }))
    svg.on('click', () => { if (pinned) choose(null) })

    // Slider changes re-settle the layout from where it is, animated unless
    // the reader asked for less motion.
    sim.on('tick', place)
    const relayout = (refit = false) => {
      setForces()
      if (reducedMotion()) {
        sim.stop().alpha(0.6)
        for (let i = 0; i < 300; i++) sim.tick()
        place()
        if (refit) fit(nodes, WHOLE, false)
      } else {
        // a change of shape (grouping on or off) re-frames the view once it settles
        sim.on('end.fit', refit ? () => { sim.on('end.fit', null); fit(nodes, WHOLE) } : null)
        sim.alpha(refit ? 0.9 : 0.6).alphaDecay(0.03).restart()
      }
      restyle()
    }

    apiRef.current = {
      relayout, restyle,
      zoomBy: m => duration ? svg.transition().duration(200).call(zoomer.scaleBy, m) : svg.call(zoomer.scaleBy, m),
      fitAll: () => fit(nodes, WHOLE),
      select: choose,
    }

    // Fit what matters in the window: the whole graph, or a page and its
    // neighbours (from a page's "See it in the graph").
    highlight(pinned)
    if (pinned) fit(around(pinned), 2.2, false)
    else fit(nodes, WHOLE, false)
    return () => { sim.stop(); svg.on('.zoom', null); svg.interrupt(); apiRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hidden, settings.hideLonely])

  // arriving from another page's "See it in the graph" while already here
  const firstFocus = useRef(true)
  useEffect(() => {
    if (firstFocus.current) { firstFocus.current = false; return }
    apiRef.current?.select(focus ?? null, true)
  }, [focus])

  useEffect(() => { apiRef.current?.relayout() }, [settings.spacing, settings.linkLength, settings.linkPull, settings.dotSize, settings.softenHubs, settings.groupPull])
  const firstGroup = useRef(true)
  useEffect(() => {
    if (firstGroup.current) { firstGroup.current = false; return }
    apiRef.current?.relayout(true)
  }, [settings.groupByFaction])
  useEffect(() => { apiRef.current?.restyle() }, [settings.textSize, settings.names])

  const toggle = (k: string) => setHidden(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const set = <K extends keyof Settings>(key: K, v: Settings[K]) => setSettings(s => ({ ...s, [key]: v }))

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !data) return []
    return data.nodes.filter(n => n.title.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.title.toLowerCase().startsWith(q)) - Number(!b.title.toLowerCase().startsWith(q)) || b.degree - a.degree)
      .slice(0, 7)
  }, [query, data])
  const pick = (n: Node) => {
    const kind = kindOf(n.section)
    if (hidden.has(kind)) toggle(kind)
    if (settings.hideLonely && !n.degree) set('hideLonely', false)
    setQuery('')
    // after any re-render the toggles above cause
    requestAnimationFrame(() => apiRef.current?.select(n.id, true))
  }

  const sel = selected ? byId.get(selected) : null
  const selLinks = sel ? [...(neighbourIds.get(sel.id) ?? [])].map(id => byId.get(id)!).filter(Boolean)
    .sort((a, b) => b.degree - a.degree) : []

  return (
    <div className="wiki-graph">
      <div className="wiki-graph-head">
        <nav className="wiki-crumbs" aria-label="Breadcrumb"><Link to={base}>Wiki</Link> / Relationship graph</nav>
        <p className="wiki-note">Every page, joined wherever one links to another; bigger dots have more links.
          Click a dot to see what it touches, click again to open it. Drag to move, scroll or pinch to zoom.</p>
        <ul className="wg-legend" aria-label="Kinds of page (click to hide or show)">
          {[...KINDS, { key: 'Other', label: 'Other', slot: 0 }].filter(k => counts.get(k.key)).map(k => (
            <li key={k.key}>
              <button type="button" onClick={() => toggle(k.key)} aria-pressed={!hidden.has(k.key)} className={hidden.has(k.key) ? 'off' : ''}>
                <span className="wg-swatch" style={{ background: colorOf(k.key) }} />{k.label} <span className="wg-count">{counts.get(k.key)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {!data ? <div className="skeleton" style={{ height: 480 }} />
        : data.nodes.length === 0 ? <p className="wiki-note">No pages to show yet.</p>
        : (
          <div className="wg-stage">
            <svg ref={svgRef} className="wg-svg" role="img" aria-label="Relationship graph of the wiki's pages" />

            <div className="wg-find">
              <input type="search" className="written-line wg-find-input" placeholder="Find a page" value={query}
                onChange={e => setQuery(e.target.value)} aria-label="Find a page in the graph"
                onKeyDown={e => { if (e.key === 'Enter' && matches[0]) pick(matches[0]); if (e.key === 'Escape') setQuery('') }} />
              {matches.length > 0 && (
                <ul className="wg-find-list" role="listbox">
                  {matches.map(n => (
                    <li key={n.id}>
                      <button type="button" onClick={() => pick(n)}>
                        <span className="wg-swatch" style={{ background: colorOf(kindOf(n.section)) }} />{n.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="wg-tools">
              <div className="wg-toolbar" role="group" aria-label="View">
                <button type="button" onClick={() => apiRef.current?.zoomBy(1.4)} title="Zoom in" aria-label="Zoom in"><PlusIcon size={16} /></button>
                <button type="button" onClick={() => apiRef.current?.zoomBy(1 / 1.4)} title="Zoom out" aria-label="Zoom out"><MinusIcon size={16} /></button>
                <button type="button" onClick={() => apiRef.current?.fitAll()} title="Fit everything" aria-label="Fit everything"><FitIcon size={16} /></button>
                <button type="button" onClick={() => setPanelOpen(o => !o)} aria-expanded={panelOpen} className={panelOpen ? 'on' : ''}
                  title="Adjust the layout" aria-label="Adjust the layout"><SlidersIcon size={16} /></button>
              </div>
              {panelOpen && (
                <div className="wg-panel">
                  <div className="wg-panel-head">
                    <span>Adjust</span>
                    <button type="button" className="wg-panel-close" onClick={() => setPanelOpen(false)} aria-label="Close"><CloseIcon size={14} /></button>
                  </div>
                  {SLIDERS.map(sl => {
                    const v = settings[sl.key] as number
                    const off = sl.key === 'groupPull' && !settings.groupByFaction   // only matters grouped
                    return (
                      <label key={sl.key} className={'wg-ctrl' + (off ? ' off' : '')} title={off ? 'Turn on Group by faction to use this' : undefined}>
                        <span className="wg-ctrl-label">{sl.label}</span>
                        <input type="range" className="journal-scrubber" disabled={off} min={sl.min} max={sl.max} step={sl.step} value={v}
                          onChange={e => set(sl.key, parseFloat(e.target.value) as never)}
                          style={{ ['--pct' as string]: `${((v - sl.min) / (sl.max - sl.min)) * 100}%` }} />
                        <span className="wg-ctrl-val">{sl.fmt(v)}</span>
                      </label>
                    )
                  })}
                  <label className="wg-check">
                    <input type="checkbox" checked={settings.groupByFaction} onChange={e => set('groupByFaction', e.target.checked)} />
                    Group by faction
                  </label>
                  <label className="wg-check">
                    <input type="checkbox" checked={settings.softenHubs} onChange={e => set('softenHubs', e.target.checked)} />
                    Soften links to busy pages
                  </label>
                  <label className="wg-check">
                    <input type="checkbox" checked={settings.hideLonely} onChange={e => set('hideLonely', e.target.checked)} />
                    Hide pages with no links
                  </label>
                  <button type="button" className="index-link wg-reset" onClick={() => setSettings(DEFAULTS)}>Reset to defaults</button>
                </div>
              )}
            </div>

            {sel && !(panelOpen && narrow) && (
              <aside className="wg-card" aria-label={`${sel.title}: its links`}>
                <div className="wg-card-head">
                  <span className="wg-card-kind"><span className="wg-swatch" style={{ background: colorOf(kindOf(sel.section)) }} />{kindLabelOf(kindOf(sel.section))}</span>
                  <button type="button" className="wg-panel-close" onClick={() => apiRef.current?.select(null)} aria-label="Clear selection"><CloseIcon size={14} /></button>
                </div>
                <h3 className="wg-card-title"><Link to={`${base}/${sel.id}`}>{sel.title}</Link></h3>
                {sel.excerpt && <p className="wg-card-excerpt">{sel.excerpt}</p>}
                {selLinks.length > 0 && (
                  <>
                    <div className="wg-card-sub">Linked with {selLinks.length} page{selLinks.length !== 1 ? 's' : ''}</div>
                    <ul className="wg-card-links">
                      {selLinks.map(n => (
                        <li key={n.id}>
                          <button type="button" onClick={() => pick(n)}>
                            <span className="wg-swatch" style={{ background: colorOf(kindOf(n.section)) }} />{n.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <Link to={`${base}/${sel.id}`} className="btn-secondary wg-card-open">Open page</Link>
              </aside>
            )}
          </div>
        )}
      {tip && (
        <div className="chart-tooltip" role="tooltip" style={{ left: tip.x + 14, top: tip.y + 14, position: 'fixed' }}>
          <strong>{tip.node.title}</strong>
          <div className="muted">{kindLabelOf(kindOf(tip.node.section))} · {tip.node.degree} link{tip.node.degree !== 1 ? 's' : ''}</div>
        </div>
      )}
    </div>
  )
}
