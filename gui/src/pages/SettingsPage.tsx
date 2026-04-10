import { useTheme } from '../ThemeContext'

export default function SettingsPage() {
  const { theme, font, setTheme, setFont, themes, fonts, customConfig, setCustomConfig } = useTheme()
  const isCustom = theme.id === 'custom'

  return (
    <div className="page-content" style={{ padding: '32px', maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>Preferences</h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>Appearance and site preferences</p>
      </div>

      {/* Appearance */}
      <Section title="Color Theme">
        <div style={{ padding: '16px' }}>
          {/* Preset themes grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '10px' }}>
            {themes.filter(t => !t.custom).map(t => {
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
                    background: active ? t.elevated : t.surface,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    textAlign: 'left',
                  }}
                >
                  {/* Mini preview bar */}
                  <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
                    <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: t.bg }} />
                    <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: t.surface }} />
                    <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: t.accent }} />
                    {t.secondaryAccent && <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: t.secondaryAccent }} />}
                    <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: t.textPrimary, opacity: 0.5 }} />
                  </div>
                  {/* Label */}
                  <div style={{
                    fontSize: '13px',
                    fontWeight: active ? 700 : 500,
                    color: active ? t.accentText : t.textSecondary,
                    lineHeight: 1.2,
                  }}>
                    {t.label}
                  </div>
                  <div style={{ fontSize: '11px', color: t.textMuted, fontStyle: 'italic', marginTop: '-4px' }}>
                    {t.description}
                  </div>
                </button>
              )
            })}

            {/* Custom tile */}
            {(() => {
              const t = themes.find(x => x.custom)!
              const active = theme.id === 'custom'
              return (
                <button
                  key="custom"
                  onClick={() => setTheme('custom')}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '8px',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: active ? `2px solid ${t.accent}` : `2px dashed ${t.borderDefault}`,
                    background: active ? t.elevated : t.surface,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
                    <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: t.bg }} />
                    <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: t.surface }} />
                    <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: t.accent }} />
                    <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: t.secondaryAccent ?? t.accentText }} />
                    <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: t.textPrimary, opacity: 0.5 }} />
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: active ? 700 : 500, color: active ? t.accentText : t.textSecondary }}>
                    Custom
                  </div>
                  <div style={{ fontSize: '11px', color: t.textMuted, fontStyle: 'italic', marginTop: '-4px' }}>
                    Your own palette
                  </div>
                </button>
              )
            })()}
          </div>

          {/* Custom color controls — shown when Custom is active */}
          {isCustom && (
            <div style={{
              padding: '14px',
              borderRadius: '8px',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-elevated)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Custom Palette</div>

              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                {/* Primary color */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Primary accent</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="color"
                      value={customConfig.primaryHex}
                      onChange={e => setCustomConfig({ ...customConfig, primaryHex: e.target.value })}
                      style={{ width: 36, height: 36, borderRadius: '6px', border: '1px solid var(--border-default)', cursor: 'pointer', padding: 2 }}
                    />
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                      {customConfig.primaryHex}
                    </span>
                  </div>
                </label>

                {/* Secondary color */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Secondary accent</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="color"
                      value={customConfig.secondaryHex || '#e67e22'}
                      onChange={e => setCustomConfig({ ...customConfig, secondaryHex: e.target.value })}
                      style={{ width: 36, height: 36, borderRadius: '6px', border: '1px solid var(--border-default)', cursor: 'pointer', padding: 2 }}
                    />
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                      {customConfig.secondaryHex || '#e67e22'}
                    </span>
                  </div>
                </label>

                {/* Background warmth */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Background tone</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {(['warm', 'neutral', 'cool'] as const).map(w => (
                      <button
                        key={w}
                        onClick={() => setCustomConfig({ ...customConfig, bgWarmth: w })}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '6px',
                          border: customConfig.bgWarmth === w ? '2px solid var(--accent)' : '2px solid var(--border-default)',
                          background: customConfig.bgWarmth === w ? 'var(--accent-muted)' : 'var(--bg-base)',
                          color: customConfig.bgWarmth === w ? 'var(--accent-text)' : 'var(--text-muted)',
                          fontSize: '12px',
                          cursor: 'pointer',
                          fontWeight: customConfig.bgWarmth === w ? 600 : 400,
                          textTransform: 'capitalize',
                        }}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section title="Font">
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
                fontSize: '14px',
                fontWeight: font.id === f.id ? 600 : 400,
                fontFamily: f.family,
                transition: 'all 0.15s ease',
                textAlign: 'left',
              }}
            >
              {f.label}
              <span style={{ fontSize: '11px', opacity: 0.5, fontFamily: 'system-ui, sans-serif', fontWeight: 400, marginLeft: 'auto' }}>
                {font.id === f.id ? '✓ Active' : 'The quick brown fox'}
              </span>
            </button>
          ))}
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
