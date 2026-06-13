import { and, cosineDistance, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { chunks, highlights, items, transcripts } from "./schema"
import * as schema from "./schema"

export interface SearchHit {
  chunkId: string
  itemId: string
  itemTitle: string
  podcastName: string | null
  artworkUrl: string | null
  audioUrl: string | null
  videoId: string | null
  content: string
  startSec: number
  endSec: number
  similarity: number
}

export async function searchChunks(
  db: PostgresJsDatabase<typeof schema>,
  queryEmbedding: number[],
  opts: { limit?: number; itemId?: string } = {},
): Promise<SearchHit[]> {
  const similarity = sql<number>`(1 - (${cosineDistance(chunks.embedding, queryEmbedding)}))::float8`
  const rows = await db
    .select({
      chunkId: chunks.id,
      itemId: chunks.itemId,
      itemTitle: items.title,
      podcastName: items.podcastName,
      artworkUrl: items.artworkUrl,
      audioUrl: items.audioUrl,
      videoId: sql<string | null>`${items.sourceMetadata}->>'videoId'`,
      content: chunks.content,
      startSec: chunks.startSec,
      endSec: chunks.endSec,
      similarity,
    })
    .from(chunks)
    .innerJoin(items, eq(chunks.itemId, items.id))
    .where(opts.itemId ? eq(chunks.itemId, opts.itemId) : undefined)
    .orderBy(desc(similarity))
    .limit(opts.limit ?? 8)
  return rows
}

export async function hybridSearch(
  db: PostgresJsDatabase<typeof schema>,
  queryEmbedding: number[],
  queryText: string,
  opts: { limit?: number } = {},
): Promise<SearchHit[]> {
  const limit = opts.limit ?? 8
  const k = 60 // RRF constant
  const vec = `[${queryEmbedding.join(",")}]`
  const result = await db.execute(sql`
    with vec as (
      select id, row_number() over (order by embedding <=> ${vec}::vector) as rank
      from chunks order by embedding <=> ${vec}::vector limit 50
    ),
    fts as (
      select id, row_number() over (
        order by ts_rank(content_tsv, websearch_to_tsquery('english', ${queryText})) desc
      ) as rank
      from chunks
      where content_tsv @@ websearch_to_tsquery('english', ${queryText})
      limit 50
    ),
    fused as (
      select coalesce(vec.id, fts.id) as id,
             coalesce(1.0/(${k} + vec.rank), 0) + coalesce(1.0/(${k} + fts.rank), 0) as score
      from vec full outer join fts on vec.id = fts.id
    )
    select c.id as "chunkId", c.item_id as "itemId", e.title as "itemTitle",
           e.podcast_name as "podcastName", e.artwork_url as "artworkUrl", e.audio_url as "audioUrl",
           e.source_metadata->>'videoId' as "videoId",
           c.content, c.start_sec as "startSec", c.end_sec as "endSec", f.score as "similarity"
    from fused f
    join chunks c on c.id = f.id
    join items e on e.id = c.item_id
    order by f.score desc
    limit ${limit}
  `)
  // postgres-js via drizzle execute may return the array directly OR { rows }. Normalize:
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []
  return rows as unknown as SearchHit[]
}

export interface HighlightHit {
  highlightId: string
  itemId: string
  itemTitle: string
  podcastName: string | null
  artworkUrl: string | null
  audioUrl: string | null
  videoId: string | null
  text: string
  startSec: number
  similarity: number
}

export async function searchHighlights(
  db: PostgresJsDatabase<typeof schema>,
  queryEmbedding: number[],
  opts: { limit?: number; minSimilarity?: number; itemId?: string } = {},
): Promise<HighlightHit[]> {
  const similarity = sql<number>`(1 - (${cosineDistance(highlights.embedding, queryEmbedding)}))::float8`
  const conds = [isNotNull(highlights.embedding)]
  if (opts.itemId) conds.push(eq(highlights.itemId, opts.itemId))
  const rows = await db
    .select({
      highlightId: highlights.id,
      itemId: items.id,
      itemTitle: items.title,
      podcastName: items.podcastName,
      artworkUrl: items.artworkUrl,
      audioUrl: items.audioUrl,
      videoId: sql<string | null>`${items.sourceMetadata}->>'videoId'`,
      text: highlights.text,
      locator: highlights.locator,
      similarity,
    })
    .from(highlights)
    .innerJoin(items, eq(highlights.itemId, items.id))
    .where(and(...conds))
    .orderBy(desc(similarity))
    .limit(opts.limit ?? 3)
  const min = opts.minSimilarity ?? 0.35
  return rows
    .filter((r) => r.similarity >= min)
    .map((r) => ({
      highlightId: r.highlightId,
      itemId: r.itemId,
      itemTitle: r.itemTitle,
      podcastName: r.podcastName,
      artworkUrl: r.artworkUrl,
      audioUrl: r.audioUrl,
      videoId: r.videoId,
      text: r.text,
      startSec: r.locator?.sec && r.locator.sec > 0 ? Math.floor(r.locator.sec) : 0,
      similarity: r.similarity,
    }))
}

const normalizeText = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()

/**
 * Hits are retrieved at chunk granularity (~600 tokens / several minutes), and a
 * chunk's startSec points at its beginning. Refine each hit's timestamp to the
 * single transcript segment inside the chunk that best matches the query, so
 * "jump to moment" lands on the relevant sentence rather than the chunk start.
 */
export async function refineHitTimestamps(
  db: PostgresJsDatabase<typeof schema>,
  hits: SearchHit[],
  query: string,
): Promise<SearchHit[]> {
  if (hits.length === 0) return hits
  const words = new Set(normalizeText(query).split(" ").filter((w) => w.length > 3))
  if (words.size === 0) return hits

  const itemIds = [...new Set(hits.map((h) => h.itemId))]
  const rows = await db
    .select({ itemId: transcripts.itemId, segments: transcripts.segments })
    .from(transcripts)
    .where(inArray(transcripts.itemId, itemIds))
  const segsByItem = new Map(rows.map((r) => [r.itemId, r.segments ?? []]))

  return hits.map((h) => {
    const segs = segsByItem.get(h.itemId) ?? []
    let bestStart = h.startSec
    let bestScore = 0
    for (const s of segs) {
      if (s.start < h.startSec || s.start > h.endSec) continue
      let score = 0
      for (const w of normalizeText(s.text).split(" ")) if (words.has(w)) score++
      if (score > bestScore) {
        bestScore = score
        bestStart = Math.floor(s.start)
      }
    }
    return bestScore > 0 ? { ...h, startSec: bestStart } : h
  })
}
