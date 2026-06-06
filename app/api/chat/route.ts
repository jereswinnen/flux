import { openai } from "@ai-sdk/openai"
import { streamText } from "ai"
import { embedQuery } from "@/lib/ai/embeddings"
import { db } from "@/lib/db"
import { searchChunks } from "@/lib/db/search"
import { formatTimestamp } from "@/lib/format"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.question) return Response.json({ error: "missing question" }, { status: 400 })

  const libraryWide = !body.episodeId
  const queryEmbedding = await embedQuery(body.question)
  const hits = await searchChunks(db, queryEmbedding, {
    limit: 8,
    episodeId: body.episodeId,
  })

  // In library-wide mode, prefix each excerpt with its episode so the model can attribute.
  const context = hits
    .map((h) =>
      libraryWide
        ? `[${h.episodeTitle} — ${formatTimestamp(h.startSec)}] ${h.content}`
        : `[${formatTimestamp(h.startSec)}] ${h.content}`,
    )
    .join("\n\n")

  const result = streamText({
    model: openai("gpt-5.4-mini-2026-03-17"),
    system:
      "Answer the user's question using ONLY the provided transcript excerpts. " +
      (libraryWide
        ? "Cite the episode title and [timestamp] of excerpts you rely on. "
        : "Cite the [timestamp] of excerpts you rely on. ") +
      "If the answer isn't in the excerpts, say so.",
    prompt: `Transcript excerpts:\n${context}\n\nQuestion: ${body.question}`,
  })

  // Expose the retrieved sources so the client can render traceable, clickable references.
  const sources = hits.map((h) => ({
    episodeId: h.episodeId,
    episodeTitle: h.episodeTitle,
    startSec: h.startSec,
  }))

  return result.toTextStreamResponse({
    headers: { "x-sources": encodeURIComponent(JSON.stringify(sources)) },
  })
}
