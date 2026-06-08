import { openai } from "@ai-sdk/openai"
import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"
import type { Segment } from "@/lib/ai/chunk"

export const insightsSchema = z.object({
  summary: z.string().describe("2-3 sentence summary (the TL;DR)"),
  takeaways: z.array(z.string()).describe("key bulleted takeaways"),
  topics: z.array(z.string()).describe("topics/themes discussed"),
  chapters: z
    .array(z.object({ title: z.string(), startSec: z.number() }))
    .optional()
    .describe("chronological chapters/sections with the start time in seconds"),
  quotes: z
    .array(z.object({ text: z.string(), approxTimestampSec: z.number() }))
    .describe("notable quotes with approximate timestamps in seconds"),
  entities: z
    .array(
      z.object({
        name: z.string(),
        // Categorize so the UI can group: people, companies, books, etc.
        type: z.enum(["person", "company", "book", "product", "place", "other"]),
      }),
    )
    .describe("people, companies, books, products, and places mentioned"),
})

export type Insights = z.infer<typeof insightsSchema>

function timestampedTranscript(segments: Segment[] | undefined, fallback: string): string {
  if (!segments || segments.length === 0) return fallback
  return segments
    .map((s) => {
      const m = Math.floor(s.start / 60)
      const sec = Math.floor(s.start % 60)
      return `[${m}:${String(sec).padStart(2, "0")}] ${s.text}`
    })
    .join("\n")
}

export async function generateInsights(
  transcript: string,
  opts: { model?: LanguageModel; segments?: Segment[] } = {},
): Promise<Insights> {
  const body = timestampedTranscript(opts.segments, transcript)
  const { object } = await generateObject({
    model: opts.model ?? openai("gpt-5.4-mini-2026-03-17"),
    schema: insightsSchema,
    prompt:
      "You are a sharp research assistant building reusable notes from a podcast episode. " +
      "The transcript below is prefixed with [m:ss] timestamps.\n\n" +
      "Produce structured insights:\n" +
      "- summary: a tight 2-3 sentence TL;DR of what the episode is actually about.\n" +
      "- takeaways: the most important, specific lessons or claims — not generic platitudes.\n" +
      "- chapters: 4-10 chronological sections that map the episode's arc. Give each a short, " +
      "descriptive title and the startSec (in seconds) taken from the nearest preceding [m:ss] marker.\n" +
      "- quotes: a few genuinely memorable quotes, each with approxTimestampSec from its marker.\n" +
      "- topics: concise themes (1-3 words each).\n" +
      "- entities: notable people, companies, books, products, and places mentioned, each typed.\n\n" +
      "Transcript:\n" +
      body,
  })
  return object
}
