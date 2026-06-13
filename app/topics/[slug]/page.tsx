import { db } from "@/lib/db"
import { itemsMentioning } from "@/lib/db/topics"
import { AppHeader } from "@/components/app-header"
import { ItemCard, type LibItem } from "@/components/item-card"

export const dynamic = "force-dynamic"

export default async function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const name = decodeURIComponent(slug)
  const rows = await itemsMentioning(db, name)
  const episodes: LibItem[] = rows.map((e) => ({
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
          Items mentioning &ldquo;{name}&rdquo;
        </h1>
        {episodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items found.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {episodes.map((e) => (
              <ItemCard key={e.id} episode={e} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
