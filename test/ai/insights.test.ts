import { expect, test } from "vitest"
import { MockLanguageModelV3 } from "ai/test"
import { generateInsights, insightsSchema } from "@/lib/ai/insights"

test("generateInsights returns a structured object validated by the schema", async () => {
  const value = {
    summary: "A talk about X.",
    takeaways: ["one", "two"],
    topics: ["x"],
    chapters: [{ title: "Intro", startSec: 0 }],
    quotes: [{ text: "quote", approxTimestampSec: 12 }],
    entities: [{ name: "Jane", type: "person" }],
  }
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
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      warnings: [],
    }),
  })

  const out = await generateInsights("transcript text here", { model })
  expect(insightsSchema.parse(out)).toEqual(value)
  expect(out.takeaways).toHaveLength(2)
})
