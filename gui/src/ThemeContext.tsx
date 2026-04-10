import React, { createContext, useContext, useEffect, useState } from 'react'

export interface ThemeDefinition {
  id: string
  label: string
  description: string
  bg: string
  surface: string
  elevated: string
  overlay: string
  card: string
  accent: string
  accentHover: string
  accentMuted: string
  accentText: string
  secondaryAccent?: string
  secondaryAccentText?: string
  tertiaryAccent?: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  borderSubtle: string
  borderDefault: string
  danger: string
  custom?: boolean
}

export interface FontDefinition {
  id: string
  label: string
  family: string
}

/** Generate a full theme from primary hue + optional secondary hue + background warmth */
export function generateTheme(
  primaryHex: string,
  secondaryHex: string | null,
  bgWarmth: 'warm' | 'neutral' | 'cool',
): Omit<ThemeDefinition, 'id' | 'label' | 'description' | 'custom'> {
  // Parse primary hex to HSL
  const [pH, pS, pL] = hexToHsl(primaryHex)
  const [sH, sS, sL] = secondaryHex ? hexToHsl(secondaryHex) : [pH, pS, pL]

  // Background tint hue — slightly rotate toward warm/cool
  const bgHue = bgWarmth === 'warm' ? pH - 10 : bgWarmth === 'cool' ? pH + 30 : pH
  const bgSat = bgWarmth === 'neutral' ? 8 : 12

  return {
    bg:           hsl(bgHue, bgSat, 5),
    surface:      hsl(bgHue, bgSat, 7.5),
    elevated:     hsl(bgHue, bgSat, 10),
    overlay:      hsl(bgHue, bgSat, 12),
    card:         hsl(bgHue, bgSat, 9),
    accent:       hsl(pH, Math.min(pS, 70), Math.max(pL, 45)),
    accentHover:  hsl(pH, Math.min(pS, 70), Math.min(pL + 12, 70)),
    accentMuted:  `rgba(${hslToRgb(pH, Math.min(pS, 70), Math.max(pL, 45)).join(',')},0.18)`,
    accentText:   hsl(pH, Math.min(pS - 10, 60), Math.min(pL + 20, 85)),
    secondaryAccent:     secondaryHex ? hsl(sH, Math.min(sS, 65), Math.max(sL, 40)) : undefined,
    secondaryAccentText: secondaryHex ? hsl(sH, Math.min(sS - 10, 55), Math.min(sL + 22, 82)) : undefined,
    // tertiary: mid-dark version of primary hue — card borders, tab lines, input focus
    tertiaryAccent: hsl(pH, Math.min(pS * 0.6, 40), 20),
    textPrimary:  bgWarmth === 'warm' ? hsl(bgHue, 22, 88) : bgWarmth === 'cool' ? hsl(bgHue, 18, 86) : hsl(bgHue, 12, 87),
    textSecondary: bgWarmth === 'warm' ? hsl(bgHue, 16, 60) : bgWarmth === 'cool' ? hsl(bgHue, 14, 58) : hsl(bgHue, 8, 58),
    textMuted:    bgWarmth === 'warm' ? hsl(bgHue, 10, 38) : hsl(bgHue, 8, 36),
    borderSubtle: hsl(bgHue, bgSat, 14),
    borderDefault: hsl(bgHue, bgSat, 18),
    danger:       '#e05050',
  }
}

function hsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360
  return `hsl(${Math.round(h)},${Math.round(s)}%,${Math.round(l)}%)`
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s * 100, l * 100]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

