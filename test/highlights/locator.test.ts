import { describe, expect, it } from "vitest"
import { buildLocator, highlightJumpHref } from "@/lib/highlights/locator"

describe("buildLocator", () => {
  it("transcript → { sec }", () => {
    expect(buildLocator("transcript", { hlSec: "42", hlIndex: "3" })).toEqual({ sec: 42 })
  })
  it("quote → { index, sec }", () => {
    expect(buildLocator("quote", { hlIndex: "2", hlSec: "90" })).toEqual({ index: 2, sec: 90 })
  })
  it("takeaway → { index }", () => {
    expect(buildLocator("takeaway", { hlIndex: "5" })).toEqual({ index: 5 })
  })
  it("ignores missing/NaN attrs", () => {
    expect(buildLocator("transcript", {})).toEqual({})
  })
})

describe("highlightJumpHref", () => {
  it("transcript/quote with sec → ?t=", () => {
    expect(highlightJumpHref("i1", "transcript", { sec: 42.7 })).toBe("/episodes/i1?t=42")
    expect(highlightJumpHref("i1", "quote", { index: 1, sec: 90 })).toBe("/episodes/i1?t=90")
  })
  it("takeaway / no sec → bare item", () => {
    expect(highlightJumpHref("i1", "takeaway", { index: 2 })).toBe("/episodes/i1")
    expect(highlightJumpHref("i1", "transcript", null)).toBe("/episodes/i1")
  })
})
