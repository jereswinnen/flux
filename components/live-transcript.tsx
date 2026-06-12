"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  findActiveSegmentIndex,
  findActiveWordIndex,
  type TimedSegment,
} from "@/lib/transcript/active-segment"
import { formatTimestamp } from "@/lib/format"
import {
  highlightQuery,
  TranscriptSearchBar,
  useTranscriptSearch,
} from "@/components/transcript-search"

/**
 * A transcript that follows playback inside its own scroll box (the page — and
 * the video pinned above it — never moves). While playing it continuously eases
 * the active line to the middle and highlights the current word. A search bar
 * finds matches and steps through them with up/down (pausing follow). Clicking a
 * line seeks the player.
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
  const targetRef = useRef<HTMLParagraphElement>(null)
  const [follow, setFollow] = useState(true)

  const search = useTranscriptSearch(useMemo(() => segments.map((s) => s.text), [segments]))
  const searching = search.query.trim() !== ""
  // The line we keep in view: the current search match while searching, else the
  // active playback line.
  const focusIndex = searching ? search.current : activeIndex

  // Continuously ease the focus line toward the middle of the box while following
  // (and not searching). A rAF lerp gives a gentle constant glide as playback
  // advances — reads the focus element live each frame.
  useEffect(() => {
    if (!follow || searching) return
    let raf = 0
    const step = () => {
      const box = containerRef.current
      const el = targetRef.current
      if (box && el) {
        const target = Math.max(0, el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2)
        const delta = target - box.scrollTop
        if (Math.abs(delta) > 0.5) box.scrollTop = box.scrollTop + delta * 0.12
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [follow, searching])

  // Jump the current search match into view when it changes.
  useEffect(() => {
    if (!searching) return
    const box = containerRef.current
    const el = targetRef.current
    if (!box || !el) return
    box.scrollTo({
      top: Math.max(0, el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2),
      behavior: "smooth",
    })
  }, [searching, search.current])

  // Only real user input pauses following — not our own programmatic scrolls.
  function pauseFollow() {
    setFollow(false)
  }

  function seekToLine(sec: number) {
    onSeek(sec)
    setFollow(true)
  }

  return (
    <div className="relative space-y-2">
      <TranscriptSearchBar
        search={search}
        onSelect={() => {
          if (search.current >= 0) seekToLine(segments[search.current].start)
        }}
      />

      <div
        ref={containerRef}
        onWheel={pauseFollow}
        onTouchMove={pauseFollow}
        className="max-h-[20rem] space-y-1 overflow-y-auto rounded-lg border bg-muted/20 p-4 font-serif text-lg leading-relaxed"
      >
        {segments.map((s, i) => {
          const isMatch = searching && search.matchSet.has(i)
          const isCurrentMatch = searching && i === search.current
          const playbackActive = !searching && i === activeIndex
          return (
            <p
              key={s.start ?? i}
              ref={i === focusIndex ? targetRef : undefined}
              onClick={() => seekToLine(s.start)}
              data-hl-kind="transcript"
              data-hl-sec={String(s.start)}
              className={[
                "cursor-pointer rounded-md px-2 py-1 transition-colors hover:bg-muted/70",
                !isMatch && !playbackActive ? "text-muted-foreground" : "",
                isCurrentMatch ? "ring-2 ring-primary/60" : isMatch ? "bg-primary/10" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="mr-2 select-none font-sans text-sm tabular-nums text-muted-foreground">
                {formatTimestamp(s.start)}
              </span>
              {searching ? (
                highlightQuery(s.text, search.query)
              ) : playbackActive && s.words?.length ? (
                <SegmentWords words={s.words} currentSec={currentSec} />
              ) : (
                s.text
              )}
            </p>
          )
        })}
      </div>

      {!follow && !searching && (
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
