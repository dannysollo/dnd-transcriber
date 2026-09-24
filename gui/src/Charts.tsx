// Single-series horizontal bar lists for stats (talk time, session length,
// mentions). One hue per light (--chart-bar, validated against both page
// colors), values at the bar tips in ink, a tooltip on hover and keyboard
// focus, and a table view so nothing is hover-only.
import { useState, type ReactNode } from 'react'

export interface BarRow {
  key: string
  label: ReactNode          // shown left of the bar
  labelText: string         // plain text for the tooltip / table / aria
  value: number             // bar length
  display: string           // value text at the bar tip
  details?: string[]        // extra tooltip lines, after the value
}


export function BarList({ title, note, rows, valueHeader = 'Value' }: {
  title: string
  note?: string
  rows: BarRow[]
  valueHeader?: string
}) {
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null)
  const [asTable, setAsTable] = useState(false)
  const max = Math.max(1, ...rows.map(r => r.value))
  const hovered = hover ? rows.find(r => r.key === hover.key) : null

  return (
    <section className="barlist" aria-label={title}>
      <div className="barlist-head">
        <h3 className="sc">{title}</h3>
        <button type="button" className="index-link" aria-pressed={asTable} onClick={() => setAsTable(v => !v)}>
          {asTable ? 'show as chart' : 'show as table'}
        </button>
      </div>
      {note && <p className="barlist-note">{note}</p>}

      {asTable ? (
        <table className="barlist-table">
          <thead><tr><th scope="col">Name</th><th scope="col">{valueHeader}</th><th scope="col">Details</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key}><td>{r.labelText}</td><td>{r.display}</td><td>{(r.details ?? []).join(', ')}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="barlist-rows" onPointerLeave={() => setHover(null)}>
          {rows.map(r => (
            <div
              key={r.key}
              className={'barlist-row' + (hover?.key === r.key ? ' hot' : '')}
              tabIndex={0}
              aria-label={`${r.labelText}: ${r.display}${r.details?.length ? ', ' + r.details.join(', ') : ''}`}
              onPointerMove={e => setHover({ key: r.key, x: e.clientX, y: e.clientY })}
              onFocus={e => {
                const b = e.currentTarget.getBoundingClientRect()
                setHover({ key: r.key, x: b.left + b.width / 2, y: b.top })
              }}
              onBlur={() => setHover(null)}
            >
              <div className="barlist-label">{r.label}</div>
              <div className="barlist-track">
                {/* Scale within the track minus room for the tip label, so the longest bar's value never spills past the column. */}
                <div className="barlist-bar" style={{ ['--f' as string]: Math.max(0.005, r.value / max), width: `calc((100% - 150px) * ${Math.max(0.005, r.value / max)})` }} />
                <span className="barlist-value">{r.display}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {hovered && hover && !asTable && (
        <div className="chart-tooltip" role="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{hovered.display}</strong>
          <span>{hovered.labelText}</span>
          {hovered.details?.map(d => <span key={d} className="muted">{d}</span>)}
        </div>
      )}
    </section>
  )
}
