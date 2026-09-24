// Small stroke icons in the same hand as the cover's nav icons (24px grid,
// 2px stroke, round caps). Size with the `size` prop; color follows
// currentColor.
import type { CSSProperties } from 'react'

type IconProps = { size?: number; style?: CSSProperties; title?: string }

function Svg({ size = 14, style, title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}
      style={{ flexShrink: 0, ...style }}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  )
}

export const CloseIcon = (p: IconProps) => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>
export const PencilIcon = (p: IconProps) => <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Svg>
export const CheckIcon = (p: IconProps) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>
export const AlertIcon = (p: IconProps) => <Svg {...p}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></Svg>
export const InfoIcon = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></Svg>
export const PlayIcon = (p: IconProps) => <Svg {...p}><path d="M7 4.5v15l12-7.5Z" fill="currentColor" /></Svg>
export const PauseIcon = (p: IconProps) => <Svg {...p}><path d="M8 5v14M16 5v14" strokeWidth="3" /></Svg>

/** Disclosure chevron: points right when closed, down when open. */
export const Chevron = ({ open, ...p }: IconProps & { open: boolean }) => (
  <Svg size={11} {...p} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .2s', ...p.style }}>
    <path d="m9 6 6 6-6 6" strokeWidth="2.5" />
  </Svg>
)
export const CopyIcon = (p: IconProps) => <Svg {...p}><rect x="9" y="9" width="12" height="12" rx="1.5" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></Svg>
export const TrashIcon = (p: IconProps) => <Svg {...p}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></Svg>
/** A quill-stroke arc that turns: the loading state. Respects reduced motion via index.css. */
export const SpinnerIcon = (p: IconProps) => (
  <Svg {...p} style={{ animation: 'spin 1s linear infinite', ...p.style }}><path d="M21 12a9 9 0 1 1-6.2-8.6" /></Svg>
)
/** Opening quotation marks: save a line as a quote. `filled` when already saved. */
export const QuoteIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p}>
    <path d="M4 17c0-5 1.5-8 5-10M13 17c0-5 1.5-8 5-10" />
    <circle cx="6.5" cy="15.5" r="2.5" fill={filled ? 'currentColor' : 'none'} />
    <circle cx="15.5" cy="15.5" r="2.5" fill={filled ? 'currentColor' : 'none'} />
  </Svg>
)
export const DownloadIcon = (p: IconProps) => <Svg {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Svg>
