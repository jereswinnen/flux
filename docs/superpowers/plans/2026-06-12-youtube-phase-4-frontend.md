# YouTube Phase 4 — Detail Page Video Player + Live-Reading Transcript — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** On a YouTube item's detail page, show the video at the top (Layout A), with a **live-reading transcript** that highlights + auto-scrolls the current line as the video plays and seeks the video on click; the video **minimizes to a fixed bottom-right mini-player** when scrolled past (playback uninterrupted). Podcast pages are unchanged.

**Architecture:** A **page-local** YouTube player (the global audio bar is for podcasts and stays as-is). `YouTubePlayerProvider` loads the IFrame Player API, owns one persistent `<div>` host (never unmounted, so playback survives repositioning), exposes `{ currentSec, seekTo, ready }` via context, and docks itself bottom-right via an `IntersectionObserver` sentinel + a flow spacer. A source-agnostic `LiveTranscript` consumes `currentSec`/`onSeek`. `EpisodeView` branches on `item.type`: `youtube` → video-at-top layout; otherwise the existing audio layout.

**Tech Stack:** Next.js 16 (client components), YouTube IFrame Player API, Vitest (pure helper only), Tailwind/shadcn (match existing `EpisodeView` styling).

---

## Scope & Boundaries

- **In scope:** active-segment pure helper (+ tests); `YouTubePlayerProvider` + stage/minimize; `LiveTranscript`; `EpisodeView` youtube branch; detail page passes `type` + `videoId`.
- **Out of scope / unchanged:** podcast playback (global audio bar, `usePlayer`), insights rendering (`EpisodeInsights` reused), the ingest/pipeline/Modal work (Phases 1–3).
- **Verification reality:** the IFrame integration is verifiable only by `npm run build` (compiles) + **manual browser test**, and a real end-to-end YouTube item requires **Phase 3 deployed** (so an item reaches `ready` with a `videoId`). The pure active-segment logic is unit-tested. This is inherent to browser/IFrame code.
- **Design fidelity:** match the existing `EpisodeView` Tailwind/shadcn patterns (tabs, sticky bars, serif transcript). No new design language.

## File Structure

- **Create:** `lib/transcript/active-segment.ts` (+ `test/transcript/active-segment.test.ts`), `components/youtube-player.tsx`, `components/live-transcript.tsx`.
- **Modify:** `components/episode-view.tsx` (youtube branch + `type`/`videoId` props), `app/episodes/[id]/page.tsx` (pass `type` + `videoId`).

---

## Task 1: Active-segment lookup (pure, TDD)

**Files:** Create `lib/transcript/active-segment.ts`, `test/transcript/active-segment.test.ts`.

- [ ] **Step 1: Write `test/transcript/active-segment.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { findActiveSegmentIndex } from "@/lib/transcript/active-segment"

const segs = [
  { start: 0, end: 5, text: "a" },
  { start: 5, end: 10, text: "b" },
  { start: 10, end: 20, text: "c" },
]

describe("findActiveSegmentIndex", () => {
  it("returns -1 before the first segment / empty", () => {
    expect(findActiveSegmentIndex(segs, -1)).toBe(-1)
    expect(findActiveSegmentIndex([], 3)).toBe(-1)
  })
  it("finds the segment containing the time", () => {
    expect(findActiveSegmentIndex(segs, 0)).toBe(0)
    expect(findActiveSegmentIndex(segs, 4.9)).toBe(0)
    expect(findActiveSegmentIndex(segs, 5)).toBe(1)
    expect(findActiveSegmentIndex(segs, 12)).toBe(2)
  })
  it("clamps to the last segment past the end", () => {
    expect(findActiveSegmentIndex(segs, 999)).toBe(2)
  })
  it("uses next.start as the boundary when segments have gaps", () => {
    const gapped = [
      { start: 0, end: 2, text: "a" },
      { start: 8, end: 10, text: "b" },
    ]
    // 5s falls in the gap — belongs to the segment whose start is <= t (index 0)
    expect(findActiveSegmentIndex(gapped, 5)).toBe(0)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** `npm test -- test/transcript/active-segment.test.ts`

- [ ] **Step 3: Implement `lib/transcript/active-segment.ts`**

```ts
export interface TimedSegment {
  start: number
  end: number
  text: string
}

