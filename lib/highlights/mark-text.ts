export type MarkSegment = { text: string; id?: string }

/** Split `text` into segments, wrapping the first non-overlapping occurrence of
 *  each mark's snapshot. Earlier marks win on overlap; unmatched marks are skipped.
 *  Pure — the React layer maps segments with an `id` to <mark>. */
export function splitForMarks(
  text: string,
  marks: { id: string; text: string }[],
): MarkSegment[] {
  const ranges: { start: number; end: number; id: string }[] = []
  for (const m of marks) {
    const needle = m.text.trim()
    if (!needle) continue
    const start = text.indexOf(needle)
    if (start < 0) continue
    const end = start + needle.length
    if (ranges.some((r) => start < r.end && end > r.start)) continue // overlap → skip
    ranges.push({ start, end, id: m.id })
  }
  ranges.sort((a, b) => a.start - b.start)

  const out: MarkSegment[] = []
  let pos = 0
  for (const r of ranges) {
    if (r.start > pos) out.push({ text: text.slice(pos, r.start) })
    out.push({ text: text.slice(r.start, r.end), id: r.id })
    pos = r.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos) })
  if (out.length === 0) out.push({ text })
  return out
}
