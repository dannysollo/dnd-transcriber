import { useEffect, useState } from 'react'
import { useApiUrl } from './CampaignContext'

// Shown wherever something is waiting on the transcription worker (a queued
// transcript, a summary) when the worker hasn't been in touch lately, so a
// job that isn't moving doesn't just look slow.

type Status = { online: boolean; seconds_ago: number | null }

function ago(seconds: number | null): string {
  if (seconds === null) return 'has never checked in'
  if (seconds < 3600) return `last checked in ${Math.max(1, Math.round(seconds / 60))} minutes ago`
  if (seconds < 86400) return `last checked in ${Math.round(seconds / 3600)} hours ago`
  return `last checked in ${Math.round(seconds / 86400)} days ago`
}

export default function WorkerOffline({ waiting, what }: { waiting: boolean; what: string }) {
  const apiUrl = useApiUrl()
  const [status, setStatus] = useState<Status | null>(null)
  useEffect(() => {
    if (!waiting) return
    let alive = true
    const check = () => fetch(apiUrl('/worker/status'))
      .then(r => (r.ok ? r.json() : null)).then(s => { if (alive && s) setStatus(s) }).catch(() => {})
    check()
    const id = window.setInterval(check, 60000)
    return () => { alive = false; window.clearInterval(id) }
  }, [waiting, apiUrl])

  if (!waiting || !status || status.online) return null
  return (
    <p className="worker-offline" role="status">
      The transcription worker {ago(status.seconds_ago)}, so {what} won't start until it's running.
      Open the Co-DM desktop app and choose Start worker.
    </p>
  )
}
