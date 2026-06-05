import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { episodeRepo } from "@/lib/db/episodes"
import { insights as insightsTable, transcripts as transcriptsTable } from "@/lib/db/schema"
import { AppHeader } from "@/components/app-header"
import { EpisodeView } from "@/components/episode-view"

export const dynamic = "force-dynamic"

export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const episode = await episodeRepo.getById(id)
  if (!episode) notFound()

  const [transcript] = await db.select().from(transcriptsTable).where(eq(transcriptsTable.episodeId, id)).limit(1)
  const [insight] = await db.select().from(insightsTable).where(eq(insightsTable.episodeId, id)).limit(1)

  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Library", href: "/" }, { label: episode.title }]} />
      <EpisodeView
        episode={{
          id: episode.id,
          title: episode.title,
          podcastName: episode.podcastName,
          artworkUrl: episode.artworkUrl,
          status: episode.status,
          errorMessage: episode.errorMessage,
          publishedAt: episode.publishedAt ? episode.publishedAt.toISOString() : null,
        }}
        transcript={transcript ? { fullText: transcript.fullText, segments: transcript.segments ?? [] } : null}
        insights={insight ?? null}
      />
    </>
  )
}
