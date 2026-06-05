import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { episodeRepo } from "@/lib/db/episodes"
import { insights as insightsTable, transcripts as transcriptsTable } from "@/lib/db/schema"
import { EpisodeDetail } from "@/components/episode-detail"

export const dynamic = "force-dynamic"

export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const episode = await episodeRepo.getById(id)
  if (!episode) notFound()

  const [transcript] = await db.select().from(transcriptsTable).where(eq(transcriptsTable.episodeId, id)).limit(1)
  const [insight] = await db.select().from(insightsTable).where(eq(insightsTable.episodeId, id)).limit(1)

  return (
    <EpisodeDetail
      episode={{
        id: episode.id,
        title: episode.title,
        podcastName: episode.podcastName,
        status: episode.status,
        errorMessage: episode.errorMessage,
      }}
      transcript={transcript ? { fullText: transcript.fullText, segments: transcript.segments ?? [] } : null}
      insights={
        insight
          ? {
              summary: insight.summary,
              takeaways: insight.takeaways,
              topics: insight.topics,
              quotes: insight.quotes,
              entities: insight.entities,
            }
          : null
      }
    />
  )
}
