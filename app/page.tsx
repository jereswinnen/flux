import { episodeRepo } from "@/lib/db/episodes"
import { AppHeader } from "@/components/app-header"
import { Library } from "@/components/library"
import type { LibEpisode } from "@/components/episode-card"

export const dynamic = "force-dynamic"

export default async function Page() {
  const rows = await episodeRepo.list()
  const episodes: LibEpisode[] = rows.map((e) => ({
    id: e.id,
    title: e.title,
    podcastName: e.podcastName,
    artworkUrl: e.artworkUrl,
    status: e.status,
    publishedAt: e.publishedAt ? e.publishedAt.toISOString() : null,
    createdAt: e.createdAt.toISOString(),
  }))
  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Library" }]} />
      <Library initialEpisodes={episodes} />
    </>
  )
}
