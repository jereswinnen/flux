import { describe, expect, it } from "vitest"
import { episodeHref } from "@/lib/episode-href"

describe("episodeHref", () => {
  it("adds ?t= for a positive timestamp", () => {
    expect(episodeHref("i1", 42.7)).toBe("/episodes/i1?t=42")
  })
  it("omits ?t= for zero / missing (articles)", () => {
    expect(episodeHref("i1", 0)).toBe("/episodes/i1")
    expect(episodeHref("i1")).toBe("/episodes/i1")
    expect(episodeHref("i1", -5)).toBe("/episodes/i1")
  })
})
