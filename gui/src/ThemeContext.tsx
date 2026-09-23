import React, { createContext, useContext, useEffect, useState } from 'react'

/**
 * The app has one look (the journal) in two lights: "light" (daylight paper)
 * and "dark" (lamplit). "system" follows the OS preference. The resolved mode
 * is stamped on <html data-theme>, which index.css keys its tokens off; a tiny
 * inline script in index.html does the same before first paint so there's no
 * flash of the wrong mode.
 */
export type ColorMode = 'system' | 'light' | 'dark'
export type ResolvedMode = 'light' | 'dark'

const STORAGE_KEY = 'dnd-color-mode'

interface ThemeContextValue {
  mode: ColorMode
  resolved: ResolvedMode
  setMode: (mode: ColorMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  resolved: 'light',
  setMode: () => {},
})

function readStoredMode(): ColorMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ColorMode>(readStoredMode)
  const [systemDark, setSystemDark] = useState(() => darkQuery().matches)

  useEffect(() => {
    const q = darkQuery()
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    q.addEventListener('change', onChange)
    return () => q.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedMode = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const setMode = (m: ColorMode) => {
    try { localStorage.setItem(STORAGE_KEY, m) } catch { /* private mode: session-only */ }
    setModeState(m)
  }

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