export const themes: ThemeDefinition[] = [
  {
    id: 'crimson-bone',
    label: 'Crimson & Bone',
    description: 'Blood red on warm parchment',
    // Warm brown-tinted darks — clearly brown/sepia, not blue-grey
    bg:      '#130b07',
    surface: '#1d1009',
    elevated:'#27160d',
    overlay: '#301c11',
    card:    '#241409',
    accent:  '#c0392b',
    accentHover: '#e04535',
    accentMuted: 'rgba(192,57,43,0.18)',
    accentText:  '#f0806a',
    secondaryAccent:     '#c9a84c',
    secondaryAccentText: '#f0ddc0',
    tertiaryAccent: '#5a1a10',
    textPrimary:  '#f0ddc0',
    textSecondary:'#c0987a',
    textMuted:    '#806048',
    borderSubtle: '#2e1a0f',
    borderDefault:'#3e2416',
    danger: '#e53030',
  },
  {
    id: 'arcane',
    label: 'Arcane Void',
    description: 'Violet magic on silver starlight',
    // Cold blue-indigo tints — clearly cool/cosmic
    bg:      '#07080f',
    surface: '#0d0f1e',
    elevated:'#13162a',
    overlay: '#181c32',
    card:    '#111428',
    accent:  '#7c6cfc',
    accentHover: '#9d8fff',
    accentMuted: 'rgba(124,108,252,0.18)',
    accentText:  '#b8aeff',
    secondaryAccent:     '#e879f9',
    secondaryAccentText: '#f0abfc',
    tertiaryAccent: '#2a1e6e',
    textPrimary:   '#ccd4f0',
    textSecondary: '#7080b0',
    textMuted:     '#484e70',
    borderSubtle: '#181c38',
    borderDefault:'#202448',
    danger: '#f87171',
  },
  {
    id: 'gold-parchment',
    label: 'Gold & Parchment',
    description: 'Candlelight gold on aged ivory',
    // Warm amber/ochre darks — old book feel
    bg:      '#110e05',
    surface: '#1c1709',
    elevated:'#25200e',
    overlay: '#2e2814',
    card:    '#221e0c',
    accent:  '#d4a017',
    accentHover: '#f0be30',
    accentMuted: 'rgba(212,160,23,0.2)',
    accentText:  '#f0cc70',
    secondaryAccent:     '#a05820',
    secondaryAccentText: '#d08850',
    tertiaryAccent: '#5a3e08',
    textPrimary:  '#f4e4c0',
    textSecondary:'#c0a068',
    textMuted:    '#806040',
    borderSubtle: '#2e2610',
    borderDefault:'#3c3018',
    danger: '#e06030',
  },
  {
    id: 'teal-ember',
    label: 'Teal & Ember',
    description: 'Ocean teal with amber fire',
    // Deep teal-green darks — sea/nature
    bg:      '#050d0d',
    surface: '#091616',
    elevated:'#0e2020',
    overlay: '#132828',
    card:    '#0c1c1c',
    accent:  '#12b8aa',
    accentHover: '#20dccb',
    accentMuted: 'rgba(18,184,170,0.15)',
    accentText:  '#40e8da',
    secondaryAccent:     '#e08020',
    secondaryAccentText: '#f8b050',
    tertiaryAccent: '#0a3e3a',
    textPrimary:  '#c8ecec',
    textSecondary:'#60b0b0',
    textMuted:    '#3c7070',
    borderSubtle: '#0f2c2c',
    borderDefault:'#163838',
    danger: '#e04040',
  },
  {
    id: 'forest',
    label: 'Ironwood',
    description: 'Forest green on pale sage',
    // Deep forest darks — clearly green-tinted
    bg:      '#050d07',
    surface: '#091409',
    elevated:'#0f1c10',
    overlay: '#142416',
    card:    '#0c180d',
    accent:  '#3aaa58',
    accentHover: '#52cc70',
    accentMuted: 'rgba(58,170,88,0.15)',
    accentText:  '#70e090',
    secondaryAccent:     '#907840',
    secondaryAccentText: '#c8a860',
    tertiaryAccent: '#14401e',
    textPrimary:  '#c8e8cc',
    textSecondary:'#68a870',
    textMuted:    '#406848',
    borderSubtle: '#142818',
    borderDefault:'#1c3420',
    danger: '#d94040',
  },
  {
    id: 'midnight',
    label: 'Midnight Steel',
    description: 'Cold steel blue on pale silver',
    // Desaturated blue-grey — cold and metallic
    bg:      '#060810',
    surface: '#0a0e1c',
    elevated:'#101626',
    overlay: '#151d30',
    card:    '#0e1424',
    accent:  '#4888e0',
    accentHover: '#6aa4f8',
    accentMuted: 'rgba(72,136,224,0.18)',
    accentText:  '#90c0f8',
    secondaryAccent:     '#8098b8',
    secondaryAccentText: '#b0c8e0',
    tertiaryAccent: '#18285e',
    textPrimary:  '#c8d4e8',
    textSecondary:'#6878a8',
    textMuted:    '#404e70',
    borderSubtle: '#161e38',
    borderDefault:'#1c2640',
    danger: '#f06060',
  },
]

export const fonts: FontDefinition[] = [
  { id: 'system', label: 'System', family: 'system-ui, sans-serif' },
  { id: 'cinzel', label: 'Cinzel', family: 'Cinzel, serif' },
  { id: 'rajdhani', label: 'Rajdhani', family: 'Rajdhani, sans-serif' },
  { id: 'im-fell', label: 'IM Fell English', family: "'IM Fell English', serif" },
  { id: 'crimson-pro', label: 'Crimson Pro', family: "'Crimson Pro', serif" },
]

interface CustomThemeConfig {
  primaryHex: string
  secondaryHex: string
  tertiaryHex: string
  bgWarmth: 'warm' | 'neutral' | 'cool'
}

interface ThemeContextValue {
  theme: ThemeDefinition
  font: FontDefinition
  setTheme: (id: string) => void
  setFont: (id: string) => void
  themes: ThemeDefinition[]
  fonts: FontDefinition[]
  customConfig: CustomThemeConfig
  setCustomConfig: (cfg: CustomThemeConfig) => void
}

