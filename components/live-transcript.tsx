"use client"

import { useEffect, useRef } from "react"
import {
  findActiveSegmentIndex,
  findActiveWordIndex,
  type TimedSegment,
} from "@/lib/transcript/active-segment"
import { formatTimestamp } from "@/lib/format"

/**
 * A transcript that follows playback inside its OWN scroll box (so the page —
 * and the video pinned above it — never moves). The active line is highlighted
 * and auto-scrolled to the middle of the box; within that line, the current word
 * is highlighted when per-word timing is available. Clicking a line's timestamp
 * seeks the player.
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
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLParagraphElement>(null)

  // Auto-scroll the active line to the middle of the BOX (never the page).
  useEffect(() => {
    const box = containerRef.current
    const el = activeRef.current
    if (!box || !el) return
    const top = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2
    box.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
  }, [activeIndex])

  return (
    <div
      ref={containerRef}
      className="relative max-h-[20rem] space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-4 font-serif text-lg leading-relaxed"
    >
      {segments.map((s, i) => {
        const active = i === activeIndex
        return (
          <p
            key={s.start ?? i}
            ref={active ? activeRef : undefined}
            className={active ? "transition-colors" : "text-muted-foreground transition-colors"}
          >
            <button
              type="button"
              onClick={() => onSeek(s.start)}
              className="mr-2 font-sans text-sm tabular-nums text-muted-foreground hover:text-foreground hover:underline"
            >
              {formatTimestamp(s.start)}
            </button>
            {active && s.words?.length ? (
              <SegmentWords words={s.words} currentSec={currentSec} />
            ) : (
              s.text
            )}
          </p>
        )
      })}
    </div>
  )
}

// Renders the active line word-by-word, highlighting the word at `currentSec`.
// faster-whisper word strings include their leading space, so concatenating the
// spans reproduces the original spacing.
function SegmentWords({
  words,
  currentSec,
}: {
  words: NonNullable<TimedSegment["words"]>
  currentSec: number
}) {
  const wi = findActiveWordIndex(words, currentSec)
  return (
    <>
      {words.map((w, i) => (
        <span
          key={i}
          className={i === wi ? "rounded bg-primary/20 text-foreground" : undefined}
        >
          {w.word}
        </span>
      ))}
    </>
  )
}
