"use client"

import { useEffect, useRef, useState } from "react"
import { findActiveSegmentIndex, type TimedSegment } from "@/lib/transcript/active-segment"
import { formatTimestamp } from "@/lib/format"

/**
 * Renders a transcript that follows playback: the active line (per `currentSec`)
 * is highlighted and auto-scrolled into view. Auto-scroll pauses while the user
 * is manually scrolling and offers a "Jump to current" affordance to resume.
 * Clicking any line calls `onSeek`.
 */
export function LiveTranscript({
  segments,
  currentSec,
  onSeek,
}: {
  segments: TimedSegment[]
  currentSec: number
  onSeek: (sec: number) => void
}) {
  const activeIndex = findActiveSegmentIndex(segments, currentSec)
  const activeRef = useRef<HTMLParagraphElement>(null)
  const [follow, setFollow] = useState(true)

  // Auto-scroll the active line into view while following.
  useEffect(() => {
    if (follow && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [activeIndex, follow])

  // Any manual wheel/touch scroll pauses following.
  useEffect(() => {
    const pause = () => setFollow(false)
    window.addEventListener("wheel", pause, { passive: true })
    window.addEventListener("touchmove", pause, { passive: true })
    return () => {
      window.removeEventListener("wheel", pause)
      window.removeEventListener("touchmove", pause)
    }
  }, [])

  return (
    <div className="relative">
      <div className="space-y-2 font-serif text-lg leading-relaxed">
        {segments.map((s, i) => {
          const active = i === activeIndex
          return (
            <p
              key={s.start ?? i}
              ref={active ? activeRef : undefined}
              className={
                active
                  ? "rounded-md bg-primary/10 px-2 py-1 transition-colors"
                  : "px-2 py-1 text-muted-foreground transition-colors"
              }
            >
              <button
                type="button"
                onClick={() => onSeek(s.start)}
                className="mr-2 font-sans text-sm tabular-nums text-muted-foreground hover:text-foreground hover:underline"
              >
                {formatTimestamp(s.start)}
              </button>
              {s.text}
            </p>
          )
        })}
      </div>

      {!follow && (
        <button
          type="button"
          onClick={() => setFollow(true)}
          className="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-full border bg-background/90 px-3 py-1.5 text-sm shadow-md backdrop-blur"
        >
          Jump to current
        </button>
      )}
    </div>
  )
}
