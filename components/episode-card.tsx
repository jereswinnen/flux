"use client"

import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatRelativeDate } from "@/lib/format"

export type LibEpisode = {
  id: string
  title: string
  podcastName: string | null
  artworkUrl: string | null
  status: string
  publishedAt: string | null
  createdAt: string
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "ready") return "default"
  if (status === "failed") return "destructive"
  return "secondary"
}

export function EpisodeCard({ episode }: { episode: LibEpisode }) {
  const inFlight = !["ready", "failed"].includes(episode.status)
  return (
    <Link href={`/episodes/${episode.id}`} className="group">
      <Card className="overflow-hidden p-0 transition-colors hover:border-foreground/20">
        <div className="aspect-square w-full overflow-hidden bg-muted">
          {episode.artworkUrl ? (
            <img
              src={episode.artworkUrl}
              alt=""
              className="size-full object-cover transition-transform group-hover:scale-105"
            />
          ) : null}
        </div>
        <div className="space-y-1 p-3">
          <div className="flex items-start justify-between gap-2">
            <span className="line-clamp-2 text-sm font-medium">{episode.title}</span>
            <Badge variant={statusVariant(episode.status)} className={inFlight ? "animate-pulse" : ""}>
              {episode.status}
            </Badge>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {episode.podcastName} {episode.publishedAt ? `· ${formatRelativeDate(episode.publishedAt)}` : ""}
          </div>
        </div>
      </Card>
    </Link>
  )
}
