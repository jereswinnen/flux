"use client"

import { useEffect, useRef, useState } from "react"
import {
  findActiveSegmentIndex,
  findActiveWordIndex,
  type TimedSegment,
} from "@/lib/transcript/active-segment"
import { formatTimestamp } from "@/lib/format"

/**
 * A transcript that follows playback inside its OWN scroll box (the page — and
 * the video pinned above it — never moves). The active line is smoothly scrolled
 * to the middle of the box and, when per-word timing is available, the current
 * word is highlighted. Manually scrolling the box pauses following (a "Jump to
 * live" pill resumes it); clicking any line seeks the player to that moment.
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
  const [follow, setFollow] = useState(true)
  // True while WE are smooth-scrolling, so the scroll handler can tell our own
  // scrolls apart from the user's.
  const programmatic = useRef(false)

  useEffect(() => {
    if (!follow) return
    const box = containerRef.current
    const el = activeRef.current
    if (!box || !el) return
    const top = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2
    programmatic.current = true
    box.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
    const t = window.setTimeout(() => {
      programmatic.current = false
    }, 700)
    return () => window.clearTimeout(t)
  }, [activeIndex, follow])

  function onScroll() {
    // A user scroll (not one of ours) pauses following.
    if (!programmatic.current) setFollow(false)
  }

  function seekToLine(sec: number) {
    onSeek(sec)
    setFollow(true) // clicking a line resumes live-follow
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="max-h-[20rem] space-y-1 overflow-y-auto scroll-smooth rounded-lg border bg-muted/20 p-4 font-serif text-lg leading-relaxed"
      >
        {segments.map((s, i) => {
          const active = i === activeIndex
          return (
            <p
              key={s.start ?? i}
              ref={active ? activeRef : undefined}
              onClick={() => seekToLine(s.start)}
              className={
                "cursor-pointer rounded-md px-2 py-1 transition-colors hover:bg-muted/70 " +
                (active ? "" : "text-muted-foreground")
              }
            >
              <span className="mr-2 select-none font-sans text-sm tabular-nums text-muted-foreground">
                {formatTimestamp(s.start)}
              </span>
              {active && s.words?.length ? (
                <SegmentWords words={s.words} currentSec={currentSec} />
              ) : (
                s.text
              )}
            </p>
          )
        })}
      </div>

      {!follow && (
        <button
          type="button"
          onClick={() => setFollow(true)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border bg-background/90 px-3 py-1 text-xs font-medium shadow-md backdrop-blur transition-colors hover:bg-background"
        >
          Jump to live ↓
        </button>
      )}
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
          className={
            i === wi ? "rounded bg-primary/20 text-foreground transition-colors" : undefined
          }
        >
          {w.word}
        </span>
      ))}
    </>
  )
}
