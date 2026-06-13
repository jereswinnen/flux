import { describe, expect, it } from "vitest"
import { splitForMarks } from "@/lib/highlights/mark-text"

describe("splitForMarks", () => {
  it("wraps a single match, keeping surrounding text", () => {
    expect(splitForMarks("the quick brown fox", [{ id: "h1", text: "quick brown" }])).toEqual([
      { text: "the " },
      { text: "quick brown", id: "h1" },
      { text: " fox" },
    ])
  })
  it("handles multiple non-overlapping matches in order", () => {
    expect(
      splitForMarks("a b c", [
        { id: "h2", text: "c" },
        { id: "h1", text: "a" },
      ]),
    ).toEqual([
      { text: "a", id: "h1" },
      { text: " b ", id: undefined },
      { text: "c", id: "h2" },
    ])
  })
  it("first wins on overlap; later overlapping match is skipped", () => {
    expect(
      splitForMarks("hello world", [
        { id: "h1", text: "hello world" },
        { id: "h2", text: "world" },
      ]),
    ).toEqual([{ text: "hello world", id: "h1" }])
  })
  it("returns the whole text when nothing matches", () => {
    expect(splitForMarks("nothing here", [{ id: "h1", text: "absent" }])).toEqual([
      { text: "nothing here" },
    ])
  })
})
