import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCampaign } from '../CampaignContext'

interface PendingEdit {
  id: number
  session_name: string
  line_number: number
  original_text: string
  proposed_text: string
  status: string
  submitted_at: string
  submitter_username: string | null
  submitter_id: number
}

export default function EditQueuePage() {
  const { activeCampaign } = useCampaign()
  const navigate = useNavigate()
  const [edits, setEdits] = useState<PendingEdit[]>([])
  const [loading, setLoading] = useState(true)
  const [rejectNotes, setRejectNotes] = useState<Record<number, string>>({})
  const [processing, setProcessing] = useState<Record<number, boolean>>({})

  const slug = activeCampaign?.slug

  // Redirect non-DMs
  useEffect(() => {
    if (!activeCampaign) return
    if (activeCampaign.role !== 'dm') {
      navigate('/')
    }
  }, [activeCampaign])

  const load = async () => {
    if (!slug) return
    setLoading(true)
    try {
      const r = await fetch(`/campaigns/${slug}/edits`)
      if (r.ok) setEdits(await r.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (slug) load() }, [slug])

  const approve = async (editId: number) => {
    setProcessing(prev => ({ ...prev, [editId]: true }))
    try {
      const r = await fetch(`/campaigns/${slug}/edits/${editId}/approve`, { method: 'POST' })
      if (r.ok) setEdits(prev => prev.filter(e => e.id !== editId))
      else alert('Failed to approve edit')
    } finally {
      setProcessing(prev => ({ ...prev, [editId]: false }))
    }
  }

  const reject = async (editId: number) => {
    setProcessing(prev => ({ ...prev, [editId]: true }))
    try {
      const note = rejectNotes[editId] || undefined
      const r = await fetch(`/campaigns/${slug}/edits/${editId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note ?? null }),
      })
      if (r.ok) setEdits(prev => prev.filter(e => e.id !== editId))
      else alert('Failed to reject edit')
    } finally {
      setProcessing(prev => ({ ...prev, [editId]: false }))
    }
  }

  // Group edits by session
  const grouped: Record<string, PendingEdit[]> = {}
  for (const e of edits) {
    if (!grouped[e.session_name]) grouped[e.session_name] = []
    grouped[e.session_name].push(e)
  }

  if (!activeCampaign) {
    return <div style={{ padding: '32px', color: '#64748b' }}>No active campaign selected.</div>
  }

  return (
    <div style={{ padding: '32px', maxWidth: '900px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#e2e8f0' }}>
          Edit Queue
          {edits.length > 0 && (
            <span style={{
              marginLeft: '10px', fontSize: '13px', fontWeight: 700,
              background: 'rgba(251,191,36,0.15)', color: '#fbbf24',
              border: '1px solid rgba(251,191,36,0.3)',
              borderRadius: '20px', padding: '2px 10px',
            }}>
              {edits.length} pending
            </span>
          )}
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          Review and approve transcript edits submitted by players
        </p>
      </div>

      {loading ? (
        <div style={{ color: '#64748b', fontSize: '14px' }}>Loading...</div>
      ) : edits.length === 0 ? (
        <div style={{
          background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: '12px',
          padding: '48px', textAlign: 'center', color: '#64748b', fontSize: '14px',
        }}>
          No pending edits. All caught up!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {Object.entries(grouped).map(([sessionName, sessionEdits]) => (
            <div key={sessionName}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#94a3b8', marginBottom: '10px' }}>
                Session: {sessionName}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {sessionEdits.map(edit => (
                  <div
                    key={edit.id}
                    style={{
                      background: '#1a1d27', border: '1px solid #2a2d3a',
                      borderRadius: '10px', padding: '16px', display: 'flex',
                      flexDirection: 'column', gap: '10px',
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '11px', color: '#475569' }}>
                        {edit.line_number === -2 ? '📋 Summary edit' : edit.line_number === -3 ? '📖 Wiki edit' : `Line ${edit.line_number}`}
                      </span>
                      <span style={{ fontSize: '11px', color: '#475569' }}>·</span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        by <strong style={{ color: '#94a3b8' }}>{edit.submitter_username ?? 'unknown'}</strong>
                      </span>
                      <span style={{ fontSize: '11px', color: '#475569' }}>·</span>
                      <span style={{ fontSize: '11px', color: '#475569' }}>
                        {new Date(edit.submitted_at).toLocaleString()}
                      </span>
                    </div>

                    {/* Diff */}
                    <div style={{
                      background: '#0d0f18', borderRadius: '6px', padding: '10px 14px',
                      fontFamily: 'monospace', fontSize: '12px', display: 'flex',
                      flexDirection: 'column', gap: '4px',
                    }}>
                      <div style={{ color: '#f87171' }}>— {edit.original_text}</div>
                      <div style={{ color: '#4ade80' }}>+ {edit.proposed_text}</div>
                    </div>

                    {/* Reject note input */}
                    <input
                      type="text"
                      value={rejectNotes[edit.id] ?? ''}
                      onChange={e => setRejectNotes(prev => ({ ...prev, [edit.id]: e.target.value }))}
                      placeholder="Rejection note (optional)"
                      style={{
                        background: '#13151f', border: '1px solid #2a2d3a', borderRadius: '6px',
                        color: '#94a3b8', padding: '6px 10px', fontSize: '12px', outline: 'none',
                      }}
                    />

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => approve(edit.id)}
                        disabled={processing[edit.id]}
                        style={{
                          background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)',
                          borderRadius: '6px', color: '#4ade80', padding: '6px 16px',
                          fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                          opacity: processing[edit.id] ? 0.5 : 1,
                        }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => reject(edit.id)}
                        disabled={processing[edit.id]}
                        style={{
                          background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)',
                          borderRadius: '6px', color: '#f87171', padding: '6px 16px',
                          fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                          opacity: processing[edit.id] ? 0.5 : 1,
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
