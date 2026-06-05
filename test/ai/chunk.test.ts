import { expect, test } from "vitest"
import { chunkSegments, estimateTokens } from "@/lib/ai/chunk"

test("estimateTokens approximates by characters", () => {
  expect(estimateTokens("abcd")).toBe(1) // 4 chars ~= 1 token
  expect(estimateTokens("a".repeat(40))).toBe(10)
})

test("chunkSegments groups segments up to the token target", () => {
  // Each segment ~25 tokens (100 chars). Target 60 tokens -> ~2-3 segments/chunk.
  const segments = Array.from({ length: 6 }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 10,
    text: "x".repeat(100),
  }))
  const chunks = chunkSegments(segments, { targetTokens: 60, overlapSegments: 1 })

  expect(chunks.length).toBeGreaterThan(1)
  // Each chunk records the span of its segments.
  expect(chunks[0].startSec).toBe(0)
  expect(chunks[0].content).toContain("x")
  // Overlap: chunk 2 starts at or before the end of chunk 1's last segment.
  expect(chunks[1].startSec).toBeLessThan(chunks[0].endSec)
})

test("chunkSegments handles empty input", () => {
  expect(chunkSegments([], { targetTokens: 60, overlapSegments: 1 })).toEqual([])
})
