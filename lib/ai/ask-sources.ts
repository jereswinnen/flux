import { formatTimestamp } from "@/lib/format"
import { groupHitsIntoSources } from "@/lib/ai/group-sources"
import type { HighlightHit, SearchHit } from "@/lib/db/search"

export type AskSourceEntry =
  | { kind: "chunk"; n: number; hit: SearchHit }
  | { kind: "highlight"; n: number; hit: HighlightHit }

/** Merge chunk hits (deduped by item+moment) and highlight hits into one numbered
 *  source list + the LLM context string. Chunk excerpts keep all their text but
 *  share their group's number; highlights are numbered after the last chunk group
 *  and labeled so the model knows their provenance. */
export function assembleAskSources(
  chunkHits: SearchHit[],
  highlightHits: HighlightHit[],
): { entries: AskSourceEntry[]; context: string } {
  const { sources: chunkSources, numberFor } = groupHitsIntoSources(chunkHits)
  const base = chunkSources.length

  const chunkCtx = chunkHits.map(
    (h) => `[${numberFor(h)}] (${h.itemTitle} — ${formatTimestamp(h.startSec)}) ${h.content}`,
  )
  const hlCtx = highlightHits.map(
    (h, i) => `[${base + 1 + i}] (Highlight — ${h.itemTitle}) ${h.text}`,
  )
  const context = [...chunkCtx, ...hlCtx].join("\n\n")

  const entries: AskSourceEntry[] = [
    ...chunkSources.map((hit, i) => ({ kind: "chunk" as const, n: i + 1, hit })),
    ...highlightHits.map((hit, i) => ({ kind: "highlight" as const, n: base + 1 + i, hit })),
  ]
  return { entries, context }
}
