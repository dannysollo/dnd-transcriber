import { useEffect, useState } from 'react'

// A page left open for days (the desktop app's window, a pinned tab) keeps
// running the code it loaded, so fixes deployed since never show. This checks
// the site's page for a newer build (its script's name changes with every
// deploy) every 15 minutes and when the window comes back into focus, and
// offers a reload.

const CHECK_EVERY = 15 * 60 * 1000
const SCRIPT_RE = /\/assets\/index-[\w-]+\.js/

function currentBuild(): string | null {
  const el = [...document.querySelectorAll<HTMLScriptElement>('script[src]')].find(s => SCRIPT_RE.test(s.src))
  return el ? el.src.match(SCRIPT_RE)![0] : null
}

export default function UpdateNotice() {
  const [newer, setNewer] = useState(false)
  useEffect(() => {
    const mine = currentBuild()
    if (!mine) return  // the dev server: no built bundle to compare
    let last = 0
    const check = async () => {
      if (Date.now() - last < 60 * 1000) return
      last = Date.now()
      try {
        const html = await fetch('/', { cache: 'no-store', headers: { Accept: 'text/html' } }).then(r => r.text())
        const live = html.match(SCRIPT_RE)?.[0]
        if (live && live !== mine) setNewer(true)
      } catch { /* offline: try again later */ }
    }
    const onFocus = () => { if (document.visibilityState === 'visible') check() }
    const t = window.setInterval(check, CHECK_EVERY)
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus) }
  }, [])
  if (!newer) return null
  return (
    <div className="update-notice" role="status">
      <span>Co-DM has been updated.</span>
      <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
      <button type="button" className="btn-ghost" onClick={() => setNewer(false)}>Later</button>
    </div>
  )
}
