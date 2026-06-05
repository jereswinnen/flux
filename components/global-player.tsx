"use client"

import Link from "next/link"
import { Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePlayer } from "@/components/player-context"
import { formatTimestamp } from "@/lib/format"

export function GlobalPlayer() {
  const { track, playing, current, duration, toggle, seek, scrub } = usePlayer()
  if (!track) return null

  function onScrub(e: React.MouseEvent<HTMLDivElement>) {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    scrub(Math.max(0, Math.min(1, frac)) * duration)
  }

  const pct = duration ? (current / duration) * 100 : 0

  return (
    <div className="sticky bottom-0 z-30 flex items-center gap-3 border-t bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
      <Link
        href={`/episodes/${track.episodeId}`}
        className="flex min-w-0 max-w-[28%] items-center gap-2 shrink-0"
      >
        <div className="size-9 shrink-0 overflow-hidden rounded bg-muted">
          {track.artworkUrl ? (
            <img src={track.artworkUrl} alt="" className="size-full object-cover" />
          ) : null}
        </div>
        <span className="truncate text-sm font-medium">{track.title}</span>
      </Link>

      <Button
        size="icon"
        variant="secondary"
        onClick={toggle}
        className="size-9 shrink-0 rounded-full"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>

      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatTimestamp(current)}
      </span>

      <div className="relative h-4 flex-1 cursor-pointer" onClick={onScrub}>
        <div className="absolute inset-y-0 my-auto h-1.5 w-full rounded-full bg-muted" />
        <div
          className="absolute inset-y-0 my-auto h-1.5 rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
        {duration > 0 &&
          track.markers
            .filter((m) => m.sec >= 0 && m.sec <= duration)
            .map((m, i) => (
              <button
                key={i}
                type="button"
                title={m.label}
                aria-label={`Jump to ${formatTimestamp(m.sec)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  seek(m.sec)
                }}
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-foreground transition-transform hover:scale-150"
                style={{ left: `${(m.sec / duration) * 100}%` }}
              />
            ))}
      </div>

      <span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatTimestamp(duration)}
      </span>
    </div>
  )
}
