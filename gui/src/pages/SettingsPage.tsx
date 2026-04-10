import { useTheme } from '../ThemeContext'

export default function SettingsPage() {
  const { theme, font, setTheme, setFont, themes, fonts } = useTheme()

  return (
    <div className="page-content" style={{ padding: '32px', maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>Settings</h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>Appearance and site preferences</p>
      </div>

      {/* Appearance */}
      <Section title="Appearance">
        <div style={{ padding: '16px' }}>
          {/* Theme picker */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', fontWeight: 600 }}>Color Theme</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              {themes.map(t => {
                const active = theme.id === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: active ? `2px solid ${t.accent}` : `2px solid ${t.borderDefault}`,
                      background: active ? t.card : t.surface,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      textAlign: 'left',
                    }}
                  >
                    {/* Palette swatch row */}
                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                      <span style={{
                        width: 18, height: 18, borderRadius: '50%',
                        background: t.accent,
                        boxShadow: active ? `0 0 8px ${t.accent}80` : 'none',
                        flexShrink: 0,
                      }} />
                      {t.secondaryAccent && (
                        <span style={{
                          width: 14, height: 14, borderRadius: '50%',
                          background: t.secondaryAccent,
                          flexShrink: 0,
                          opacity: 0.85,
                        }} />
                      )}
                      {/* Text color swatch */}
                      <span style={{
                        width: 12, height: 12, borderRadius: '3px',
                        background: t.textPrimary,
                        flexShrink: 0,
                        opacity: 0.7,
                      }} />
                    </div>
                    {/* Label + description */}
                    <div>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: active ? 700 : 500,
                        color: active ? t.accentText : t.textSecondary,
                        lineHeight: 1.2,
                      }}>
                        {t.label}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        color: t.textMuted,
                        marginTop: '2px',
                        fontStyle: 'italic',
                      }}>
                        {t.description}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Font picker */}
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', fontWeight: 600 }}>Font</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {fonts.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFont(f.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: font.id === f.id ? '2px solid var(--accent)' : '2px solid var(--border-default)',
                    background: font.id === f.id ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                    cursor: 'pointer',
                    color: font.id === f.id ? 'var(--accent-text)' : 'var(--text-secondary)',
                    fontSize: '13px',
                    fontWeight: font.id === f.id ? 600 : 400,
                    fontFamily: f.family,
                    transition: 'all 0.15s ease',
                    textAlign: 'left',
                  }}
                >
                  {f.label}
                  <span style={{ fontSize: '11px', opacity: 0.5, fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 400 }}>
                    {font.id === f.id ? '✓ Active' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
        {title}
      </div>
      <div style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: '10px',
        overflow: 'hidden',
      }}>
        {children}
      </div>
    </div>
  )
}
