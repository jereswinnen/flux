"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePlayer } from "@/components/player-context"
import { formatTimestamp } from "@/lib/format"

// Circular playback-progress ring wrapping the artwork.
function ProgressRing({ pct, children }: { pct: number; children: ReactNode }) {
  const r = 18
  const circ = 2 * Math.PI * r
  const offset = circ - (Math.max(0, Math.min(100, pct)) / 100) * circ
  return (
    <div className="relative size-10 shrink-0">
      <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 40 40" aria-hidden>
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="2.5" className="stroke-muted" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="stroke-primary transition-[stroke-dashoffset] duration-300 ease-linear"
        />
      </svg>
      <div className="absolute inset-[4px] overflow-hidden rounded-full bg-muted">{children}</div>
    </div>
  )
}

export function GlobalPlayer() {
  const { track, playing, current, duration, toggle, seek, scrub } = usePlayer()
  if (!track) return null

  function seekFromEvent(e: React.PointerEvent<HTMLDivElement>) {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    scrub(fraction * duration)
  }
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    seekFromEvent(e)
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.buttons === 0 && e.pointerType === "mouse") return
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    seekFromEvent(e)
  }

  const pct = duration ? (current / duration) * 100 : 0

  return (
    <div className="pointer-events-none mx-auto w-[calc(100%-1.5rem)] max-w-3xl shrink-0 pb-4 md:pb-6">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border bg-background/80 px-3 py-2 shadow-lg ring-1 ring-black/5 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 md:px-4">
      <Link
        href={`/items/${track.itemId}`}
        className="flex min-w-0 max-w-[28%] items-center gap-2 shrink-0"
      >
        <ProgressRing pct={pct}>
          {track.artworkUrl ? (
            <img src={track.artworkUrl} alt="" className="size-full object-cover" />
          ) : null}
        </ProgressRing>
        <span className="truncate text-sm font-medium">{track.title}</span>
      </Link>

      <Button
        size="icon"
        onClick={toggle}
        className="size-9 shrink-0 rounded-full"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="size-4 translate-x-px fill-current" />
        )}
      </Button>

      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatTimestamp(current)}
      </span>

      <div className="relative h-4 flex-1 cursor-pointer touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
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
    </div>
  )
}
