import { expect, test } from "vitest"
import { MockEmbeddingModelV3 } from "ai/test"
import { embedTexts } from "@/lib/ai/embeddings"

test("embedTexts returns one vector per input", async () => {
  const model = new MockEmbeddingModelV3({
    doEmbed: async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => Array(1536).fill(0.1)),
      usage: { tokens: values.length },
      warnings: [],
    }),
  })
  const out = await embedTexts(["a", "b"], { model })
  expect(out).toHaveLength(2)
  expect(out[0]).toHaveLength(1536)
})

test("embedTexts returns [] for empty input", async () => {
  expect(await embedTexts([])).toEqual([])
})
