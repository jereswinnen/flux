"use client"

import { forwardRef, useImperativeHandle, useRef, useState } from "react"
import { Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatTimestamp } from "@/lib/format"

export type AudioPlayerHandle = { seek: (sec: number) => void }
export type AudioMarker = { sec: number; label: string }

export const AudioPlayer = forwardRef<AudioPlayerHandle, { src: string; markers?: AudioMarker[] }>(
  function AudioPlayer({ src, markers = [] }, ref) {
    const audioRef = useRef<HTMLAudioElement>(null)
    const [playing, setPlaying] = useState(false)
    const [current, setCurrent] = useState(0)
    const [duration, setDuration] = useState(0)

    function seekTo(sec: number) {
      const a = audioRef.current
      if (!a) return
      a.currentTime = sec
      void a.play()
    }

    useImperativeHandle(ref, () => ({ seek: seekTo }), [])

    function toggle() {
      const a = audioRef.current
      if (!a) return
      if (a.paused) void a.play()
      else a.pause()
    }

    function onScrub(e: React.MouseEvent<HTMLDivElement>) {
      const a = audioRef.current
      if (!a || !duration) return
      const rect = e.currentTarget.getBoundingClientRect()
      const frac = (e.clientX - rect.left) / rect.width
      a.currentTime = Math.max(0, Math.min(1, frac)) * duration
    }

    const pct = duration ? (current / duration) * 100 : 0

    return (
      <div className="flex items-center gap-3 border-b px-4 py-3 md:px-6">
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onEnded={() => setPlaying(false)}
        />
        <Button
          size="icon"
          variant="secondary"
          onClick={toggle}
          className="size-9 shrink-0 rounded-full"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {formatTimestamp(current)}
        </span>
        <div className="group relative h-4 flex-1 cursor-pointer" onClick={onScrub}>
          <div className="absolute inset-y-0 my-auto h-1.5 w-full rounded-full bg-muted" />
          <div
            className="absolute inset-y-0 my-auto h-1.5 rounded-full bg-primary"
            style={{ width: `${pct}%` }}
          />
          {duration > 0 &&
            markers
              .filter((m) => m.sec >= 0 && m.sec <= duration)
              .map((m, i) => (
                <button
                  key={i}
                  type="button"
                  title={m.label}
                  aria-label={`Jump to ${formatTimestamp(m.sec)}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    seekTo(m.sec)
                  }}
                  className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-foreground transition-transform hover:scale-150"
                  style={{ left: `${(m.sec / duration) * 100}%` }}
                />
              ))}
        </div>
        <span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatTimestamp(duration)}
        </span>
      </div>
    )
  }
)
