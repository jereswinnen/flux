import { describe, expect, it } from "vitest"
import { toSourceDTO } from "@/lib/api/source-dto"

describe("toSourceDTO", () => {
  it("derives kind from flags and aliases podcastName→source", () => {
    expect(toSourceDTO({ itemId: "i", itemTitle: "T", startSec: 5, podcastName: "Show", isHighlight: true }))
      .toMatchObject({ kind: "highlight", source: "Show", itemTitle: "T", startSec: 5 })
    expect(toSourceDTO({ itemId: "", itemTitle: "Page", startSec: 0, url: "https://x", isWeb: true }))
      .toMatchObject({ kind: "web", url: "https://x" })
    expect(toSourceDTO({ itemId: "i", itemTitle: "T", startSec: 0 }).kind).toBe("item")
  })
})
