import { describe, expect, it } from "vitest"
import { findActiveSegmentIndex } from "@/lib/transcript/active-segment"

const segs = [
  { start: 0, end: 5, text: "a" },
  { start: 5, end: 10, text: "b" },
  { start: 10, end: 20, text: "c" },
]

describe("findActiveSegmentIndex", () => {
  it("returns -1 before the first segment / empty", () => {
    expect(findActiveSegmentIndex(segs, -1)).toBe(-1)
    expect(findActiveSegmentIndex([], 3)).toBe(-1)
  })
  it("finds the segment containing the time", () => {
    expect(findActiveSegmentIndex(segs, 0)).toBe(0)
    expect(findActiveSegmentIndex(segs, 4.9)).toBe(0)
    expect(findActiveSegmentIndex(segs, 5)).toBe(1)
    expect(findActiveSegmentIndex(segs, 12)).toBe(2)
  })
  it("clamps to the last segment past the end", () => {
    expect(findActiveSegmentIndex(segs, 999)).toBe(2)
  })
  it("uses next.start as the boundary when segments have gaps", () => {
    const gapped = [
      { start: 0, end: 2, text: "a" },
      { start: 8, end: 10, text: "b" },
    ]
    // 5s falls in the gap — belongs to the segment whose start is <= t (index 0)
    expect(findActiveSegmentIndex(gapped, 5)).toBe(0)
  })
})
