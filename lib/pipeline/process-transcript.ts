import { eq } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { chunkSegments, type Segment } from "@/lib/ai/chunk"
import { embedTexts as defaultEmbedTexts } from "@/lib/ai/embeddings"
import {
  generateInsights as defaultGenerateInsights,
  type Insights,
} from "@/lib/ai/insights"
import { makeEpisodeRepo } from "@/lib/db/episodes"
import * as schema from "@/lib/db/schema"

export interface TranscriptResult {
  episodeId: string
  transcript: string
  segments: Segment[]
}

export interface PipelineDeps {
  db: PostgresJsDatabase<typeof schema>
  generateInsights?: (transcript: string, segments: Segment[]) => Promise<Insights>
  embedTexts?: (texts: string[]) => Promise<number[][]>
}

export async function processTranscript(result: TranscriptResult, deps: PipelineDeps) {
  const { db } = deps
  const repo = makeEpisodeRepo(db)
  const genInsights =
    deps.generateInsights ?? ((t: string, s: Segment[]) => defaultGenerateInsights(t, { segments: s }))
  const embed = deps.embedTexts ?? ((t: string[]) => defaultEmbedTexts(t))

  try {
    // 0. Make re-processing idempotent (retry, or a duplicate Modal callback).
    await db.delete(schema.insights).where(eq(schema.insights.episodeId, result.episodeId))
    await db.delete(schema.chunks).where(eq(schema.chunks.episodeId, result.episodeId))
    await db.delete(schema.transcripts).where(eq(schema.transcripts.episodeId, result.episodeId))

    // 1. Store transcript
    await db.insert(schema.transcripts).values({
      episodeId: result.episodeId,
      fullText: result.transcript,
      segments: result.segments,
    })

    // 2. Insights
    await repo.updateStatus(result.episodeId, "analyzing")
    const insights = await genInsights(result.transcript, result.segments)
    await db.insert(schema.insights).values({
      episodeId: result.episodeId,
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
          episodeId: result.episodeId,
          content: c.content,
          startSec: c.startSec,
          endSec: c.endSec,
          embedding: vectors[i],
        })),
      )
    }

    // 4. Ready
    await repo.updateStatus(result.episodeId, "ready")
  } catch (e) {
    await repo.updateStatus(
      result.episodeId,
      "failed",
      e instanceof Error ? e.message : String(e),
    )
    throw e
  }
}
