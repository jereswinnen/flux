import { openai } from "@ai-sdk/openai"
import { generateText } from "ai"
import { db } from "@/lib/db"
import { embedQuery } from "@/lib/ai/embeddings"
import { hybridSearch, refineHitTimestamps } from "@/lib/db/search"
import { searchEntities } from "@/lib/db/entities"
import { formatTimestamp } from "@/lib/format"

// One-shot "smart search": synthesize a cited answer from the best transcript
// moments across the whole library. Returns the answer plus the source moments
// (the answer cites them as [1], [2], … matching the sources array order).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const query = typeof body?.query === "string" ? body.query.trim() : ""
  if (query.length < 2) return Response.json({ answer: null, sources: [], entities: [] })

  const [rawSources, entities] = await Promise.all([
    hybridSearch(db, await embedQuery(query), query, { limit: 10 }),
    searchEntities(db, query, 5).catch(() => []),
  ])
  if (rawSources.length === 0) return Response.json({ answer: null, sources: [], entities })
  const sources = await refineHitTimestamps(db, rawSources, query)

  const numbered = sources
    .map((s, i) => `[${i + 1}] (${s.itemTitle} @ ${formatTimestamp(s.startSec)}) ${s.content}`)
    .join("\n\n")

  const { text } = await generateText({
    model: openai("gpt-5.4-mini-2026-03-17"),
    system:
      "You are a knowledge-base assistant answering questions from a personal podcast library. " +
      "Answer ONLY from the numbered sources. Be thorough and specific: cover each distinct point, include " +
      "concrete details (names, numbers, examples), and use a short markdown list when there are several points. " +
      "Cite every claim with the matching [n] (you may cite multiple, e.g. [1][3]). Don't pad or repeat. " +
      "If the sources don't contain the answer, say so plainly.",
    prompt: `Question: ${query}\n\nSources:\n${numbered}`,
  })

  return Response.json({ answer: text, sources, entities })
}
