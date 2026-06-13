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
import type { ItemType } from "@/lib/db/schema"
import { resolveItemEntities, type ExtractedEntity } from "@/lib/entities/resolve"

export interface TranscriptResult {
  itemId: string
  transcript: string
  segments: Segment[]
  contentHtml?: string
  itemType?: ItemType
}

export interface PipelineDeps {
  db: PostgresJsDatabase<typeof schema>
  generateInsights?: (transcript: string, segments: Segment[]) => Promise<Insights>
  embedTexts?: (texts: string[]) => Promise<number[][]>
  resolveEntities?: (
    itemId: string,
    extracted: ExtractedEntity[],
    opts: { itemTitle?: string },
  ) => Promise<void>
}

export async function processContent(result: TranscriptResult, deps: PipelineDeps) {
  const { db } = deps
  const repo = makeItemRepo(db)
  const genInsights =
    deps.generateInsights ?? ((t: string, s: Segment[]) => defaultGenerateInsights(t, { segments: s, kind: result.itemType }))
  const embed = deps.embedTexts ?? ((t: string[]) => defaultEmbedTexts(t))
  const resolveEntities =
    deps.resolveEntities ??
    ((itemId: string, extracted: ExtractedEntity[], opts: { itemTitle?: string }) =>
      resolveItemEntities(itemId, extracted, { db, embedTexts: embed }, opts))

  try {
    // 1. Compute the slow, network-bound work FIRST — before touching stored data.
    await repo.updateStatus(result.itemId, "analyzing")
    const insights = await genInsights(result.transcript, result.segments)
    const chunks = chunkSegments(result.segments, { targetTokens: 600, overlapSegments: 1 })
    const vectors = chunks.length > 0 ? await embed(chunks.map((c) => c.content)) : []

    // 2. Atomically swap derived data (brief — no network calls inside the txn).
    await db.transaction(async (tx) => {
      await tx.delete(schema.insights).where(eq(schema.insights.itemId, result.itemId))
      await tx.delete(schema.chunks).where(eq(schema.chunks.itemId, result.itemId))
      await tx.delete(schema.itemEntities).where(eq(schema.itemEntities.itemId, result.itemId))
      await tx.delete(schema.transcripts).where(eq(schema.transcripts.itemId, result.itemId))

      await tx.insert(schema.transcripts).values({
        itemId: result.itemId,
        fullText: result.transcript,
        segments: result.segments,
        contentHtml: result.contentHtml,
      })
      await tx.insert(schema.insights).values({
        itemId: result.itemId,
        summary: insights.summary,
        takeaways: insights.takeaways,
        topics: insights.topics,
        chapters: insights.chapters,
        quotes: insights.quotes,
        entities: insights.entities,
      })
      if (chunks.length > 0) {
        await tx.insert(schema.chunks).values(
          chunks.map((c, i) => ({
            itemId: result.itemId,
            content: c.content,
            startSec: c.startSec,
            endSec: c.endSec,
            embedding: vectors[i],
          })),
        )
      }
    })

    // 3. Canonical entities — best-effort, after the swap (re-populates item_entities).
    try {
      const item = await repo.getById(result.itemId)
      await resolveEntities(result.itemId, insights.entities ?? [], { itemTitle: item?.title })
    } catch (e) {
      console.error(`entity resolution failed for item ${result.itemId}`, e)
    }

    // 4. Ready
    await repo.updateStatus(result.itemId, "ready")
  } catch (e) {
    await repo.updateStatus(result.itemId, "failed", e instanceof Error ? e.message : String(e))
    throw e
  }
}
