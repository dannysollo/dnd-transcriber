// A bottom sheet for phones: the page's secondary actions, rising from the
// bottom edge within thumb reach. Tap outside or press Escape to close; focus
// moves into the sheet on open and back to the opener on close.
import { useEffect, useRef, type ReactNode } from 'react'
import { CloseIcon } from './Icons'

export default function Sheet({ open, onClose, title, children }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>('button, a, input, select')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); opener?.focus?.() }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="sheet-root">
      <div className="sheet-backdrop" onClick={onClose} aria-hidden />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <div className="sheet-head">
          <span className="sc">{title}</span>
          <button type="button" className="entry-action" onClick={onClose} aria-label="Close"><CloseIcon size={18} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

/** One row in a sheet: an action with an optional note under it. */
export function SheetItem({ onClick, children, note, active, disabled }: {
  onClick: () => void; children: ReactNode; note?: ReactNode; active?: boolean; disabled?: boolean
}) {
  return (
    <button type="button" className={'sheet-item' + (active ? ' active' : '')} onClick={onClick} disabled={disabled}>
      <span>{children}</span>
      {note && <span className="sheet-item-note">{note}</span>}
    </button>
  )
}
