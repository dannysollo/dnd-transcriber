import { useEffect, useState } from 'react'

// Worker controls for the Co-DM desktop app. The app exposes its js_api
// (desktop/app.py Api) to every page its window loads, this site included,
// so window.pywebview.api is only present when running inside the app.

type WorkerState = { running: boolean; busy: 'starting' | 'stopping' | null; error: string | null; configured: boolean }
type DesktopApi = {
  worker_state: () => Promise<WorkerState>
  start_worker: () => Promise<{ ok: boolean; error?: string }>
  stop_worker: () => Promise<{ ok: boolean }>
  open_dashboard: () => Promise<{ ok: boolean }>
}

function desktopApi(): DesktopApi | null {
  const api = (window as unknown as { pywebview?: { api?: Partial<DesktopApi> } }).pywebview?.api
  // Older app builds expose the api without the worker methods.
  return api && typeof api.worker_state === 'function' ? (api as DesktopApi) : null
}

export default function DesktopWorker() {
  const [api, setApi] = useState<DesktopApi | null>(desktopApi)
  const [state, setState] = useState<WorkerState | null>(null)

  // pywebview injects its api after the page loads.
  useEffect(() => {
    if (api) return
    const onReady = () => setApi(desktopApi())
    window.addEventListener('pywebviewready', onReady)
    return () => window.removeEventListener('pywebviewready', onReady)
  }, [api])

  useEffect(() => {
    if (!api) return
    let alive = true
    const poll = () => api.worker_state().then(s => { if (alive) setState(s) }).catch(() => {})
    poll()
    // Poll faster while a start or stop is under way.
    const id = window.setInterval(poll, state?.busy ? 1500 : 5000)
    return () => { alive = false; window.clearInterval(id) }
  }, [api, state?.busy])

  if (!api || !state) return null

  const act = (fn: () => Promise<unknown>) => {
    // Show the change right away; the next poll confirms it.
    fn().finally(() => api.worker_state().then(setState).catch(() => {}))
  }

  const label = state.busy === 'starting' ? 'Worker starting…'
    : state.busy === 'stopping' ? 'Worker stopping…'
    : state.running ? 'Worker running'
    : 'Worker stopped'

  return (
    <div className="desktop-worker">
      <div className="desktop-worker-status" role="status">
        <span className={'desktop-worker-dot' + (state.running && !state.busy ? ' on' : '')} aria-hidden="true" />
        <span style={{ flex: 1 }}>{label}</span>
        {state.running && !state.busy && (
          <button type="button" className="desktop-worker-link" onClick={() => act(api.open_dashboard)}>Dashboard</button>
        )}
      </div>
      {!state.busy && state.configured && (
        state.running
          ? <button type="button" className="desktop-worker-btn quiet" onClick={() => act(api.stop_worker)}>Stop worker</button>
          : <button type="button" className="desktop-worker-btn" onClick={() => act(api.start_worker)}>Start worker</button>
      )}
      {!state.configured && <p className="desktop-worker-note">Set up the worker from the tray menu first.</p>}
      {state.error && !state.busy && <p className="desktop-worker-note">Couldn't start: {state.error}</p>}
    </div>
  )
}
