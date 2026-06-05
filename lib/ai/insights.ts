import { openai } from "@ai-sdk/openai"
import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"

export const insightsSchema = z.object({
  summary: z.string().describe("2-3 sentence summary"),
  takeaways: z.array(z.string()).describe("key bulleted takeaways"),
  topics: z.array(z.string()).describe("topics/themes discussed"),
  quotes: z
    .array(z.object({ text: z.string(), approxTimestampSec: z.number() }))
    .describe("notable quotes with approximate timestamps in seconds"),
  entities: z
    .array(z.object({ name: z.string(), type: z.string() }))
    .describe("people/orgs/products mentioned"),
})

export type Insights = z.infer<typeof insightsSchema>

export async function generateInsights(
  transcript: string,
  opts: { model?: LanguageModel } = {},
): Promise<Insights> {
  const { object } = await generateObject({
    model: opts.model ?? openai("gpt-5.4-mini-2026-03-17"),
    schema: insightsSchema,
    prompt:
      "You are analyzing a podcast transcript. Produce structured insights.\n\n" +
      "Transcript:\n" +
      transcript,
  })
  return object
}
