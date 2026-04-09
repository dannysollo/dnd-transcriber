import { createContext, useCallback, useContext, useRef, useState } from 'react'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: number
  message: string
  kind: ToastKind
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

const KIND_STYLES: Record<ToastKind, { bg: string; border: string; icon: string }> = {
  success: { bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.3)',  icon: '✓' },
  error:   { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)', icon: '✕' },
  warning: { bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.3)',  icon: '!' },
  info:    { bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.3)',  icon: 'i' },
}

const KIND_TEXT: Record<ToastKind, string> = {
  success: '#4ade80',
  error:   '#f87171',
  warning: '#fbbf24',
  info:    '#60a5fa',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++
    setToasts(prev => [...prev, { id, message, kind }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3500)
  }, [])

  const dismiss = (id: number) => setToasts(prev => prev.filter(t => t.id !== id))

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}>
        {toasts.map(t => {
          const s = KIND_STYLES[t.kind]
          return (
            <div
              key={t.id}
              onClick={() => dismiss(t.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--bg-elevated)',
                border: `1px solid ${s.border}`,
                borderLeft: `3px solid ${KIND_TEXT[t.kind]}`,
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 13,
                color: '#e2e8f0',
                boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
                minWidth: 260,
                maxWidth: 380,
                pointerEvents: 'all',
                cursor: 'pointer',
                animation: 'toast-in 0.2s ease',
              }}
            >
              <span style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: s.bg,
                border: `1px solid ${s.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                color: KIND_TEXT[t.kind],
                flexShrink: 0,
              }}>
                {s.icon}
              </span>
              <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
            </div>
          )
        })}
      </div>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  )
}
