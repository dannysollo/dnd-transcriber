import { useTheme, type ColorMode } from '../ThemeContext'

const MODES: { id: ColorMode; label: string; note: string }[] = [
  { id: 'system', label: 'Match my device', note: 'Daylight or lamplit, following your system setting.' },
  { id: 'light', label: 'Daylight', note: 'Dark ink on warm paper.' },
  { id: 'dark', label: 'Lamplit', note: 'The same pages by lamplight, for late sessions.' },
]

export default function SettingsPage() {
  const { mode, setMode } = useTheme()

  return (
    <div className="page-content" style={{ padding: '40px 56px', maxWidth: '760px' }}>
      <h1 style={{ margin: 0, fontSize: '34px' }}>Preferences</h1>
      <p style={{ margin: '4px 0 0', color: 'var(--ink-soft)', fontStyle: 'italic' }}>
        Saved in this browser only.
      </p>

      <fieldset style={{ border: 'none', padding: 0, margin: '36px 0 0' }}>
        <legend className="sc" style={{ fontSize: '19px', color: 'var(--rubric)', fontWeight: 600, padding: 0 }}>
          Reading light
        </legend>
        <div style={{ borderTop: '1px solid var(--rule)', marginTop: '8px' }}>
          {MODES.map(m => {
            const on = mode === m.id
            return (
              <label
                key={m.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '22px 1fr',
                  gap: '10px',
                  alignItems: 'baseline',
                  padding: '14px 4px',
                  borderBottom: '1px solid var(--rule)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="color-mode"
                  value={m.id}
                  checked={on}
                  onChange={() => setMode(m.id)}
                  style={{ accentColor: 'var(--rubric)', margin: 0 }}
                />
                <span>
                  <span style={{ fontSize: '18px', color: 'var(--ink)', fontWeight: on ? 600 : 400 }}>{m.label}</span>
                  <span style={{ display: 'block', color: 'var(--ink-soft)', fontSize: '15px' }}>{m.note}</span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>
    </div>
  )
}
