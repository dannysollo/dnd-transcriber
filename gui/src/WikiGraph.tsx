import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom'
import { drag } from 'd3-drag'

// The wiki's relationship graph: every page, a line wherever one links to
// another. Colour is the page's kind (a fixed slot per kind, validated for
// colour-blind separation on both page colours; the legend and labels carry
// it too). Bigger dots have more links. Laid out up front, then still: drag
// a dot to move it, scroll or pinch to zoom, click to open the page.

interface Node extends SimulationNodeDatum { id: string; title: string; section: string; degree: number }
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
const colorOf = (kind: string) => {
  const k = KINDS.find(x => x.key === kind)
  return k ? `var(--wg-${k.slot})` : 'var(--wg-other)'
}
const radius = (d: Node) => 4 + Math.sqrt(d.degree) * 1.7
const ALWAYS_LABELLED = 14   // the best-connected pages are always named; the rest when zoomed in or lit
const LABEL_ZOOM = 1.8

export default function WikiGraph({ slug, base, focus }: { slug: string; base: string; focus?: string | null }) {
  const navigate = useNavigate()
  const svgRef = useRef<SVGSVGElement>(null)
  const [data, setData] = useState<{ nodes: Node[]; links: Edge[] } | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [tip, setTip] = useState<{ x: number; y: number; node: Node } | null>(null)

  useEffect(() => {
    fetch(`/campaigns/${slug}/wiki/graph`).then(r => r.json()).then(setData).catch(() => setData({ nodes: [], links: [] }))
  }, [slug])

  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const n of data?.nodes ?? []) c.set(kindOf(n.section), (c.get(kindOf(n.section)) ?? 0) + 1)
    return c
  }, [data])

  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl || !data || !data.nodes.length) return
    const width = svgEl.clientWidth, height = svgEl.clientHeight
    const nodes: Node[] = data.nodes.filter(n => !hidden.has(kindOf(n.section))).map(n => ({ ...n }))
    const ids = new Set(nodes.map(n => n.id))
    const links: Edge[] = data.links.filter(l => ids.has(l.source as string) && ids.has(l.target as string)).map(l => ({ ...l }))
    const neighbours = new Map<string, Set<string>>()
    for (const l of links) {
      const a = l.source as string, b = l.target as string
      neighbours.set(a, (neighbours.get(a) ?? new Set()).add(b))
      neighbours.set(b, (neighbours.get(b) ?? new Set()).add(a))
    }

    const sim = forceSimulation(nodes)
      .force('link', forceLink<Node, Edge>(links).id(d => d.id).distance(90).strength(0.12))
      .force('charge', forceManyBody().strength(-360).distanceMax(700))
      .force('x', forceX(width / 2).strength(0.035))
      .force('y', forceY(height / 2).strength(0.035))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<Node>().radius(d => radius(d) + 6))
      .stop()
    for (let i = 0; i < 450; i++) sim.tick()   // lay out up front: no drifting animation
    const named = new Set([...nodes].sort((a, b) => b.degree - a.degree).slice(0, ALWAYS_LABELLED).map(n => n.id))

    const svg = select(svgEl)
    svg.selectAll('*').remove()
    const g = svg.append('g')
    const line = g.append('g').attr('class', 'wg-links').selectAll('line').data(links).join('line')
    const dot = g.append('g').attr('class', 'wg-nodes').selectAll<SVGCircleElement, Node>('circle').data(nodes).join('circle')
      .attr('r', radius).attr('fill', d => colorOf(kindOf(d.section))).attr('class', 'wg-node')
      .attr('tabindex', 0).attr('role', 'link').attr('aria-label', d => `${d.title}, ${d.degree} links`)
    const label = g.append('g').attr('class', 'wg-labels').selectAll<SVGTextElement, Node>('text').data(nodes).join('text')
      .text(d => d.title).attr('dy', d => -radius(d) - 4)

    let scale = 1
    const place = () => {
      line.attr('x1', d => (d.source as Node).x!).attr('y1', d => (d.source as Node).y!)
        .attr('x2', d => (d.target as Node).x!).attr('y2', d => (d.target as Node).y!)
      dot.attr('cx', d => d.x!).attr('cy', d => d.y!)
      label.attr('x', d => d.x!).attr('y', d => d.y!)
        .attr('class', d => 'wg-label' + (named.has(d.id) || scale >= LABEL_ZOOM ? ' on' : ''))
    }
    place()

    const highlight = (id: string | null) => {
      const near = id ? new Set([id, ...(neighbours.get(id) ?? [])]) : null
      dot.classed('dim', d => !!near && !near.has(d.id))
      label.classed('hot', d => !!near && near.has(d.id)).classed('dim', d => !!near && !near.has(d.id))
      line.classed('hot', d => !!id && ((d.source as Node).id === id || (d.target as Node).id === id))
        .classed('dim', d => !!id && (d.source as Node).id !== id && (d.target as Node).id !== id)
    }

    const zoomer = zoom<SVGSVGElement, unknown>().scaleExtent([0.25, 6]).on('zoom', e => {
      const t: ZoomTransform = e.transform
      g.attr('transform', t.toString())
      if ((t.k >= LABEL_ZOOM) !== (scale >= LABEL_ZOOM)) { scale = t.k; place() } else scale = t.k
    })
    svg.call(zoomer)

    dot.on('mouseenter', (e: MouseEvent, d) => { highlight(d.id); setTip({ x: e.clientX, y: e.clientY, node: d }) })
      .on('mousemove', (e: MouseEvent, d) => setTip({ x: e.clientX, y: e.clientY, node: d }))
      .on('mouseleave', () => { highlight(focus ?? null); setTip(null) })
      .on('focus', (_e, d) => highlight(d.id)).on('blur', () => highlight(focus ?? null))
      .on('click', (_e, d) => navigate(`${base}/${d.id}`))
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

    // Fit what matters in the window: the whole graph, or a page and its
    // neighbours (from a page's "See it in the graph").
    const fit = (subset: Node[], maxScale: number) => {
      const xs = subset.map(n => n.x!), ys = subset.map(n => n.y!)
      const pad = 40
      const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad
      const k = Math.min(maxScale, width / (x1 - x0), height / (y1 - y0))
      svg.call(zoomer.transform, zoomIdentity.translate(width / 2 - k * (x0 + x1) / 2, height / 2 - k * (y0 + y1) / 2).scale(k))
    }
    const f = focus ? nodes.find(n => n.id === focus) : null
    if (f) {
      highlight(f.id)
      const near = neighbours.get(f.id) ?? new Set<string>()
      fit(nodes.filter(n => n.id === f.id || near.has(n.id)), 2.2)
    } else {
      fit(nodes, 1.4)
    }
    return () => { sim.stop(); svg.on('.zoom', null) }
  }, [data, hidden, focus])

  const toggle = (k: string) => setHidden(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })

  return (
    <div className="wiki-graph">
      <div className="wiki-graph-head">
        <nav className="wiki-crumbs" aria-label="Breadcrumb"><Link to={base}>Wiki</Link> / Relationship graph</nav>
        <p className="wiki-note">Every page, joined wherever one links to another; bigger dots have more links.
          Drag to move, scroll or pinch to zoom, click a dot to open its page.</p>
        <ul className="wg-legend" aria-label="Kinds of page (click to hide or show)">
          {KINDS.filter(k => counts.get(k.key)).map(k => (
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
        : <svg ref={svgRef} className="wg-svg" role="img" aria-label="Relationship graph of the wiki's pages" />}
      {tip && (
        <div className="chart-tooltip" role="tooltip" style={{ left: tip.x + 14, top: tip.y + 14, position: 'fixed' }}>
          <strong>{tip.node.title}</strong>
          <div className="muted">{tip.node.section || 'Other'} · {tip.node.degree} link{tip.node.degree !== 1 ? 's' : ''}</div>
        </div>
      )}
    </div>
  )
}
