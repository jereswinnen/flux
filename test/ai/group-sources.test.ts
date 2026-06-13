import { describe, expect, it } from "vitest"
import { groupHitsIntoSources } from "@/lib/ai/group-sources"
import type { SearchHit } from "@/lib/db/search"

const hit = (over: Partial<SearchHit>): SearchHit => ({
  chunkId: "c", itemId: "i", itemTitle: "T", podcastName: null, artworkUrl: null,
  audioUrl: null, videoId: null, content: "x", startSec: 0, endSec: 0, similarity: 1,
  ...over,
})

describe("groupHitsIntoSources", () => {
  it("collapses same item+second (article chunks at 0) into one source", () => {
    const hits = [
      hit({ chunkId: "a1", itemId: "art", content: "one" }),
      hit({ chunkId: "a2", itemId: "art", content: "two" }),
      hit({ chunkId: "a3", itemId: "art", content: "three" }),
    ]
    const { sources, numberFor } = groupHitsIntoSources(hits)
    expect(sources).toHaveLength(1)
    expect(sources[0].chunkId).toBe("a1")
    expect(hits.map(numberFor)).toEqual([1, 1, 1])
  })
  it("keeps distinct moments (media) as separate sources", () => {
    const hits = [
      hit({ chunkId: "m1", itemId: "ep", startSec: 10 }),
      hit({ chunkId: "m2", itemId: "ep", startSec: 320 }),
      hit({ chunkId: "x1", itemId: "ep2", startSec: 5 }),
    ]
    const { sources, numberFor } = groupHitsIntoSources(hits)
    expect(sources).toHaveLength(3)
    expect(hits.map(numberFor)).toEqual([1, 2, 3])
  })
})