/**
 * Index of the segment "active" at `currentSec`: the last segment whose `start`
 * is <= currentSec (binary search). Returns -1 before the first segment or for an
 * empty list. Robust to gaps (a time in a gap belongs to the preceding segment)
 * and clamps to the last segment past the end.
 */
export function findActiveSegmentIndex(segments: TimedSegment[], currentSec: number): number {
  const n = segments.length
  if (n === 0 || currentSec < segments[0].start) return -1
  let lo = 0
  let hi = n - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segments[mid].start <= currentSec) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add lib/transcript/active-segment.ts test/transcript/active-segment.test.ts
git commit -m "feat(transcript): active-segment binary search + tests"
```

---

## Task 2: YouTube IFrame player + page-local context + minimize-on-scroll

**Files:** Create `components/youtube-player.tsx`.

- [ ] **Step 1: Create `components/youtube-player.tsx`**

```tsx
"use client"

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

type YouTubePlayerCtx = {
  currentSec: number
  ready: boolean
  seekTo: (sec: number) => void
}

const Ctx = createContext<YouTubePlayerCtx | null>(null)

export function useYouTubePlayer() {
  const c = useContext(Ctx)
  if (!c) throw new Error("useYouTubePlayer must be used within YouTubePlayerProvider")
  return c
}

// Minimal IFrame API surface (avoids adding @types/youtube).
type YTPlayer = {
  getCurrentTime: () => number
  seekTo: (sec: number, allowSeekAhead: boolean) => void
  playVideo: () => void
  destroy: () => void
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer }
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<void> | null = null
function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  if (window.YT?.Player) return Promise.resolve()
  if (apiPromise) return apiPromise
  apiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    const tag = document.createElement("script")
    tag.src = "https://www.youtube.com/iframe_api"
    document.head.appendChild(tag)
  })
  return apiPromise
}

/**
 * Owns the YouTube IFrame player for one detail page. Renders a persistent host
 * node (never unmounted) inside a wrapper that docks to the bottom-right when its
 * in-flow sentinel scrolls out of view, so playback + transcript sync are never
 * interrupted. Exposes currentSec/seekTo via context for the live transcript.
 */
