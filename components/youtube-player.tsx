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

export type PlayerChapter = { title: string; startSec: number }

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
    tag.onerror = () => {
      apiPromise = null
      resolve()
    }
    document.head.appendChild(tag)
  })
  return apiPromise
}

/**
 * Owns the YouTube IFrame player for one detail page. The IFrame runs chrome-free
 * (`controls: 0`); we render our own controls + a poster cover so YouTube's
 * unstarted/paused UI never shows. A persistent host node docks bottom-right when
 * its in-flow sentinel scrolls off, so playback + transcript sync never break.
 */
export function YouTubePlayerProvider({
  videoId,
  chapters,
  children,
}: {
  videoId: string
  chapters?: PlayerChapter[]
  children: ReactNode
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const [ready, setReady] = useState(false)
  const [currentSec, setCurrentSec] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false) // has playback ever begun?
  const [minimized, setMinimized] = useState(false)
  // On un-dock, the real player returns inline instantly (no empty-slot flicker);
  // a lightweight thumbnail "ghost" slides out of the corner so the exit still
  // animates as the reverse of the dock-in.
  const [closing, setClosing] = useState(false)
  const docked = minimized
  const wasOffRef = useRef(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Instantiate once per videoId. The YouTube API REPLACES the element it's given
  // with an <iframe>; handing it a React-managed node makes React's reconciler
  // throw "NotFoundError" later. So we append an imperative child it can replace,
  // leaving our host div untouched.
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
          onStateChange: (e: { data: number }) => {
            if (cancelled) return
            // YT.PlayerState.PLAYING === 1
            setPlaying(e.data === 1)
            if (e.data === 1) setStarted(true)
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
      try {
        while (host.firstChild) host.removeChild(host.firstChild)
      } catch {
        /* ignore */
      }
      setReady(false)
      setPlaying(false)
      setStarted(false)
    }
  }, [videoId])

  // Dock to bottom-right when the sentinel (the video's in-flow slot) scrolls off.
  // On the off→on transition (un-dock) fire the ghost exit. State is set in the
  // observer callback (not the effect body) to avoid cascading-render lint.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const io = new IntersectionObserver(
      ([entry]) => {
        const off = !entry.isIntersecting
        setMinimized(off)
        if (!off && wasOffRef.current) {
          if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
          setClosing(true)
          closeTimerRef.current = setTimeout(() => setClosing(false), 220)
        }
        wasOffRef.current = off
      },
      { threshold: 0 },
    )
    io.observe(sentinel)
    return () => {
      io.disconnect()
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
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
      <div ref={sentinelRef} className="mb-4 aspect-video w-full" aria-hidden={docked}>
        <div
          className={
            docked
              ? "group fixed bottom-4 right-4 z-30 aspect-video w-80 overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-black/10 transition-none animate-in fade-in slide-in-from-bottom-3 md:w-[28rem]"
              : "group relative aspect-video w-full overflow-hidden rounded-lg bg-black transition-none"
          }
        >
          <div ref={hostRef} className="pointer-events-none size-full" />
          <PlayerControls chapters={chapters} />

          {/* Poster cover until playback first starts — hides YouTube's unstarted
              chrome (thumbnail + big play button + title) behind our own. */}
          {!started && (
            <button
              type="button"
              onClick={togglePlay}
              aria-label="Play"
              className="absolute inset-0 z-20 size-full"
            >
              <img
                src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
                alt=""
                className="size-full object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                <span className="rounded-full bg-black/60 p-4">
                  <Play className="size-7 translate-x-0.5 fill-white text-white" />
                </span>
              </span>
            </button>
          )}

          {docked && (
            <button
              type="button"
              onClick={() => sentinelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="absolute right-1 top-1 z-40 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="Back to top"
            >
              ↑
            </button>
          )}
        </div>
      </div>

      {/* Ghost that slides out of the corner on un-dock (the real player is already
          back inline), so the exit animates as the reverse of the dock-in. */}
      {closing && !minimized && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-30 aspect-video w-80 overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-black/10 transition-none animate-out fade-out slide-out-to-bottom-3 md:w-[28rem]">
          <img
            src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
            alt=""
            className="size-full object-cover"
          />
        </div>
      )}
      {children}
    </Ctx.Provider>
  )
}

// Custom controls over the chrome-free iframe: click-to-toggle, center play when
// paused, a top gradient masking YouTube's pause-state title/share, and a bottom
// bar with play/pause, a scrubber (with chapter ticks), and time. Hidden while
// playing; revealed on hover; always shown when paused.
function PlayerControls({ chapters }: { chapters?: PlayerChapter[] }) {
  const { currentSec, duration, playing, togglePlay, seekTo } = useYouTubePlayer()
  const pct = duration > 0 ? Math.min(100, (currentSec / duration) * 100) : 0
  const chapterTicks = (chapters ?? []).filter((c) => c.startSec > 0 && c.startSec <= duration)

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
      {/* Masks YouTube's title/share that appear at the top on pause/hover. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/60 to-transparent" />

      {/* Click anywhere on the video to toggle play. */}
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={togglePlay}
        className="absolute inset-0 size-full"
      />

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
          {/* Chapter markers, each with a hover label above the scrubber. */}
          {chapterTicks.map((c, i) => (
            <div
              key={i}
              className="group/tick absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${(c.startSec / duration) * 100}%` }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  seekTo(c.startSec)
                }}
                aria-label={`Chapter: ${c.title}`}
                className="block size-2 rounded-full bg-white ring-1 ring-black/40 transition-transform hover:scale-150"
              />
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-black/85 px-2 py-1 text-xs font-medium text-white opacity-0 transition-opacity group-hover/tick:opacity-100">
                {c.title}
              </span>
            </div>
          ))}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-white/90">
          {formatTimestamp(currentSec)} / {formatTimestamp(duration)}
        </span>
      </div>
    </div>
  )
}
