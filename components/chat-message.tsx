"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Copy, Play } from "lucide-react"
import { remarkTimestamps } from "@/lib/markdown/timestamps"
import { hiResArtwork } from "@/lib/artwork"
import { parseTimestamp, formatTimestamp } from "@/lib/format"
import { usePlayer } from "@/components/player-context"

export type ChatSourceRef = {
  episodeId: string
  episodeTitle: string
  startSec: number
  podcastName?: string | null
  artworkUrl?: string | null
  audioUrl?: string | null
}

export type UIMessage = {
  id?: string
  role: "user" | "assistant"
  content: string
  sources?: ChatSourceRef[] | null
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label="Copy"
      className="text-muted-foreground hover:text-foreground"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

export function ChatMessage({
  message,
  onSeek,
  pending = false,
}: {
  message: UIMessage
  onSeek?: (sec: number) => void
  pending?: boolean
}) {
  const player = usePlayer()
  const router = useRouter()

  // Start playback at a source's moment — cue the global player in place when we
  // have the audio URL, otherwise navigate to the episode (which cues on load).
  function openSource(s: ChatSourceRef) {
    if (s.audioUrl) {
      player.cue(
        {
          episodeId: s.episodeId,
          audioUrl: s.audioUrl,
          title: s.episodeTitle,
          artworkUrl: s.artworkUrl ?? null,
          markers: [],
        },
        Math.floor(s.startSec),
      )
    } else {
      router.push(`/episodes/${s.episodeId}?t=${Math.floor(s.startSec)}`)
    }
  }

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-muted px-4 py-2.5 font-serif text-base">
          {message.content}
        </div>
        <div className="px-1">
          <CopyButton text={message.content} />
        </div>
      </div>
    )
  }

  const sources = message.sources ?? []
  // Turn bare [n] citations into clickable chips (the model emits them for
  // library-wide answers). Episode [m:ss] citations are handled by remarkTimestamps.
  const content = message.content.replace(/\[(\d+)\](?!\()/g, "[$1](cite:$1)")

  // Only surface the sources the answer actually cited (keeping their original
  // numbers so the [n] chips still line up). Older messages have no [n] citations
  // — fall back to showing all retrieved sources.
  const citedNums = new Set(
    Array.from(message.content.matchAll(/\[(\d+)\]/g), (m) => Number(m[1])),
  )
  const shownSources = sources
    .map((s, i) => ({ s, n: i + 1 }))
    .filter(({ n }) => citedNums.size === 0 || citedNums.has(n))

  return (
    <div className="space-y-3">
      <div className="prose prose-lg max-w-none break-words font-serif leading-relaxed dark:prose-invert prose-headings:font-sans prose-p:my-2.5 prose-pre:overflow-x-auto prose-a:text-primary prose-li:my-1 prose-strong:font-semibold">
        {message.content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkTimestamps]}
            components={{
              a({ href, children }: { href?: string; children?: React.ReactNode }) {
                if (href?.startsWith("cite:")) {
                  const n = Number(href.slice(5))
                  const s = sources[n - 1]
                  if (s) {
                    return (
                      <button
                        type="button"
                        onClick={() => openSource(s)}
                        title={`${s.episodeTitle} · ${formatTimestamp(s.startSec)}`}
                        className="mx-0.5 inline-flex size-5 -translate-y-[0.15em] items-center justify-center rounded bg-primary/15 align-baseline font-sans text-[11px] font-medium text-primary no-underline hover:bg-primary/25"
                      >
                        {n}
                      </button>
                    )
                  }
                  return null
                }
                if (href?.startsWith("#t=")) {
                  const sec = parseTimestamp(String(children).replace(/[[\]]/g, ""))
                  return (
                    <button
                      type="button"
                      onClick={() => onSeek?.(Number(href.slice(3)) || sec)}
                      className="font-sans text-primary hover:underline"
                    >
                      {children}
                    </button>
                  )
                }
                return (
                  <a href={href} className="text-primary hover:underline">
                    {children}
                  </a>
                )
              },
            }}
          >
            {content}
          </ReactMarkdown>
        ) : pending ? (
          <span className="inline-flex gap-1">
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
          </span>
        ) : null}
      </div>

      {message.content && (
        <>
          {shownSources.length > 0 && (
            <div className="space-y-2">
              <p className="font-sans text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sources
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {shownSources.map(({ s, n }) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => openSource(s)}
                    className="group flex items-center gap-3 rounded-xl border p-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/15 font-sans text-[11px] font-medium text-primary">
                      {n}
                    </span>
                    <div className="size-9 shrink-0 overflow-hidden rounded-md bg-muted">
                      {s.artworkUrl ? (
                        <img src={hiResArtwork(s.artworkUrl, 120)} alt="" className="size-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1 font-sans">
                      <div className="line-clamp-1 text-sm font-medium">{s.episodeTitle}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[s.podcastName, formatTimestamp(s.startSec)].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <Play className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="font-sans">
            <CopyButton text={message.content} />
          </div>
        </>
      )}
    </div>
  )
}
