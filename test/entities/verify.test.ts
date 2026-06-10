import { expect, test } from "vitest"
import { MockLanguageModelV3 } from "ai/test"
import { verifyCandidate } from "@/lib/entities/verify"
import type { Candidate } from "@/lib/entities/sources"

const candidates: Candidate[] = [
  { source: "wikipedia", title: "Mercury (planet)", description: "planet" },
  { source: "wikipedia", title: "Mercury (element)", description: "chemical element" },
]

function modelReturning(value: unknown) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: {
          total: 1,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 1, text: undefined, reasoning: undefined },
      },
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      warnings: [],
    }),
  })
}

test("returns the model's chosen candidate index", async () => {
  const idx = await verifyCandidate(
    { name: "Mercury", type: "other", context: "discussed planetary orbits" },
    candidates,
    { model: modelReturning({ candidateIndex: 0 }) },
  )
  expect(idx).toBe(0)
})

test("returns -1 when the model rejects all candidates", async () => {
  const idx = await verifyCandidate(
    { name: "Mercury", type: "other" },
    candidates,
    { model: modelReturning({ candidateIndex: -1 }) },
  )
  expect(idx).toBe(-1)
})

test("clamps an out-of-range index to -1 and short-circuits on empty candidates", async () => {
  const idx = await verifyCandidate(
    { name: "Mercury", type: "other" },
    candidates,
    { model: modelReturning({ candidateIndex: 7 }) },
  )
  expect(idx).toBe(-1)
  // Empty candidates never call the model.
  expect(await verifyCandidate({ name: "X", type: "other" }, [])).toBe(-1)
})
