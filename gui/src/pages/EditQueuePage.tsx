import { useToast } from '../Toast'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCampaign } from '../CampaignContext'
import { RuleSuggestionBar, type RuleSuggestion, type SessionRuleSuggestion } from '../RuleSuggestions'

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

// Word-level LCS diff
interface Token { type: 'equal' | 'remove' | 'add'; text: string }

function tokenize(s: string): string[] {
  // Split on word boundaries keeping whitespace as tokens
  return s.match(/\S+|\s+/g) ?? []
}

function lcsWordDiff(origWords: string[], propWords: string[]): Token[] {
  const m = origWords.length, n = propWords.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = origWords[i] === propWords[j] ? 1 + dp[i+1][j+1] : Math.max(dp[i+1][j], dp[i][j+1])

  const result: Token[] = []
  let i = 0, j = 0
  while (i < m || j < n) {
    if (i < m && j < n && origWords[i] === propWords[j]) {
      result.push({ type: 'equal', text: origWords[i] }); i++; j++
    } else if (j < n && (i >= m || dp[i][j+1] >= dp[i+1][j])) {
      result.push({ type: 'add', text: propWords[j] }); j++
    } else {
      result.push({ type: 'remove', text: origWords[i] }); i++
    }
  }
  return result
}

// For multi-line: line-level diff, then word-level within changed lines
interface DiffLine { type: 'equal' | 'remove' | 'add' | 'separator'; tokens?: Token[]; text?: string; skipped?: number }

function computeLineDiff(original: string, proposed: string): DiffLine[] {
  const oLines = original.split('\n'), pLines = proposed.split('\n')
  const m = oLines.length, n = pLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = oLines[i] === pLines[j] ? 1 + dp[i+1][j+1] : Math.max(dp[i+1][j], dp[i][j+1])

  const result: DiffLine[] = []
  let i = 0, j = 0
  while (i < m || j < n) {
    if (i < m && j < n && oLines[i] === pLines[j]) {
      result.push({ type: 'equal', text: oLines[i] }); i++; j++
    } else if (j < n && (i >= m || dp[i][j+1] >= dp[i+1][j])) {
      result.push({ type: 'add', tokens: lcsWordDiff([], tokenize(pLines[j])) }); j++
    } else {
      // If next prop line differs, do word diff between this pair
      if (j < n && dp[i+1][j] === dp[i][j+1]) {
        const tokens = lcsWordDiff(tokenize(oLines[i]), tokenize(pLines[j]))
        result.push({ type: 'remove', tokens })
        result.push({ type: 'add', tokens: tokens.map(t => t.type === 'remove' ? { ...t, type: 'add' as const } : t.type === 'add' ? { ...t, type: 'remove' as const } : t) })
        i++; j++
      } else {
        result.push({ type: 'remove', tokens: lcsWordDiff(tokenize(oLines[i]), []) }); i++
      }
    }
  }
  return result
}

function collapseLineDiff(lines: DiffLine[], context = 1): DiffLine[] {
  const changed = lines.map(l => l.type !== 'equal')
  const visible = new Set<number>()
  lines.forEach((_, idx) => {
    if (changed[idx])
      for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++)
        visible.add(k)
  })
  const result: DiffLine[] = []
  let prev = -1
  for (const idx of Array.from(visible).sort((a, b) => a - b)) {
    if (prev !== -1 && idx > prev + 1) result.push({ type: 'separator', skipped: idx - prev - 1 })
    result.push(lines[idx])
    prev = idx
  }
  return result
}

function renderTokens(tokens: Token[], lineType: 'add' | 'remove') {
  return tokens.map((t, i) => {
    if (t.type === 'equal') return <span key={i}>{t.text}</span>
    const isHighlight = t.type === lineType
    return (
      <span key={i} style={{
        background: isHighlight
          ? (lineType === 'add' ? 'color-mix(in srgb, var(--moss) 30%, transparent)' : 'color-mix(in srgb, var(--rubric) 30%, transparent)')
          : 'transparent',
        borderRadius: '2px',
        textDecoration: isHighlight ? undefined : 'none',
        opacity: isHighlight ? 1 : 0.35,
      }}>{t.text}</span>
    )
  })
}

