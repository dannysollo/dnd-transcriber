import React, { createContext, useContext, useEffect, useState } from 'react'

export interface ThemeDefinition {
  id: string
  label: string
  bg: string
  surface: string
  elevated: string
  overlay: string
  accent: string
  accentHover: string
  accentMuted: string
  accentText: string
}

export interface FontDefinition {
  id: string
  label: string
  family: string
}

export const themes: ThemeDefinition[] = [
  {
    id: 'arcane',
    label: 'Arcane',
    bg: '#0f1117',
    surface: '#13151f',
    elevated: '#191c2a',
    overlay: '#1e2130',
    accent: '#7c6cfc',
    accentHover: '#9d8fff',
    accentMuted: 'rgba(124,108,252,0.15)',
    accentText: '#a89cff',
  },
  {
    id: 'crimson',
    label: 'Crimson',
    bg: '#0d0a0a',
    surface: '#16100f',
    elevated: '#1c1411',
    overlay: '#221814',
    accent: '#c0392b',
    accentHover: '#e74c3c',
    accentMuted: 'rgba(192,57,43,0.15)',
    accentText: '#e8816f',
  },
  {
    id: 'teal',
    label: 'Teal',
    bg: '#060f0f',
    surface: '#0d1a1a',
    elevated: '#112020',
    overlay: '#162626',
    accent: '#0d9488',
    accentHover: '#14b8a6',
    accentMuted: 'rgba(13,148,136,0.15)',
    accentText: '#2dd4bf',
  },
  {
    id: 'gold',
    label: 'Gold',
    bg: '#110f08',
    surface: '#1a1610',
    elevated: '#201c13',
    overlay: '#262116',
    accent: '#c9a84c',
    accentHover: '#d4b866',
    accentMuted: 'rgba(201,168,76,0.15)',
    accentText: '#ddc97a',
  },
  {
    id: 'amethyst',
    label: 'Amethyst',
    bg: '#0a0a14',
    surface: '#10101e',
    elevated: '#151525',
    overlay: '#1a1a2e',
    accent: '#8b5cf6',
    accentHover: '#a78bfa',
    accentMuted: 'rgba(139,92,246,0.15)',
    accentText: '#c4b5fd',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    bg: '#080c14',
    surface: '#0d1424',
    elevated: '#101a2e',
    overlay: '#142038',
    accent: '#3b82f6',
    accentHover: '#60a5fa',
    accentMuted: 'rgba(59,130,246,0.15)',
    accentText: '#93c5fd',
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
  root.style.setProperty('--border-subtle', t.overlay)
  root.style.setProperty('--border-default', adjustColor(t.overlay, 8))
  root.style.setProperty('--border-strong', adjustColor(t.overlay, 16))
  root.style.setProperty('--text-primary', '#e2e8f0')
  root.style.setProperty('--text-secondary', '#94a3b8')
  root.style.setProperty('--text-muted', '#64748b')
  root.style.setProperty('--accent', t.accent)
  root.style.setProperty('--accent-hover', t.accentHover)
  root.style.setProperty('--accent-muted', t.accentMuted)
  root.style.setProperty('--accent-text', t.accentText)
  root.style.setProperty('--success', '#4ade80')
  root.style.setProperty('--error', '#f87171')
  root.style.setProperty('--warning', '#fbbf24')
  root.style.setProperty('--font-heading', f.family)
  root.style.setProperty('--font-body', "'Inter', system-ui, sans-serif")
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
