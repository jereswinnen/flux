import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { entitiesForItem } from "@/lib/db/entities"
import { highlightRepo } from "@/lib/db/highlights"
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
  const entities = await entitiesForItem(db, id)
  const highlightRows = await highlightRepo.list({ itemId: id })
  const highlights = highlightRows.map((h) => ({
    id: h.id,
    kind: h.kind,
    text: h.text,
    note: h.note,
    locator: h.locator,
  }))

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
        highlights={highlights}
      />
    </>
  )
}
