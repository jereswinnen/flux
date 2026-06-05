export function formatTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = m.toString().padStart(2, "0")
  const ss = s.toString().padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

export function formatDate(iso?: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString()
}

export function formatRelativeDate(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return ""
  const d = new Date(iso)
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return d.toLocaleDateString()
}
