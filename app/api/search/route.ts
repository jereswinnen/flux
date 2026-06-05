import { db } from "@/lib/db"
import { embedQuery } from "@/lib/ai/embeddings"
import { searchChunks } from "@/lib/db/search"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.query) return Response.json({ error: "missing query" }, { status: 400 })
  const queryEmbedding = await embedQuery(body.query)
  const hits = await searchChunks(db, queryEmbedding, {
    limit: body.limit ?? 8,
    episodeId: body.episodeId,
  })
  return Response.json({ hits })
}
