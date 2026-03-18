import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCampaign } from '../CampaignContext'

interface PendingEdit {
  id: number
  session_name: string
  line_number: number
  edit_type: 'transcript' | 'summary' | 'wiki'
  original_text: string
  proposed_text: string
  status: string
  submitted_at: string
  submitter_username: string | null
  submitter_id: number
}

// Compute line-level diff between two strings
interface DiffLine {
  type: 'equal' | 'remove' | 'add'
  text: string
}

function computeDiff(original: string, proposed: string): DiffLine[] {
  const origLines = original.split('\n')
  const propLines = proposed.split('\n')

  // Simple LCS-based diff
  const m = origLines.length
  const n = propLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (origLines[i] === propLines[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1]
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  const result: DiffLine[] = []
  let i = 0, j = 0
  while (i < m || j < n) {
    if (i < m && j < n && origLines[i] === propLines[j]) {
      result.push({ type: 'equal', text: origLines[i] })
      i++; j++
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: 'add', text: propLines[j] })
      j++
    } else {
      result.push({ type: 'remove', text: origLines[i] })
      i++
    }
  }
  return result
}

// Collapse unchanged runs, showing only context around changes
function collapseDiff(lines: DiffLine[], context = 2): DiffLine[] {
  const changed = lines.map(l => l.type !== 'equal')
  const visible = new Set<number>()
  lines.forEach((_, idx) => {
    if (changed[idx]) {
      for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) {
        visible.add(k)
      }
    }
  })

  const result: DiffLine[] = []
  let prev = -1
  for (const idx of Array.from(visible).sort((a, b) => a - b)) {
    if (prev !== -1 && idx > prev + 1) {
      result.push({ type: 'equal', text: `… ${idx - prev - 1} unchanged lines …` })
    }
    result.push(lines[idx])
    prev = idx
  }
  return result
}

function DiffView({ original, proposed }: { original: string; proposed: string }) {
  const isOneLiner = !original.includes('\n') && !proposed.includes('\n')

  if (isOneLiner) {
    return (
      <div style={{
        background: '#0d0f18', borderRadius: '6px', padding: '10px 14px',
        fontFamily: 'monospace', fontSize: '12px', display: 'flex',
        flexDirection: 'column', gap: '4px',
      }}>
        <div style={{ color: '#f87171' }}>− {original}</div>
        <div style={{ color: '#4ade80' }}>+ {proposed}</div>
      </div>
    )
  }

  const fullDiff = computeDiff(original, proposed)
  const hasChanges = fullDiff.some(l => l.type !== 'equal')
  if (!hasChanges) {
    return <div style={{ fontSize: '11px', color: '#475569', fontStyle: 'italic' }}>No changes detected.</div>
  }
  const diff = collapseDiff(fullDiff)

  return (
    <div style={{
      background: '#0d0f18', borderRadius: '6px',
      fontFamily: 'monospace', fontSize: '12px', overflow: 'hidden',
      border: '1px solid #1e2130',
    }}>
      {diff.map((line, i) => {
        const isCollapsed = line.type === 'equal' && line.text.startsWith('…')
        const bg =
          line.type === 'add' ? 'rgba(74,222,128,0.08)' :
          line.type === 'remove' ? 'rgba(248,113,113,0.08)' :
          isCollapsed ? 'rgba(255,255,255,0.02)' : 'transparent'
        const color =
          line.type === 'add' ? '#4ade80' :
          line.type === 'remove' ? '#f87171' :
          isCollapsed ? '#334155' : '#64748b'
        const prefix =
          line.type === 'add' ? '+' :
          line.type === 'remove' ? '−' :
          isCollapsed ? ' ' : ' '

        return (
          <div
            key={i}
            style={{
              padding: '2px 12px', background: bg, color,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              lineHeight: 1.5,
            }}
          >
            <span style={{ marginRight: '10px', opacity: 0.6, userSelect: 'none' }}>{prefix}</span>
            {line.text}
          </div>
        )
      })}
    </div>
  )
}

export default function EditQueuePage() {
  const { activeCampaign } = useCampaign()
  const navigate = useNavigate()
  const [edits, setEdits] = useState<PendingEdit[]>([])
  const [loading, setLoading] = useState(true)
  const [rejectNotes, setRejectNotes] = useState<Record<number, string>>({})
  const [processing, setProcessing] = useState<Record<number, boolean>>({})

  const slug = activeCampaign?.slug

  useEffect(() => {
    if (!activeCampaign) return
    if (activeCampaign.role !== 'dm') navigate('/')
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

  const grouped: Record<string, PendingEdit[]> = {}
  for (const e of edits) {
    if (!grouped[e.session_name]) grouped[e.session_name] = []
    grouped[e.session_name].push(e)
  }

  if (!activeCampaign) {
    return <div style={{ padding: '32px', color: '#64748b' }}>No active campaign selected.</div>
  }

  const editTypeLabel = (e: PendingEdit) => {
    if (e.edit_type === 'summary' || e.line_number === -2) return '📋 Summary'
    if (e.edit_type === 'wiki' || e.line_number === -3) return '📖 Wiki'
    return `📝 Line ${e.line_number}`
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
          Review and approve edits submitted by players
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
                      borderRadius: '10px', padding: '16px',
                      display: 'flex', flexDirection: 'column', gap: '12px',
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: '11px', fontWeight: 700, color: '#a89cff',
                        background: 'rgba(124,108,252,0.1)', borderRadius: '5px', padding: '2px 8px',
                      }}>
                        {editTypeLabel(edit)}
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        by <strong style={{ color: '#94a3b8' }}>{edit.submitter_username ?? 'unknown'}</strong>
                      </span>
                      <span style={{ fontSize: '11px', color: '#475569' }}>
                        {new Date(edit.submitted_at).toLocaleString()}
                      </span>
                    </div>

                    {/* Diff */}
                    <DiffView original={edit.original_text} proposed={edit.proposed_text} />

                    {/* Reject note */}
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
                        ✓ Approve
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
                        ✕ Reject
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
