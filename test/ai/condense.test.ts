import { expect, test } from "vitest"
import { MockLanguageModelV3 } from "ai/test"
import { condenseQuery } from "@/lib/ai/condense"

test("returns the question unchanged when there is no history", async () => {
  const model = new MockLanguageModelV3({ doGenerate: async () => { throw new Error("should not call") } })
  const out = await condenseQuery([], "What is RRF?", { model })
  expect(out).toBe("What is RRF?")
})

test("rewrites a follow-up into a standalone query using history", async () => {
  const model = new MockLanguageModelV3({
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
      content: [{ type: "text" as const, text: "What did Elon say about manufacturing speed?" }],
      warnings: [],
    }),
  })
  const out = await condenseQuery(
    [{ role: "user", content: "Tell me about Elon's views" }, { role: "assistant", content: "..." }],
    "what about manufacturing?",
    { model },
  )
  expect(out).toContain("manufacturing")
})
