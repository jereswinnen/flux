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
