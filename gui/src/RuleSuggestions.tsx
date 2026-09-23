import { useState } from 'react'
import { useToast } from './Toast'

/** A word-level substitution from a hand edit, offered as a `corrections` rule. */
export interface RuleSuggestion {
  wrong: string
  right: string
  /** `wrong` is an everyday English word — a campaign-wide replace may misfire. */
  common_word: boolean
}

export interface SessionRuleSuggestion extends RuleSuggestion {
  session: string
}

/**
 * POST a correction rule and apply it to one session's transcript right away.
 * Returns how many occurrences were replaced in that session, or null on failure.
 */
export async function addCorrectionRule(
  campaignSlug: string,
  wrong: string,
  right: string,
  session?: string,
): Promise<number | null> {
  const r = await fetch(`/campaigns/${campaignSlug}/config/corrections/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wrong, right, apply_to_session: session ?? null }),
  })
  if (!r.ok) return null
  const data = await r.json()
  return data.replaced ?? 0
}

/**
 * "Make this a rule?" prompt shown after a transcript edit. Each suggestion
 * can be added (saved to the campaign's corrections + applied to its session)
 * or dismissed. `floating` pins it to the bottom of the viewport — needed in
 * the transcript editor, where the edited line can be thousands of lines
 * below the top of the list.
 */
export function RuleSuggestionBar({
  campaignSlug,
  suggestions,
  onDismiss,
  onApplied,
  floating = false,
}: {
  campaignSlug: string
  suggestions: SessionRuleSuggestion[]
  onDismiss: (s: SessionRuleSuggestion) => void
  onApplied?: (s: SessionRuleSuggestion, replaced: number) => void
  floating?: boolean
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  if (suggestions.length === 0) return null

  const add = async (s: SessionRuleSuggestion) => {
    const key = `${s.session}|${s.wrong}`
    setBusy(key)
    try {
      const replaced = await addCorrectionRule(campaignSlug, s.wrong, s.right, s.session)
      if (replaced === null) {
        toast('Failed to add rule', 'error')
        return
      }
      toast(
        `Rule added: ${s.wrong} → ${s.right}` +
          (replaced > 0 ? ` (${replaced} more fixed in this session)` : ''),
        'success',
      )
      onDismiss(s)
      onApplied?.(s, replaced)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: '8px',
        padding: '10px 12px',
        marginBottom: '12px',
        ...(floating && {
          position: 'fixed',
          left: '50%',
          transform: 'translateX(-50%)',
          // Above the session page's sticky mini audio player
          bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
          width: 'min(560px, calc(100vw - 32px))',
          marginBottom: 0,
          zIndex: 60,
          boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
        }),
      }}
    >
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
        {suggestions.length === 1
          ? 'Save this fix as a correction rule so future transcripts get it automatically?'
          : 'Save these fixes as correction rules so future transcripts get them automatically?'}
      </div>
      {suggestions.map(s => {
        const key = `${s.session}|${s.wrong}`
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
              <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{s.wrong}</span>
              {' → '}
              <strong>{s.right}</strong>
            </span>
            {s.common_word && (
              <span style={{ fontSize: '11px', color: 'var(--warning)' }}>
                “{s.wrong}” is an ordinary word; the rule replaces it everywhere
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button
              className="btn-ghost"
              onClick={() => add(s)}
              disabled={busy === key}
              style={{ fontSize: '12px', padding: '3px 10px' }}
            >
              {busy === key ? 'Adding…' : 'Add rule'}
            </button>
            <button
              className="btn-ghost"
              onClick={() => onDismiss(s)}
              aria-label={`Dismiss ${s.wrong} → ${s.right}`}
              style={{ fontSize: '12px', padding: '3px 8px' }}
            >
              Dismiss
            </button>
          </div>
        )
      })}
    </div>
  )
}
