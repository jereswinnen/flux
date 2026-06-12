import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { entitiesForEpisode } from "@/lib/db/entities"
import { itemRepo } from "@/lib/db/items"
import { insights as insightsTable, transcripts as transcriptsTable } from "@/lib/db/schema"
import { EpisodeView } from "@/components/episode-view"

export const dynamic = "force-dynamic"

export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const episode = await itemRepo.getById(id)
  if (!episode) notFound()

  const [transcript] = await db.select().from(transcriptsTable).where(eq(transcriptsTable.itemId, id)).limit(1)
  const [insight] = await db.select().from(insightsTable).where(eq(insightsTable.itemId, id)).limit(1)
  const entities = await entitiesForEpisode(db, id)

  return (
    <>
      <EpisodeView
        episode={{
          id: episode.id,
          title: episode.title,
          podcastName: episode.podcastName,
          artworkUrl: episode.artworkUrl,
          status: episode.status,
          errorMessage: episode.errorMessage,
          publishedAt: episode.publishedAt ? episode.publishedAt.toISOString() : null,
          durationSec: episode.durationSec,
          audioUrl: episode.audioUrl,
          sourceUrl: episode.sourceUrl,
          type: episode.type,
          videoId: episode.sourceMetadata?.videoId ?? null,
        }}
        transcript={transcript ? { fullText: transcript.fullText, segments: transcript.segments ?? [], contentHtml: transcript.contentHtml ?? null } : null}
        insights={insight ?? null}
        entities={entities}
      />
    </>
  )
}
