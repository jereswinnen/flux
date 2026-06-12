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
            if (cancelled) return
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
