import { describe, expect, it } from "vitest"
import { toWebSources } from "@/lib/ai/web-sources"

describe("toWebSources", () => {
  it("maps url sources to web ChatSources, titled, deduped by url", () => {
    const out = toWebSources([
      { sourceType: "url", id: "1", url: "https://example.com/a", title: "Article A" },
      { sourceType: "url", id: "2", url: "https://example.com/a", title: "Dup" },
      { sourceType: "url", id: "3", url: "https://news.org/x" },
    ])
    expect(out).toEqual([
      { isWeb: true, url: "https://example.com/a", itemTitle: "Article A", itemId: "", startSec: 0, snippet: null },
      { isWeb: true, url: "https://news.org/x", itemTitle: "news.org", itemId: "", startSec: 0, snippet: null },
    ])
  })
  it("ignores non-url / ur-less sources", () => {
    expect(toWebSources([{ sourceType: "document", id: "d" }, { sourceType: "url", id: "e" }])).toEqual([])
  })
})
