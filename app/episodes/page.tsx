import Link from "next/link"
import { episodeRepo } from "@/lib/db/episodes"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { formatDate } from "@/lib/format"

export const dynamic = "force-dynamic"

export default async function EpisodesPage() {
  const episodes = await episodeRepo.list()
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Archive</h1>
        <Link href="/" className="text-sm underline">
          Add episode
        </Link>
      </div>
      {episodes.length === 0 && <p className="text-muted-foreground">No episodes yet.</p>}
      {episodes.map((e) => (
        <Link key={e.id} href={`/episodes/${e.id}`}>
          <Card className="flex items-center justify-between p-4 hover:bg-accent">
            <div className="min-w-0">
              <div className="truncate font-medium">{e.title}</div>
              <div className="text-muted-foreground text-sm">
                {e.podcastName} · {formatDate(e.publishedAt?.toISOString())}
              </div>
            </div>
            <Badge variant={e.status === "ready" ? "default" : e.status === "failed" ? "destructive" : "secondary"}>
              {e.status}
            </Badge>
          </Card>
        </Link>
      ))}
    </div>
  )
}
