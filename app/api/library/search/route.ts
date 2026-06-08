import { db } from "@/lib/db"
import { episodeRepo } from "@/lib/db/episodes"
import { embedQuery } from "@/lib/ai/embeddings"
import { hybridSearch, refineHitTimestamps } from "@/lib/db/search"

// Global ⌘K library search: matching episodes (by title/show) + transcript
// moments (hybrid vector + full-text), resolved in parallel.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const query = typeof body?.query === "string" ? body.query.trim() : ""
  if (query.length < 2) return Response.json({ episodes: [], moments: [] })

  const [episodes, moments] = await Promise.all([
    episodeRepo.search(query, 6),
    embedQuery(query)
      .then((embedding) => hybridSearch(db, embedding, query, { limit: 6 }))
      .then((hits) => refineHitTimestamps(db, hits, query))
      .catch(() => []),
  ])

  return Response.json({
    episodes: episodes.map((e) => ({
      id: e.id,
      title: e.title,
      podcastName: e.podcastName,
      artworkUrl: e.artworkUrl,
      status: e.status,
      publishedAt: e.publishedAt ? e.publishedAt.toISOString() : null,
    })),
    moments,
  })
}
