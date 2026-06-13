import { db } from "@/lib/db"
import { episodesMentioning } from "@/lib/db/topics"
import { AppHeader } from "@/components/app-header"
import { EpisodeCard, type LibEpisode } from "@/components/episode-card"

export const dynamic = "force-dynamic"

export default async function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const name = decodeURIComponent(slug)
  const rows = await episodesMentioning(db, name)
  const episodes: LibEpisode[] = rows.map((e) => ({
    id: e.id,
    title: e.title,
    source: e.podcastName,
    artworkUrl: e.artworkUrl,
    status: e.status,
    publishedAt: e.publishedAt ? e.publishedAt.toISOString() : null,
  }))

  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Library", href: "/" }, { label: name }]} />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-6">
        <h1 className="text-lg font-semibold">
          Episodes mentioning &ldquo;{name}&rdquo;
        </h1>
        {episodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No episodes found.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {episodes.map((e) => (
              <EpisodeCard key={e.id} episode={e} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
