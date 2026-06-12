import { eq } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { chunkSegments, type Segment } from "@/lib/ai/chunk"
import { embedTexts as defaultEmbedTexts } from "@/lib/ai/embeddings"
import {
  generateInsights as defaultGenerateInsights,
  type Insights,
} from "@/lib/ai/insights"
import { makeItemRepo } from "@/lib/db/items"
import * as schema from "@/lib/db/schema"
import { resolveEpisodeEntities, type ExtractedEntity } from "@/lib/entities/resolve"

export interface TranscriptResult {
  itemId: string
  transcript: string
  segments: Segment[]
}

export interface PipelineDeps {
  db: PostgresJsDatabase<typeof schema>
  generateInsights?: (transcript: string, segments: Segment[]) => Promise<Insights>
  embedTexts?: (texts: string[]) => Promise<number[][]>
  resolveEntities?: (
    itemId: string,
    extracted: ExtractedEntity[],
    opts: { episodeTitle?: string },
  ) => Promise<void>
}

export async function processContent(result: TranscriptResult, deps: PipelineDeps) {
  const { db } = deps
  const repo = makeItemRepo(db)
  const genInsights =
    deps.generateInsights ?? ((t: string, s: Segment[]) => defaultGenerateInsights(t, { segments: s }))
  const embed = deps.embedTexts ?? ((t: string[]) => defaultEmbedTexts(t))
  const resolveEntities =
    deps.resolveEntities ??
    ((itemId: string, extracted: ExtractedEntity[], opts: { episodeTitle?: string }) =>
      resolveEpisodeEntities(itemId, extracted, { db, embedTexts: embed }, opts))

  try {
    // 0. Make re-processing idempotent (retry, or a duplicate Modal callback).
    await db.delete(schema.insights).where(eq(schema.insights.itemId, result.itemId))
    await db.delete(schema.chunks).where(eq(schema.chunks.itemId, result.itemId))
    await db.delete(schema.itemEntities).where(eq(schema.itemEntities.itemId, result.itemId))
    await db.delete(schema.transcripts).where(eq(schema.transcripts.itemId, result.itemId))

    // 1. Store transcript
    await db.insert(schema.transcripts).values({
      itemId: result.itemId,
      fullText: result.transcript,
      segments: result.segments,
    })

    // 2. Insights
    await repo.updateStatus(result.itemId, "analyzing")
    const insights = await genInsights(result.transcript, result.segments)
    await db.insert(schema.insights).values({
      itemId: result.itemId,
      summary: insights.summary,
      takeaways: insights.takeaways,
      topics: insights.topics,
      chapters: insights.chapters,
      quotes: insights.quotes,
      entities: insights.entities,
    })

    // 3. Chunk + embed
    const chunks = chunkSegments(result.segments, { targetTokens: 600, overlapSegments: 1 })
    if (chunks.length > 0) {
      const vectors = await embed(chunks.map((c) => c.content))
      await db.insert(schema.chunks).values(
        chunks.map((c, i) => ({
          itemId: result.itemId,
          content: c.content,
          startSec: c.startSec,
          endSec: c.endSec,
          embedding: vectors[i],
        })),
      )
    }

    // 3.5. Canonical entities — best-effort.
    try {
      const item = await repo.getById(result.itemId)
      await resolveEntities(result.itemId, insights.entities ?? [], {
        episodeTitle: item?.title,
      })
    } catch (e) {
      console.error(`entity resolution failed for item ${result.itemId}`, e)
    }

    // 4. Ready
    await repo.updateStatus(result.itemId, "ready")
  } catch (e) {
    await repo.updateStatus(
      result.itemId,
      "failed",
      e instanceof Error ? e.message : String(e),
    )
    throw e
  }
}
