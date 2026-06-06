import { cosineDistance, desc, eq, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { chunks, episodes } from "./schema"
import * as schema from "./schema"

export interface SearchHit {
  chunkId: string
  episodeId: string
  episodeTitle: string
  content: string
  startSec: number
  endSec: number
  similarity: number
}

export async function searchChunks(
  db: PostgresJsDatabase<typeof schema>,
  queryEmbedding: number[],
  opts: { limit?: number; episodeId?: string } = {},
): Promise<SearchHit[]> {
  const similarity = sql<number>`(1 - (${cosineDistance(chunks.embedding, queryEmbedding)}))::float8`
  const rows = await db
    .select({
      chunkId: chunks.id,
      episodeId: chunks.episodeId,
      episodeTitle: episodes.title,
      content: chunks.content,
      startSec: chunks.startSec,
      endSec: chunks.endSec,
      similarity,
    })
    .from(chunks)
    .innerJoin(episodes, eq(chunks.episodeId, episodes.id))
    .where(opts.episodeId ? eq(chunks.episodeId, opts.episodeId) : undefined)
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
    select c.id as "chunkId", c.episode_id as "episodeId", e.title as "episodeTitle",
           c.content, c.start_sec as "startSec", c.end_sec as "endSec", f.score as "similarity"
    from fused f
    join chunks c on c.id = f.id
    join episodes e on e.id = c.episode_id
    order by f.score desc
    limit ${limit}
  `)
  // postgres-js via drizzle execute may return the array directly OR { rows }. Normalize:
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []
  return rows as unknown as SearchHit[]
}
