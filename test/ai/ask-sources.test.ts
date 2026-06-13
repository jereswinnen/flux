import { describe, expect, it } from "vitest"
import { assembleAskSources } from "@/lib/ai/ask-sources"
import type { HighlightHit, SearchHit } from "@/lib/db/search"

const chunk = (over: Partial<SearchHit>): SearchHit => ({
  chunkId: "c", itemId: "i", itemTitle: "Ep", podcastName: null, artworkUrl: null,
  audioUrl: null, videoId: null, content: "body", startSec: 0, endSec: 0, similarity: 1, ...over,
})
const hl = (over: Partial<HighlightHit>): HighlightHit => ({
  highlightId: "h", itemId: "i", itemTitle: "Ep", podcastName: null, artworkUrl: null,
  audioUrl: null, videoId: null, text: "snippet", startSec: 0, similarity: 1, ...over,
})

describe("assembleAskSources", () => {
  it("numbers chunk sources first, then highlights; flags entries", () => {
    const { entries, context } = assembleAskSources(
      [chunk({ chunkId: "c1", itemId: "a", itemTitle: "A", startSec: 10, content: "alpha" })],
      [hl({ highlightId: "h1", itemId: "b", itemTitle: "B", text: "gamma" })],
    )
    expect(entries.map((e) => [e.kind, e.n])).toEqual([
      ["chunk", 1],
      ["highlight", 2],
    ])
    expect(context).toContain("[1] (A — 0:10) alpha")
    expect(context).toContain("[2] (Highlight — B) gamma")
  })
  it("keeps every chunk excerpt but dedupes sources by item+second", () => {
    const { entries, context } = assembleAskSources(
      [
        chunk({ chunkId: "c1", itemId: "a", startSec: 0, content: "one" }),
        chunk({ chunkId: "c2", itemId: "a", startSec: 0, content: "two" }),
      ],
      [],
    )
    expect(entries).toHaveLength(1)
    expect(context).toContain("[1] (Ep — 0:00) one")
    expect(context).toContain("[1] (Ep — 0:00) two")
  })
})
