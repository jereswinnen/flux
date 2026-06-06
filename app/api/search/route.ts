import { db } from "@/lib/db"
import { embedQuery } from "@/lib/ai/embeddings"
import { hybridSearch } from "@/lib/db/search"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.query) return Response.json({ error: "missing query" }, { status: 400 })
  const hits = await hybridSearch(db, await embedQuery(body.query), body.query, {
    limit: Math.min(Number(body.limit) || 12, 50),
  })
  return Response.json({ hits })
}
