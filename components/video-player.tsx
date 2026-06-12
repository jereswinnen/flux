"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { Maximize2, Pause, Play, X } from "lucide-react"
import { formatTimestamp } from "@/lib/format"

export type PlayerChapter = { title: string; startSec: number }

type CueOpts = { startSec?: number; chapters?: PlayerChapter[]; title?: string; itemId?: string }

type VideoPlayerCtx = {
  videoId: string | null
  title: string | null
  currentSec: number
  duration: number
  playing: boolean
  ready: boolean
  seekTo: (sec: number) => void
  togglePlay: () => void
  /** Load + play a video (persists across navigation; shows the corner mini). */
  cue: (videoId: string, opts?: CueOpts) => void
  close: () => void
  /** The detail page registers its inline slot; the player overlays it while
   *  visible and docks to the corner when it scrolls away / on other pages. */
  registerSlot: (el: HTMLElement | null) => void
}

const Ctx = createContext<VideoPlayerCtx | null>(null)

export function useVideoPlayer() {
  const c = useContext(Ctx)
  if (!c) throw new Error("useVideoPlayer must be used within VideoPlayerProvider")
  return c
}

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

const MINI_MARGIN = 16

export function VideoPlayerProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [videoId, setVideoId] = useState<string | null>(null)
  const [itemId, setItemId] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [chapters, setChapters] = useState<PlayerChapter[]>([])
  const [currentSec, setCurrentSec] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [started, setStarted] = useState(false)
  const [docked, setDocked] = useState(false)
  const [closing, setClosing] = useState(false)
  const [undockGhost, setUndockGhost] = useState(false)

  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const slotRef = useRef<HTMLElement | null>(null)
  const pendingSeekRef = useRef<number | null>(null)
  const dockedRef = useRef(false)
  const videoIdRef = useRef<string | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ghostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cue = useCallback((id: string, opts?: CueOpts) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setClosing(false)
    // Already playing this video (e.g. opening its detail page from the mini):
    // don't reset — just update chapters/itemId and optionally seek.
    if (videoIdRef.current === id) {
      if (opts?.chapters) setChapters(opts.chapters)
      if (opts?.itemId) setItemId(opts.itemId)
      if (opts?.startSec != null && opts.startSec > 0) {
        playerRef.current?.seekTo(opts.startSec, true)
        playerRef.current?.playVideo()
      }
      return
    }
    videoIdRef.current = id
    pendingSeekRef.current = opts?.startSec ?? null
    setChapters(opts?.chapters ?? [])
    setTitle(opts?.title ?? null)
    setItemId(opts?.itemId ?? null)
    setStarted(false)
    setCurrentSec(0)
    setDuration(0)
    setVideoId(id)
  }, [])

  const close = useCallback(() => {
    // Play the slide/fade-out, then unmount.
    setClosing(true)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      videoIdRef.current = null
      setVideoId(null)
      setPlaying(false)
      setReady(false)
      setClosing(false)
    }, 200)
  }, [])

  const registerSlot = useCallback((el: HTMLElement | null) => {
    slotRef.current = el
  }, [])

  // Build the player when the active video changes.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !videoId) return
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
            const seek = pendingSeekRef.current
            if (typeof seek === "number" && seek > 0) {
              playerRef.current?.seekTo(seek, true)
              playerRef.current?.playVideo()
            }
            poll = setInterval(() => {
              const p = playerRef.current
              if (!p) return
              if (typeof p.getCurrentTime === "function") setCurrentSec(p.getCurrentTime())
              if (typeof p.getDuration === "function") setDuration(p.getDuration())
            }, 250)
          },
          onStateChange: (e: { data: number }) => {
            if (cancelled) return
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
    }
  }, [videoId])

  // Continuously position the (fixed) stage: overlay the registered slot while it
  // is on-screen, else dock to the corner. Styles are written imperatively each
  // frame to avoid per-frame React renders; docked state flips only on change.
  useEffect(() => {
    if (!videoId) return
    let raf = 0
    const place = () => {
      const stage = stageRef.current
      if (stage) {
        const slot = slotRef.current
        const rect = slot?.getBoundingClientRect()
        const inline =
          !!rect && rect.bottom > 80 && rect.top < window.innerHeight - 8 && rect.width > 0
        if (inline && rect) {
          stage.style.top = `${rect.top}px`
          stage.style.left = `${rect.left}px`
          stage.style.width = `${rect.width}px`
          stage.style.height = `${rect.height}px`
          stage.style.borderRadius = "0.5rem"
        } else {
          const w = window.innerWidth >= 768 ? 448 : 288
          const h = Math.round((w * 9) / 16)
          stage.style.top = `${window.innerHeight - h - MINI_MARGIN}px`
          stage.style.left = `${window.innerWidth - w - MINI_MARGIN}px`
          stage.style.width = `${w}px`
          stage.style.height = `${h}px`
          stage.style.borderRadius = "0.75rem"
        }
        if (inline !== !dockedRef.current) {
          const wasDocked = dockedRef.current
          dockedRef.current = !inline
          setDocked(!inline)
          // Un-docking back to the inline slot: the real iframe returns inline
          // instantly (where the user is looking); a corner thumbnail ghost slides
          // out so the mini's dismissal still animates.
          if (wasDocked && inline) {
            setUndockGhost(true)
            if (ghostTimerRef.current) clearTimeout(ghostTimerRef.current)
            ghostTimerRef.current = setTimeout(() => setUndockGhost(false), 220)
          }
        }
      }
      raf = requestAnimationFrame(place)
    }
    raf = requestAnimationFrame(place)
    return () => cancelAnimationFrame(raf)
  }, [videoId])

  const seekTo = useCallback((sec: number) => {
    const p = playerRef.current
    if (p && typeof p.seekTo === "function") {
      p.seekTo(sec, true)
      p.playVideo()
    }
  }, [])

  const togglePlay = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    if (typeof p.getPlayerState === "function" && p.getPlayerState() === 1) p.pauseVideo()
    else p.playVideo()
  }, [])

  return (
    <Ctx.Provider
      value={{
        videoId,
        title,
        currentSec,
        duration,
        playing,
        ready,
        seekTo,
        togglePlay,
        cue,
        close,
        registerSlot,
      }}
    >
      {children}

      {videoId && (
        <div
          ref={stageRef}
          className={
            "group fixed z-30 overflow-hidden bg-black " +
            (docked ? "shadow-2xl ring-1 ring-black/10 " : "") +
            // Animate only the corner mini's appearance/dismissal (the inline
            // overlay just tracks the slot). No transition on position → no zoom.
            (closing
              ? "animate-out fade-out slide-out-to-bottom-3"
              : docked
                ? "animate-in fade-in slide-in-from-bottom-3"
                : "")
          }
          style={{ top: 0, left: 0, width: 0, height: 0 }}
        >
          <div ref={hostRef} className="pointer-events-none size-full" />
          <VideoControls chapters={chapters} />

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
            <div className="absolute right-1 top-1 z-40 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              {itemId && (
                <button
                  type="button"
                  onClick={() => router.push(`/episodes/${itemId}`)}
                  aria-label="Open video page"
                  className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
                >
                  <Maximize2 className="size-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={close}
                aria-label="Close player"
                className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Corner ghost that slides out when un-docking back to the inline slot — the
          real iframe is already inline, so this only animates the mini's exit. */}
      {undockGhost && videoId && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-30 aspect-video w-80 overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-black/10 animate-out fade-out slide-out-to-bottom-3 md:w-[28rem]">
          <img
            src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
            alt=""
            className="size-full object-cover"
          />
        </div>
      )}
    </Ctx.Provider>
  )
}

function VideoControls({ chapters }: { chapters: PlayerChapter[] }) {
  const { currentSec, duration, playing, togglePlay, seekTo } = useVideoPlayer()
  const pct = duration > 0 ? Math.min(100, (currentSec / duration) * 100) : 0
  const ticks = chapters.filter((c) => c.startSec > 0 && c.startSec <= duration)

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
      <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/60 to-transparent" />

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
          {ticks.map((c, i) => (
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