const DEFAULT_CUSTOM: CustomThemeConfig = {
  primaryHex: '#9b59b6',
  secondaryHex: '#e67e22',
  tertiaryHex: '#3d1a5a',
  bgWarmth: 'neutral',
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: themes[0],
  font: fonts[0],
  setTheme: () => {},
  setFont: () => {},
  themes,
  fonts,
  customConfig: DEFAULT_CUSTOM,
  setCustomConfig: () => {},
})

function buildCustomTheme(cfg: CustomThemeConfig): ThemeDefinition {
  const generated = generateTheme(cfg.primaryHex, cfg.secondaryHex || null, cfg.bgWarmth)
  return {
    id: 'custom',
    label: 'Custom',
    description: 'Your custom palette',
    custom: true,
    ...generated,
    tertiaryAccent: cfg.tertiaryHex || generated.tertiaryAccent,
  }
}

export function applyTheme(t: ThemeDefinition, f: FontDefinition) {
  const root = document.documentElement
  root.style.setProperty('--bg-base', t.bg)
  root.style.setProperty('--bg-surface', t.surface)
  root.style.setProperty('--bg-elevated', t.elevated)
  root.style.setProperty('--bg-overlay', t.overlay)
  root.style.setProperty('--bg-card', t.card)
  root.style.setProperty('--border-subtle', t.borderSubtle)
  root.style.setProperty('--border-default', t.borderDefault)
  root.style.setProperty('--border-strong', adjustColor(t.borderDefault, 12))
  root.style.setProperty('--text-primary', t.textPrimary)
  root.style.setProperty('--text-secondary', t.textSecondary)
  root.style.setProperty('--text-muted', t.textMuted)
  root.style.setProperty('--accent', t.accent)
  root.style.setProperty('--accent-hover', t.accentHover)
  root.style.setProperty('--accent-muted', t.accentMuted)
  root.style.setProperty('--accent-text', t.accentText)
  root.style.setProperty('--accent2', t.secondaryAccent ?? t.accent)
  root.style.setProperty('--accent2-text', t.secondaryAccentText ?? t.accentText)
  root.style.setProperty('--accent3', t.tertiaryAccent ?? t.borderDefault)
  root.style.setProperty('--accent3-muted', t.tertiaryAccent
    ? `color-mix(in srgb, ${t.tertiaryAccent} 60%, transparent)`
    : t.borderDefault)
  root.style.setProperty('--success', '#4ade80')
  root.style.setProperty('--error', '#f87171')
  root.style.setProperty('--warning', '#fbbf24')
  root.style.setProperty('--danger', t.danger)
  root.style.setProperty('--font-heading', f.family)
  root.style.setProperty('--font-body', f.family)
}

// Simple helper to lighten a hex color
function adjustColor(hex: string, amount: number): string {
  // Handle hsl() values too
  if (hex.startsWith('hsl')) return hex
  const result = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!result) return hex
  const r = Math.min(255, parseInt(result[1], 16) + amount)
  const g = Math.min(255, parseInt(result[2], 16) + amount)
  const b = Math.min(255, parseInt(result[3], 16) + amount)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<string>(() => {
    return localStorage.getItem('dnd-theme') || 'arcane'
  })
  const [fontId, setFontId] = useState<string>(() => {
    return localStorage.getItem('dnd-font') || 'system'
  })
  const [customConfig, setCustomConfigState] = useState<CustomThemeConfig>(() => {
    try {
      const saved = localStorage.getItem('dnd-custom-theme')
      return saved ? JSON.parse(saved) : DEFAULT_CUSTOM
    } catch { return DEFAULT_CUSTOM }
  })

  const customTheme = buildCustomTheme(customConfig)
  const allThemes = [...themes, customTheme]

  const currentTheme = themeId === 'custom'
    ? customTheme
    : (themes.find(t => t.id === themeId) ?? themes[0])
  const currentFont = fonts.find(f => f.id === fontId) ?? fonts[0]

  useEffect(() => {
    applyTheme(currentTheme, currentFont)
  }, [currentTheme, currentFont])

  const setTheme = (id: string) => {
    localStorage.setItem('dnd-theme', id)
    setThemeId(id)
  }

  const setFont = (id: string) => {
    localStorage.setItem('dnd-font', id)
    setFontId(id)
  }

  const setCustomConfig = (cfg: CustomThemeConfig) => {
    localStorage.setItem('dnd-custom-theme', JSON.stringify(cfg))
    setCustomConfigState(cfg)
  }

  return (
    <ThemeContext.Provider value={{
      theme: currentTheme, font: currentFont,
      setTheme, setFont, themes: allThemes, fonts,
      customConfig, setCustomConfig,
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
