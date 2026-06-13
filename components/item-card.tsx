"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { hiResArtwork } from "@/lib/artwork"
import { formatRelativeDate } from "@/lib/format"

export type LibItem = {
  id: string
  title: string
  source: string | null
  artworkUrl: string | null
  status: string
  publishedAt: string | null
  createdAt?: string
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "ready") return "default"
  if (status === "failed") return "destructive"
  return "secondary"
}

export function ItemCard({ episode }: { episode: LibItem }) {
  const inFlight = !["ready", "failed"].includes(episode.status)
  const art = hiResArtwork(episode.artworkUrl)
  return (
    <Link href={`/items/${episode.id}`} className="group block w-40 shrink-0">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg border bg-muted">
        {art ? (
          <img
            src={art}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : null}
        {episode.status !== "ready" && (
          <Badge
            variant={statusVariant(episode.status)}
            className={`absolute right-2 top-2 ${inFlight ? "animate-pulse" : ""}`}
          >
            {episode.status}
          </Badge>
        )}
      </div>
      <div className="mt-2 space-y-0.5">
        <div className="line-clamp-2 text-sm font-medium leading-snug">{episode.title}</div>
        {episode.publishedAt && (
          <div className="truncate text-xs text-muted-foreground">
            {formatRelativeDate(episode.publishedAt)}
          </div>
        )}
      </div>
    </Link>
  )
}
