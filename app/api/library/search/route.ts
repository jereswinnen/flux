import { db } from "@/lib/db"
import { itemRepo } from "@/lib/db/items"
import { embedQuery } from "@/lib/ai/embeddings"
import { hybridSearch, refineHitTimestamps } from "@/lib/db/search"
import { itemToDTO } from "@/lib/api/dto"

// Global ⌘K library search: matching episodes (by title/show) + transcript
// moments (hybrid vector + full-text), resolved in parallel.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const query = typeof body?.query === "string" ? body.query.trim() : ""
  if (query.length < 2) return Response.json({ items: [], moments: [] })

  const [episodes, moments] = await Promise.all([
    itemRepo.search(query, 6),
    embedQuery(query)
      .then((embedding) => hybridSearch(db, embedding, query, { limit: 6 }))
      .then((hits) => refineHitTimestamps(db, hits, query))
      .catch(() => []),
  ])

  return Response.json({ items: episodes.map(itemToDTO), moments })
}