export function YouTubePlayerProvider({
  videoId,
  children,
}: {
  videoId: string
  children: ReactNode
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const [ready, setReady] = useState(false)
  const [currentSec, setCurrentSec] = useState(0)
  const [minimized, setMinimized] = useState(false)

  // Instantiate the player once per videoId.
  useEffect(() => {
    let cancelled = false
    let poll: ReturnType<typeof setInterval> | null = null
    void loadYouTubeApi().then(() => {
      if (cancelled || !hostRef.current || !window.YT) return
      playerRef.current = new window.YT.Player(hostRef.current, {
        videoId,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            setReady(true)
            poll = setInterval(() => {
              const p = playerRef.current
              if (p && typeof p.getCurrentTime === "function") {
                setCurrentSec(p.getCurrentTime())
              }
            }, 250)
          },
        },
      })
    })
    return () => {
      cancelled = true
      if (poll) clearInterval(poll)
      try {
        playerRef.current?.destroy()
      } catch {
        /* ignore */
      }
      playerRef.current = null
      setReady(false)
    }
  }, [videoId])

  // Dock to bottom-right when the sentinel (the video's in-flow slot) scrolls off.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const io = new IntersectionObserver(
      ([entry]) => setMinimized(!entry.isIntersecting),
      { threshold: 0 },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [])

  function seekTo(sec: number) {
    const p = playerRef.current
    if (p && typeof p.seekTo === "function") {
      p.seekTo(sec, true)
      p.playVideo()
    }
  }

  return (
    <Ctx.Provider value={{ currentSec, ready, seekTo }}>
      {/* In-flow sentinel that also reserves the video's space (16:9). */}
      <div ref={sentinelRef} className="mb-4 aspect-video w-full" aria-hidden={minimized}>
        {/* The persistent player wrapper. Same node whether docked or inline. */}
        <div
          className={
            minimized
              ? "fixed bottom-4 right-4 z-30 aspect-video w-64 overflow-hidden rounded-lg bg-black shadow-xl ring-1 ring-black/10 md:w-80"
              : "aspect-video w-full overflow-hidden rounded-lg bg-black"
          }
        >
          {minimized && (
            <button
              type="button"
              onClick={() => sentinelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="absolute right-1 top-1 z-10 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white"
              aria-label="Back to top"
            >
              ↑
            </button>
          )}
          <div ref={hostRef} className="size-full" />
        </div>
      </div>
      {children}
    </Ctx.Provider>
  )
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` clean for this file (no `any` introduced; the minimal `YTPlayer`/`window.YT` types cover usage).

- [ ] **Step 3: Commit**

```bash
git add components/youtube-player.tsx
git commit -m "feat(player): page-local YouTube IFrame player with bottom-right minimize"
```

---

## Task 3: LiveTranscript component (source-agnostic)

**Files:** Create `components/live-transcript.tsx`.

- [ ] **Step 1: Create `components/live-transcript.tsx`**

```tsx
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
```

- [ ] **Step 2: Typecheck** clean.

- [ ] **Step 3: Commit**

```bash
git add components/live-transcript.tsx
git commit -m "feat(transcript): live-reading transcript (highlight + auto-scroll + seek)"
```

---

## Task 4: Wire into the detail page + EpisodeView youtube branch

**Files:** Modify `app/episodes/[id]/page.tsx`, `components/episode-view.tsx`.

- [ ] **Step 1: Pass `type` + `videoId` from the page**

In `app/episodes/[id]/page.tsx`, add to the `episode` prop object:
```ts
          type: episode.type,
          videoId: episode.sourceMetadata?.videoId ?? null,
```

- [ ] **Step 2: Extend `EpisodeViewProps` in `components/episode-view.tsx`**

Add to the `episode` object type (after `sourceUrl`):
```ts
    type: string
    videoId: string | null
```

- [ ] **Step 3: Add the youtube branch in `EpisodeView`**

Add imports at the top:
```ts
import { YouTubePlayerProvider, useYouTubePlayer } from "@/components/youtube-player"
import { LiveTranscript } from "@/components/live-transcript"
```

Inside `EpisodeView`, compute:
```ts
  const isYouTube = episode.type === "youtube" && !!episode.videoId
```

Replace the transcript-present render branch (the `<Tabs>` block, currently rendered when `transcript` is truthy) so that for YouTube items the video + live transcript layout is used. Concretely, when `transcript` exists:

- If `isYouTube`, render a dedicated subtree that wraps the tabs in `YouTubePlayerProvider` and uses a `LiveTranscript` driven by the player. Because the live transcript needs the player context, extract a small inner component:

```tsx
function YouTubeBody({
  videoId,
  transcript,
  insights,
  entities,
}: {
  videoId: string
  transcript: { segments: Segment[] }
  insights: Insights
  entities: MentionedEntity[]
}) {
  const [tab, setTab] = useState("transcript")
  return (
    <YouTubePlayerProvider videoId={videoId}>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="sticky top-0 z-10 -mx-4 mb-2 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6">
          <TabsList>
            <TabsTrigger value="transcript">Live Transcript</TabsTrigger>
            <TabsTrigger value="insights">Insights</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="transcript" className="pb-10 pt-2">
          <LiveTranscriptBound segments={transcript.segments} />
        </TabsContent>
        <TabsContent value="insights" className="pb-10 pt-2">
          <EpisodeInsightsBound insights={insights} entities={entities} />
        </TabsContent>
      </Tabs>
    </YouTubePlayerProvider>
  )
}

function LiveTranscriptBound({ segments }: { segments: Segment[] }) {
  const { currentSec, seekTo } = useYouTubePlayer()
  return <LiveTranscript segments={segments} currentSec={currentSec} onSeek={seekTo} />
}

function EpisodeInsightsBound({ insights, entities }: { insights: Insights; entities: MentionedEntity[] }) {
  const { seekTo } = useYouTubePlayer()
  return <EpisodeInsights insights={insights} entities={entities} onSeek={seekTo} />
}
```

Then in `EpisodeView`'s render, where the `transcript` branch begins, dispatch:
```tsx
          ) : isYouTube && episode.videoId ? (
            <YouTubeBody
              videoId={episode.videoId}
              transcript={transcript}
              insights={insights}
              entities={entities}
            />
          ) : (
            <Tabs value={tab} onValueChange={setTab}>
              {/* ...existing audio/podcast tabs unchanged... */}
            </Tabs>
          )}
