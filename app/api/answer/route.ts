import { openai } from "@ai-sdk/openai"
import { generateText, stepCountIs } from "ai"
import { db } from "@/lib/db"
import { embedQuery } from "@/lib/ai/embeddings"
import { hybridSearch, refineHitTimestamps, searchHighlights } from "@/lib/db/search"
import { assembleAskSources, type AskSourceEntry } from "@/lib/ai/ask-sources"
import { searchEntities } from "@/lib/db/entities"
import { toWebSources, type ModelSource } from "@/lib/ai/web-sources"
import { toSourceDTO } from "@/lib/api/source-dto"

function entryToSource(e: AskSourceEntry) {
  if (e.kind === "highlight") {
    const h = e.hit
    return {
      chunkId: h.highlightId,
      itemId: h.itemId,
      itemTitle: h.itemTitle,
      podcastName: h.podcastName,
      artworkUrl: h.artworkUrl,
      content: h.text,
      startSec: h.startSec,
      endSec: h.startSec,
      isHighlight: true,
      snippet: h.text,
    }
  }
  const h = e.hit
  return {
    chunkId: h.chunkId,
    itemId: h.itemId,
    itemTitle: h.itemTitle,
    podcastName: h.podcastName,
    artworkUrl: h.artworkUrl,
    content: h.content,
    startSec: h.startSec,
    endSec: h.endSec,
  }
}

// One-shot "smart search": synthesize a cited answer from the best transcript
// moments across the whole library. Returns the answer plus the source moments
// (the answer cites them as [1], [2], … matching the sources array order).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const query = typeof body?.query === "string" ? body.query.trim() : ""
  if (query.length < 2) return Response.json({ answer: null, sources: [], entities: [] })

  const qe = await embedQuery(query)
  const [rawSources, hlHits, entities] = await Promise.all([
    hybridSearch(db, qe, query, { limit: 10 }),
    searchHighlights(db, qe, {}),
    searchEntities(db, query, 5).catch(() => []),
  ])
  if (rawSources.length === 0 && hlHits.length === 0) {
    return Response.json({ answer: null, sources: [], entities })
  }
  const chunkHits = await refineHitTimestamps(db, rawSources, query)
  const { entries, context } = assembleAskSources(chunkHits, hlHits)
  const sources = entries.map(entryToSource)

  const { text, sources: modelSources } = await generateText({
    model: openai("gpt-5.4-mini-2026-03-17"),
    tools: { web_search: openai.tools.webSearch() },
    stopWhen: stepCountIs(3),
    system:
      "You are a knowledge-base assistant answering questions from a personal library. " +
      "Answer primarily from the numbered sources below. If they don't fully cover the question, " +
      "or it needs current/external information, use the web_search tool and integrate what you find — " +
      "prefer the library, use the web to supplement. Be thorough and specific; cite library claims " +
      "with the matching [n]. If neither the sources nor the web answer it, say so plainly.",
    prompt: `Question: ${query}\n\nSources:\n${context}`,
  })
  const sourcesWithWeb = [...sources, ...toWebSources((modelSources ?? []) as ModelSource[])]

  return Response.json({ answer: text, sources: sourcesWithWeb.map(toSourceDTO), entities })
}
