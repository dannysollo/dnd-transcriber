// Number formatting for the stats charts (kept out of Charts.tsx so it only exports components).

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export const percent = (share: number) => `${Math.round(share * 100)}%`