```

Notes for the implementer:
- Keep the existing podcast path (the `<Tabs>` with Insights/Transcript that uses `seek`→`player.cue`) **exactly as-is** for non-YouTube items.
- For YouTube, do NOT show the header "Play" button (that drives the global audio bar). Guard it: it already only renders when `track` is truthy, and `track` is null for YouTube (no `audioUrl`) — so it's naturally hidden. Confirm.
- The `InsightsNav` floating nav keys off `tab === "insights"`; for YouTube the default tab is "transcript", which is fine. Leave the existing `InsightsNav` block; it shows only when `tab === "insights"` and sections exist.
- `EpisodeInsights`'s `onSeek` for YouTube must seek the video (via `seekTo`), which `EpisodeInsightsBound` wires. The chapter/quote/timestamp clicks then drive the IFrame.

- [ ] **Step 4: Verify** — `npm run typecheck` clean; `npm run build` succeeds. (Podcast pages must still build/behave identically.)

- [ ] **Step 5: Commit**

```bash
git add app/episodes/[id]/page.tsx components/episode-view.tsx
git commit -m "feat(ui): YouTube detail layout — video on top + live transcript"
```

---

## Task 5: Verification + manual handoff

- [ ] **Step 1 (automated):** `npm test -- test/transcript/active-segment.test.ts` (pass); `npm run typecheck` (clean); `npm test` (full suite green — no existing test should break); `npm run build` (succeeds); `npm run lint` (no new errors vs. the pre-existing 11 on `main`).
- [ ] **Step 2 (MANUAL — user; needs Phase 3 deployed):**
  1. With a deployed YouTube Modal function, add a short public YouTube video; wait for `ready`.
  2. Open its detail page → confirm the video plays at the top; the **Live Transcript** tab highlights + auto-scrolls the current line; clicking a line/timestamp/chapter seeks the video; scrolling down docks the video to **bottom-right** still playing; "↑" / "Jump to current" restore.
  3. Confirm a **podcast** detail page is visually + behaviorally unchanged (audio bottom bar, static transcript).

---

## Self-Review (plan author)

- **Spec coverage:** Layout A (video top + Insights/Live-Transcript tabs) ✅; live-reading transcript (highlight + auto-scroll + user-scroll guard + jump-to-current) ✅; click-to-seek incl. chapters/quotes/timestamps ✅; bottom-right minimize-on-scroll with uninterrupted playback ✅; podcast path untouched ✅; pure logic unit-tested ✅.
- **Design decision (flagged):** page-local YouTube player instead of forcing YouTube into the global audio `usePlayer` — matches the approved mockups (video-at-top + minimize is inherently page-local) and avoids disturbing podcast playback. Diverges from the spec's literal "generalize usePlayer" wording; the UX is what was actually agreed.
- **Placeholder scan:** Task 4 references "existing audio tabs unchanged" rather than repeating them — intentional (the implementer must preserve the current block verbatim; it's in the file). All NEW code is given in full.
- **Verification honesty:** IFrame behavior is build + manual-verified; full end-to-end needs Phase 3 deployed. Pure active-segment logic is unit-tested.
- **Type note:** `EpisodeViewProps.episode` gains `type`/`videoId`; the page reads `episode.sourceMetadata?.videoId` (the `items` row type from Phase 1 has `sourceMetadata`).
