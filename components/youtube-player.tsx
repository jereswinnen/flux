"use client"

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Pause, Play } from "lucide-react"
import { formatTimestamp } from "@/lib/format"

type YouTubePlayerCtx = {
  currentSec: number
  duration: number
  playing: boolean
  ready: boolean
  seekTo: (sec: number) => void
  togglePlay: () => void
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
  getDuration: () => number
  getPlayerState: () => number
  seekTo: (sec: number, allowSeekAhead: boolean) => void
  playVideo: () => void
  pauseVideo: () => void
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
    // If the script fails to load, resolve anyway (callers guard on window.YT)
    // and clear the cached promise so a later remount can retry.
    tag.onerror = () => {
      apiPromise = null
      resolve()
    }
    document.head.appendChild(tag)
  })
  return apiPromise
}

/**
 * Owns the YouTube IFrame player for one detail page. The IFrame runs with
 * `controls: 0` (no YouTube chrome); we render our own minimal controls overlay
 * instead. A persistent host node docks to the bottom-right when its in-flow
 * sentinel scrolls off, so playback + transcript sync are never interrupted.
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
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [minimized, setMinimized] = useState(false)

  // Instantiate the player once per videoId. The YouTube IFrame API REPLACES the
  // element it's handed with an <iframe>. If that element were React-managed,
  // React's reconciler would later try to operate on a node that no longer exists
  // where it expects (e.g. inserting the docked-state button as a sibling) and
  // throw "NotFoundError". So we append an imperative child that React doesn't
  // track and let the API replace THAT, leaving React's host div untouched.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let poll: ReturnType<typeof setInterval> | null = null
    const target = document.createElement("div")
    target.className = "size-full"
    host.appendChild(target)
    void loadYouTubeApi().then(() => {
      if (cancelled || !window.YT) return
      playerRef.current = new window.YT.Player(target, {
        videoId,
        // controls:0 → no YouTube control bar; disablekb + iv_load_policy:3 trim
        // the remaining chrome. We supply our own controls.
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          controls: 0,
          disablekb: 1,
          iv_load_policy: 3,
        },
        events: {
          onReady: () => {
            if (cancelled) return
            setReady(true)
            poll = setInterval(() => {
              const p = playerRef.current
              if (!p) return
              if (typeof p.getCurrentTime === "function") setCurrentSec(p.getCurrentTime())
              if (typeof p.getDuration === "function") setDuration(p.getDuration())
            }, 250)
          },
          // YT.PlayerState.PLAYING === 1
          onStateChange: (e: { data: number }) => {
            if (!cancelled) setPlaying(e.data === 1)
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
      // Clear any iframe the API left inside our React-owned host so React never
      // sees foreign nodes.
      try {
        while (host.firstChild) host.removeChild(host.firstChild)
      } catch {
        /* ignore */
      }
      setReady(false)
      setPlaying(false)
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

  function togglePlay() {
    const p = playerRef.current
    if (!p) return
    if (typeof p.getPlayerState === "function" && p.getPlayerState() === 1) p.pauseVideo()
    else p.playVideo()
  }

  return (
    <Ctx.Provider value={{ currentSec, duration, playing, ready, seekTo, togglePlay }}>
      {/* In-flow sentinel that also reserves the video's space (16:9). */}
      <div ref={sentinelRef} className="mb-4 aspect-video w-full" aria-hidden={minimized}>
        {/* The persistent player wrapper. Same node whether docked or inline. */}
        <div
          className={
            minimized
              ? "group fixed bottom-4 right-4 z-30 aspect-video w-80 overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-black/10 duration-200 ease-out animate-in fade-in slide-in-from-bottom-2 md:w-[28rem]"
              : "group relative aspect-video w-full overflow-hidden rounded-lg bg-black"
          }
        >
          <div ref={hostRef} className="pointer-events-none size-full" />
          <PlayerControls />
          {minimized && (
            <button
              type="button"
              onClick={() => sentinelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="absolute right-1 top-1 z-20 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="Back to top"
            >
              ↑
            </button>
          )}
        </div>
      </div>
      {children}
    </Ctx.Provider>
  )
}

// Custom controls drawn over the (chrome-free) iframe: click-to-toggle, a center
// play affordance when paused, and a bottom bar with play/pause, scrub, and time.
// Hidden until hover while playing; always shown when paused.
function PlayerControls() {
  const { currentSec, duration, playing, togglePlay, seekTo } = useYouTubePlayer()
  const pct = duration > 0 ? Math.min(100, (currentSec / duration) * 100) : 0

  function onScrub(e: React.MouseEvent<HTMLDivElement>) {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    seekTo(Math.max(0, Math.min(1, frac)) * duration)
  }

  return (
    <div
      data-paused={!playing}
      className="absolute inset-0 z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100 data-[paused=true]:opacity-100"
    >
      {/* Click anywhere on the video to toggle play. */}
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={togglePlay}
        className="absolute inset-0 size-full"
      />

      {/* Center play affordance while paused. */}
      {!playing && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/50 p-3">
            <Play className="size-6 translate-x-0.5 fill-white text-white" />
          </span>
        </span>
      )}

      {/* Bottom control bar. */}
      <div
        className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="shrink-0 text-white"
        >
          {playing ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="size-4 translate-x-px fill-current" />
          )}
        </button>
        <div
          className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-white/30"
          onClick={onScrub}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-white/90">
          {formatTimestamp(currentSec)} / {formatTimestamp(duration)}
        </span>
      </div>
    </div>
  )
}
