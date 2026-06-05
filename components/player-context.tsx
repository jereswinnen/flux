"use client"

import { createContext, useContext, useRef, useState, type ReactNode } from "react"

export type AudioMarker = { sec: number; label: string }
export type Track = {
  episodeId: string
  audioUrl: string
  title: string
  artworkUrl: string | null
  markers: AudioMarker[]
}

type PlayerCtx = {
  track: Track | null
  playing: boolean
  current: number
  duration: number
  play: (track: Track) => void
  toggle: () => void
  seek: (sec: number) => void
  scrub: (sec: number) => void
  cue: (track: Track, sec: number) => void
}

const Ctx = createContext<PlayerCtx | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const pendingSeek = useRef<number | null>(null)
  const [track, setTrack] = useState<Track | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  function load(next: Track, sec: number) {
    pendingSeek.current = sec
    setCurrent(0)
    setDuration(0)
    setTrack(next)
  }

  function play(next: Track) {
    if (track?.episodeId === next.episodeId) {
      void audioRef.current?.play()
      return
    }
    load(next, 0)
  }

  function cue(next: Track, sec: number) {
    if (track?.episodeId === next.episodeId) {
      const a = audioRef.current
      if (a) {
        a.currentTime = sec
        void a.play()
      }
      return
    }
    load(next, sec)
  }

  function seek(sec: number) {
    const a = audioRef.current
    if (!a) return
    a.currentTime = sec
    void a.play()
  }

  function scrub(sec: number) {
    const a = audioRef.current
    if (a) a.currentTime = sec
  }

  function toggle() {
    const a = audioRef.current
    if (!a) return
    if (a.paused) void a.play()
    else a.pause()
  }

  return (
    <Ctx.Provider value={{ track, playing, current, duration, play, toggle, seek, scrub, cue }}>
      {children}
      <audio
        ref={audioRef}
        src={track?.audioUrl}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration)
          if (pendingSeek.current != null) {
            e.currentTarget.currentTime = pendingSeek.current
            pendingSeek.current = null
            void e.currentTarget.play()
          }
        }}
        onEnded={() => setPlaying(false)}
      />
    </Ctx.Provider>
  )
}

export function usePlayer() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider")
  return ctx
}
