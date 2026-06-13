import type { SearchHit } from "@/lib/db/search"

/** Collapse retrieved chunks that point at the same moment — same item + same
 *  whole-second — into a single cited source. An article's chunks all sit at
 *  startSec 0, so they become one source; media keeps its distinct moments.
 *  Returns the deduped hits (first of each group, in first-seen order) plus a
 *  `numberFor` that maps any original hit to its 1-based source number, so the
 *  LLM context can keep every chunk's text while citations/cards stay unique. */
export function groupHitsIntoSources(hits: SearchHit[]): {
  sources: SearchHit[]
  numberFor: (hit: SearchHit) => number
} {
  const key = (h: SearchHit) => `${h.itemId}:${Math.floor(h.startSec)}`
  const order: string[] = []
  const first = new Map<string, SearchHit>()
  for (const h of hits) {
    const k = key(h)
    if (!first.has(k)) {
      first.set(k, h)
      order.push(k)
    }
  }
  const num = new Map(order.map((k, i) => [k, i + 1]))
  return {
    sources: order.map((k) => first.get(k)!),
    numberFor: (h) => num.get(key(h)) ?? 1,
  }
}
