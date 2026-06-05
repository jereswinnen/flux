export function parseItunesDuration(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const parts = trimmed.split(":").map(Number)
  if (parts.some((n) => Number.isNaN(n))) return undefined
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}