function DiffView({ original, proposed }: { original: string; proposed: string }) {
  const isOneLiner = !original.includes('\n') && !proposed.includes('\n')

  if (isOneLiner) {
    // Single-line: word diff inline
    const tokens = lcsWordDiff(tokenize(original), tokenize(proposed))
    const hasChange = tokens.some(t => t.type !== 'equal')
    if (!hasChange) return <div style={{ fontSize: '14px', color: 'var(--ink-faint)', fontStyle: 'italic' }}>No changes.</div>
    return (
      <div style={{ background: 'var(--page-sunk)', borderRadius: '3px', padding: '10px 14px', fontFamily: 'monospace', fontSize: '15px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ color: 'var(--rubric)' }}>
          <span style={{ marginRight: '8px', opacity: 0.5 }}>−</span>
          {tokens.map((t, i) => (
            <span key={i} style={{ background: t.type === 'remove' ? 'color-mix(in srgb, var(--rubric) 30%, transparent)' : 'transparent', borderRadius: '2px', opacity: t.type === 'add' ? 0.3 : 1 }}>{t.text}</span>
          ))}
        </div>
        <div style={{ color: 'var(--moss)' }}>
          <span style={{ marginRight: '8px', opacity: 0.5 }}>+</span>
          {tokens.map((t, i) => (
            <span key={i} style={{ background: t.type === 'add' ? 'color-mix(in srgb, var(--moss) 30%, transparent)' : 'transparent', borderRadius: '2px', opacity: t.type === 'remove' ? 0.3 : 1 }}>{t.text}</span>
          ))}
        </div>
      </div>
    )
  }

  const fullDiff = computeLineDiff(original, proposed)
  const hasChanges = fullDiff.some(l => l.type !== 'equal')
  if (!hasChanges) return <div style={{ fontSize: '14px', color: 'var(--ink-faint)', fontStyle: 'italic' }}>No changes detected.</div>
  const diff = collapseLineDiff(fullDiff)

  return (
    <div style={{ background: 'var(--page-sunk)', borderRadius: '3px', fontFamily: 'monospace', fontSize: '15px', overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
      {diff.map((line, i) => {
        if (line.type === 'separator') return (
          <div key={i} style={{ padding: '2px 12px', color: 'var(--rule-strong)', background: 'color-mix(in srgb, var(--ink) 2%, transparent)', fontStyle: 'italic' }}>
            … {line.skipped} unchanged {line.skipped === 1 ? 'line' : 'lines'} …
          </div>
        )
        if (line.type === 'equal') return (
          <div key={i} style={{ padding: '2px 12px', color: 'var(--ink-faint)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
            <span style={{ marginRight: '10px', opacity: 0.4 }}> </span>{line.text}
          </div>
        )
        const tokens = line.tokens ?? []
        const bg = line.type === 'add' ? 'color-mix(in srgb, var(--moss) 6%, transparent)' : 'color-mix(in srgb, var(--rubric) 6%, transparent)'
        const prefix = line.type === 'add' ? '+' : '−'
        const prefixColor = line.type === 'add' ? 'var(--moss)' : 'var(--rubric)'
        return (
          <div key={i} style={{ padding: '2px 12px', background: bg, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
            <span style={{ marginRight: '10px', color: prefixColor, opacity: 0.7, userSelect: 'none' }}>{prefix}</span>
            <span style={{ color: line.type === 'add' ? 'var(--moss)' : 'var(--rubric)' }}>
              {renderTokens(tokens, line.type as 'add' | 'remove')}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function EditQueuePage() {
  const { activeCampaign } = useCampaign()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [edits, setEdits] = useState<PendingEdit[]>([])
  const [loading, setLoading] = useState(true)
  const [rejectNotes, setRejectNotes] = useState<Record<number, string>>({})
  const [processing, setProcessing] = useState<Record<number, boolean>>({})
  const [ruleSuggestions, setRuleSuggestions] = useState<SessionRuleSuggestion[]>([])

  /** Queue rule suggestions from an approve response, de-duplicated per session+word. */
  const collectSuggestions = async (r: Response, session: string) => {
    if (!r.ok) return
    const data = await r.json().catch(() => null)
    const fresh: SessionRuleSuggestion[] = (data?.rule_suggestions ?? []).map((x: RuleSuggestion) => ({ ...x, session }))
    if (!fresh.length) return
    setRuleSuggestions(prev => [
      ...prev.filter(p => !fresh.some(f => f.session === p.session && f.wrong.toLowerCase() === p.wrong.toLowerCase())),
      ...fresh,
    ])
  }

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

  const approveAll = async () => {
    const ids = edits.map(e => e.id)
    setProcessing(Object.fromEntries(ids.map(id => [id, true])))
    try {
      const sessionOf = Object.fromEntries(edits.map(e => [e.id, e.session_name]))
      await Promise.all(ids.map(async id => {
        const r = await fetch(`/campaigns/${slug}/edits/${id}/approve`, { method: 'POST' })
        await collectSuggestions(r, sessionOf[id])
      }))
      setEdits([])
      toast(`Approved ${ids.length} edit${ids.length !== 1 ? 's' : ''}`, 'success')
    } catch {
      toast('Some approvals failed', 'error')
      load()
    } finally {
      setProcessing({})
    }
  }

  const approve = async (editId: number) => {
    setProcessing(prev => ({ ...prev, [editId]: true }))
    try {
      const r = await fetch(`/campaigns/${slug}/edits/${editId}/approve`, { method: 'POST' })
      const session = edits.find(e => e.id === editId)?.session_name
      if (session) await collectSuggestions(r, session)
      if (r.ok) setEdits(prev => prev.filter(e => e.id !== editId))
      else toast('Failed to approve edit', 'error')
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
      else toast('Failed to reject edit', 'error')
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
    return <div style={{ padding: '32px', color: 'var(--ink-faint)' }}>No active campaign selected.</div>
  }

  const editTypeLabel = (e: PendingEdit) => {
    if (e.edit_type === 'summary' || e.line_number === -2) return 'Summary'
    if (e.edit_type === 'wiki' || e.line_number === -3) return 'Wiki'
    return `Line ${e.line_number}`
  }

  return (
    <div className="page-content" style={{ padding: '32px', maxWidth: '900px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '34px', fontWeight: 500, color: 'var(--ink)' }}>
          Edit Queue
          {edits.length > 0 && (
            <span style={{
              marginLeft: '10px', fontSize: '16px', fontWeight: 700,
              background: 'color-mix(in srgb, var(--ochre) 15%, transparent)', color: 'var(--ochre)',
              border: '1px solid color-mix(in srgb, var(--ochre) 30%, transparent)',
              borderRadius: '20px', padding: '2px 10px',
            }}>
              {edits.length} pending
            </span>
          )}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
          <p style={{ margin: 0, fontSize: '16px', color: 'var(--ink-faint)' }}>
            Review and approve edits submitted by players
          </p>
          {edits.length > 0 && (
            <button
              onClick={approveAll}
              disabled={Object.values(processing).some(Boolean)}
              style={{
                background: 'color-mix(in srgb, var(--moss) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--moss) 30%, transparent)',
                borderRadius: '3px', color: 'var(--moss)',
                padding: '6px 14px', fontSize: '15px', fontWeight: 700,
                cursor: 'pointer', marginLeft: 'auto',
                opacity: Object.values(processing).some(Boolean) ? 0.5 : 1,
              }}
            >
              Approve All ({edits.length})
            </button>
          )}
        </div>
      </div>

      {slug && (
        <RuleSuggestionBar
          campaignSlug={slug}
          suggestions={ruleSuggestions}
          onDismiss={s => setRuleSuggestions(prev => prev.filter(p => p !== s))}
        />
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-faint)', fontSize: '17px' }}>Loading...</div>
      ) : edits.length === 0 ? (
        <div style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '3px',
          padding: '48px', textAlign: 'center', color: 'var(--ink-faint)', fontSize: '17px',
        }}>
          No pending edits. All caught up!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {Object.entries(grouped).map(([sessionName, sessionEdits]) => (
            <div key={sessionName}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink-soft)', marginBottom: '10px' }}>
                Session: {sessionName}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {sessionEdits.map(edit => (
                  <div
                    key={edit.id}
                    style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                      borderRadius: '3px', padding: '16px',
                      display: 'flex', flexDirection: 'column', gap: '12px',
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: '14px', fontWeight: 700, color: 'var(--accent-text)',
                        background: 'color-mix(in srgb, var(--rubric) 10%, transparent)', borderRadius: '3px', padding: '2px 8px',
                      }}>
                        {editTypeLabel(edit)}
                      </span>
                      <span style={{ fontSize: '14px', color: 'var(--ink-faint)' }}>
                        by <strong style={{ color: 'var(--ink-soft)' }}>{edit.submitter_username ?? 'unknown'}</strong>
                      </span>
                      <span style={{ fontSize: '14px', color: 'var(--ink-faint)' }}>
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
                        background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '3px',
                        color: 'var(--ink-soft)', padding: '6px 10px', fontSize: '15px', outline: 'none',
                      }}
                    />

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => approve(edit.id)}
                        disabled={processing[edit.id]}
                        style={{
                          background: 'color-mix(in srgb, var(--moss) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--moss) 30%, transparent)',
                          borderRadius: '3px', color: 'var(--moss)', padding: '6px 16px',
                          fontSize: '15px', fontWeight: 700, cursor: 'pointer',
                          opacity: processing[edit.id] ? 0.5 : 1,
                        }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => reject(edit.id)}
                        disabled={processing[edit.id]}
                        style={{
                          background: 'color-mix(in srgb, var(--rubric) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--rubric) 30%, transparent)',
                          borderRadius: '3px', color: 'var(--rubric)', padding: '6px 16px',
                          fontSize: '15px', fontWeight: 700, cursor: 'pointer',
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
