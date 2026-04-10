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
  textPrimary: string
  textSecondary: string
  textMuted: string
  borderSubtle: string
  borderDefault: string
  danger: string
}

export interface FontDefinition {
  id: string
  label: string
  family: string
}

export const themes: ThemeDefinition[] = [
  {
    // Blood red accent on warm bone/parchment text — classic D&D danger feel
    id: 'crimson-bone',
    label: 'Crimson & Bone',
    description: 'Blood red on warm parchment',
    bg: '#0e0b09',
    surface: '#16100d',
    elevated: '#1d1510',
    overlay: '#241a13',
    card: '#201812',
    accent: '#b83232',
    accentHover: '#d94040',
    accentMuted: 'rgba(184,50,50,0.15)',
    accentText: '#e08070',
    textPrimary: '#e8d5bc',
    textSecondary: '#b89e84',
    textMuted: '#7a6355',
    borderSubtle: '#2a1e17',
    borderDefault: '#332419',
    danger: '#e53e3e',
  },
  {
    // Deep purple accent on cool silver-blue text — arcane spell energy
    id: 'arcane',
    label: 'Arcane Void',
    description: 'Violet magic on silver starlight',
    bg: '#090b14',
    surface: '#0e1120',
    elevated: '#12162a',
    overlay: '#171b32',
    card: '#141830',
    accent: '#7c6cfc',
    accentHover: '#9d8fff',
    accentMuted: 'rgba(124,108,252,0.18)',
    accentText: '#b8aeff',
    secondaryAccent: '#e879f9',
    secondaryAccentText: '#f0abfc',
    textPrimary: '#c8d0ec',
    textSecondary: '#7a88b0',
    textMuted: '#505870',
    borderSubtle: '#1c2040',
    borderDefault: '#222648',
    danger: '#f87171',
  },
  {
    // Aged gold accent on warm ivory/parchment — wizard's library, scholarly
    id: 'gold-parchment',
    label: 'Gold & Parchment',
    description: 'Candlelight gold on aged ivory',
    bg: '#0f0d07',
    surface: '#17140a',
    elevated: '#1e1b0f',
    overlay: '#252114',
    card: '#221e12',
    accent: '#c9a030',
    accentHover: '#e0b84a',
    accentMuted: 'rgba(201,160,48,0.18)',
    accentText: '#ddc070',
    secondaryAccent: '#9b6b3a',
    secondaryAccentText: '#c4966a',
    textPrimary: '#ecddc0',
    textSecondary: '#b8a07a',
    textMuted: '#80704a',
    borderSubtle: '#2c2614',
    borderDefault: '#342e18',
    danger: '#e05c2a',
  },
  {
    // Teal accent with amber highlights on pale aqua text — sea/storm mage
    id: 'teal-ember',
    label: 'Teal & Ember',
    description: 'Ocean teal with amber fire',
    bg: '#060d0e',
    surface: '#0b1618',
    elevated: '#101e20',
    overlay: '#152628',
    card: '#122224',
    accent: '#0e9f94',
    accentHover: '#18c4b8',
    accentMuted: 'rgba(14,159,148,0.15)',
    accentText: '#34d8cc',
    secondaryAccent: '#e07820',
    secondaryAccentText: '#f0a050',
    textPrimary: '#c8e8e5',
    textSecondary: '#6aaca8',
    textMuted: '#406a68',
    borderSubtle: '#152e2c',
    borderDefault: '#1c3836',
    danger: '#e05c3a',
  },
  {
    // Forest green on pale sage — druid, nature, the wilds
    id: 'forest',
    label: 'Ironwood',
    description: 'Forest green on pale sage',
    bg: '#080c08',
    surface: '#0d130d',
    elevated: '#111a11',
    overlay: '#162016',
    card: '#131e13',
    accent: '#4a9460',
    accentHover: '#64b87c',
    accentMuted: 'rgba(74,148,96,0.15)',
    accentText: '#80d098',
    secondaryAccent: '#8a6a30',
    secondaryAccentText: '#c09050',
    textPrimary: '#cce0cc',
    textSecondary: '#7aaa80',
    textMuted: '#4a6850',
    borderSubtle: '#1a2a1a',
    borderDefault: '#203020',
    danger: '#d94040',
  },
  {
    // Steel blue on pale cold text — castle, iron, the north
    id: 'midnight',
    label: 'Midnight Steel',
    description: 'Cold blue on pale silver',
    bg: '#07090f',
    surface: '#0c1020',
    elevated: '#111628',
    overlay: '#161c30',
    card: '#131a2e',
    accent: '#3a7bd5',
    accentHover: '#5898f0',
    accentMuted: 'rgba(58,123,213,0.18)',
    accentText: '#88b8f8',
    secondaryAccent: '#7090b0',
    secondaryAccentText: '#a0c0d8',
    textPrimary: '#c0cce0',
    textSecondary: '#6878a0',
    textMuted: '#404e6a',
    borderSubtle: '#181e38',
    borderDefault: '#1e2640',
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

interface ThemeContextValue {
  theme: ThemeDefinition
  font: FontDefinition
  setTheme: (id: string) => void
  setFont: (id: string) => void
  themes: ThemeDefinition[]
  fonts: FontDefinition[]
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: themes[0],
  font: fonts[0],
  setTheme: () => {},
  setFont: () => {},
  themes,
  fonts,
})

function applyTheme(t: ThemeDefinition, f: FontDefinition) {
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
  root.style.setProperty('--success', '#4ade80')
  root.style.setProperty('--error', '#f87171')
  root.style.setProperty('--warning', '#fbbf24')
  root.style.setProperty('--danger', t.danger)
  root.style.setProperty('--font-heading', f.family)
  root.style.setProperty('--font-body', f.family)
}

// Simple helper to lighten a hex color by adding brightness
function adjustColor(hex: string, amount: number): string {
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

  const currentTheme = themes.find(t => t.id === themeId) ?? themes[0]
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

  return (
    <ThemeContext.Provider value={{ theme: currentTheme, font: currentFont, setTheme, setFont, themes, fonts }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
