import { openai } from "@ai-sdk/openai"
import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"
import type { Segment } from "@/lib/ai/chunk"

export const insightsSchema = z.object({
  summary: z.string().describe("2-3 sentence summary (the TL;DR)"),
  takeaways: z.array(z.string()).describe("key bulleted takeaways"),
  topics: z.array(z.string()).describe("topics/themes discussed"),
  // Required (return [] if none): OpenAI strict structured-output rejects
  // optional keys — every property must be present.
  chapters: z
    .array(z.object({ title: z.string(), startSec: z.number() }))
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
        context: z
          .string()
          .describe("short phrase: how/why it was mentioned, e.g. 'author of Sapiens, discussed re: AI'"),
        approxTimestampSec: z
          .number()
          .describe("approximate second of the first/main mention, from the nearest [m:ss] marker"),
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

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()

// The model only *estimates* the second a quote/chapter occurs at. Anchor it to
// the real transcript by finding the segment whose words best overlap the text,
// and use that segment's actual start time. Falls back to the model's value.
function anchorToSegment(text: string, segments: Segment[], fallbackSec: number): number {
  const target = normalize(text)
  if (!target) return fallbackSec
  const words = new Set(target.split(" ").filter((w) => w.length > 3))
  if (words.size === 0) return fallbackSec

  let bestStart = fallbackSec
  let bestScore = 0
  for (const seg of segments) {
    const segWords = normalize(seg.text).split(" ")
    if (segWords.length === 0) continue
    let hits = 0
    for (const w of segWords) if (words.has(w)) hits++
    // Normalize by segment length so long segments don't always win.
    const score = hits / Math.sqrt(segWords.length)
    if (score > bestScore) {
      bestScore = score
      bestStart = seg.start
    }
  }
  // Require a minimum signal before trusting the match.
  return bestScore >= 1 ? bestStart : fallbackSec
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
      "- entities: notable people, companies, books, products, and places mentioned, each typed, " +
      "with a short context phrase describing how it came up and the approxTimestampSec of its " +
      "first/main mention taken from the nearest preceding [m:ss] marker.\n\n" +
      "Transcript:\n" +
      body,
  })

  // Quotes are near-verbatim, so snap them onto the real segment they came from
  // for accurate timestamps. Chapter titles are paraphrased summaries, so we keep
  // the model's marker-derived startSec for those.
  const segments = opts.segments
  if (!segments || segments.length === 0) return object
  return {
    ...object,
    quotes: object.quotes.map((q) => ({
      ...q,
      approxTimestampSec: anchorToSegment(q.text, segments, q.approxTimestampSec),
    })),
  }
}
