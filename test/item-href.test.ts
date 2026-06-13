import { describe, expect, it } from "vitest"
import { itemHref } from "@/lib/item-href"

describe("itemHref", () => {
  it("adds ?t= for a positive timestamp", () => {
    expect(itemHref("i1", 42.7)).toBe("/episodes/i1?t=42")
  })
  it("omits ?t= for zero / missing (articles)", () => {
    expect(itemHref("i1", 0)).toBe("/episodes/i1")
    expect(itemHref("i1")).toBe("/episodes/i1")
    expect(itemHref("i1", -5)).toBe("/episodes/i1")
  })
})
