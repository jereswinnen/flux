"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, ChevronDown, Copy, Play } from "lucide-react"
import { remarkTimestamps } from "@/lib/markdown/timestamps"
import { hiResArtwork } from "@/lib/artwork"
import { episodeHref } from "@/lib/episode-href"
import { parseTimestamp, formatTimestamp } from "@/lib/format"
import { usePlayer } from "@/components/player-context"
import { useVideoPlayer } from "@/components/video-player"

export type ChatSourceRef = {
  itemId: string
  itemTitle: string
  startSec: number
  podcastName?: string | null
  artworkUrl?: string | null
  audioUrl?: string | null
  videoId?: string | null
  isHighlight?: boolean
  snippet?: string | null
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
  const video = useVideoPlayer()
  const router = useRouter()
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())

  // Start playback at a source's moment — cue the relevant global player in place
  // (video mini for YouTube, audio bar for podcasts); fall back to navigating.
  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function openSource(s: ChatSourceRef) {
    if (s.videoId) {
      video.cue(s.videoId, {
        startSec: Math.floor(s.startSec),
        title: s.itemTitle,
        itemId: s.itemId,
      })
      return
    }
    if (s.audioUrl) {
      player.cue(
        {
          itemId: s.itemId,
          audioUrl: s.audioUrl,
          title: s.itemTitle,
          artworkUrl: s.artworkUrl ?? null,
          markers: [],
        },
        Math.floor(s.startSec),
      )
      return
    }
    router.push(episodeHref(s.itemId, s.startSec))
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
    .filter(({ s }) => !s.isHighlight)
    .filter(({ n }) => citedNums.size === 0 || citedNums.has(n))
  const highlightSources = sources.filter((s) => s.isHighlight)

  const sourceGroups = (() => {
    const order: string[] = []
    const map = new Map<string, { item: ChatSourceRef; refs: { s: ChatSourceRef; n: number }[] }>()
    for (const { s, n } of shownSources) {
      let g = map.get(s.itemId)
      if (!g) {
        g = { item: s, refs: [] }
        map.set(s.itemId, g)
        order.push(s.itemId)
      }
      g.refs.push({ s, n })
    }
    return order.map((id) => map.get(id)!)
  })()

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
                        title={`${s.itemTitle} · ${formatTimestamp(s.startSec)}`}
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
                      onClick={() => {
                        const t = Number(href.slice(3)) || sec
                        // Inline [m:ss] timestamps refer to the answer's primary
                        // source — cue it (video mini / audio bar) at that moment.
                        const src = sources[0]
                        if (src) openSource({ ...src, startSec: t })
                        else onSeek?.(t)
                      }}
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
          {(shownSources.length > 0 || highlightSources.length > 0) && (
            <div className="space-y-2">
              <p className="font-sans text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sources
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {sourceGroups.map((g) => {
                  const multi = g.refs.length > 1
                  const first = g.refs[0]
                  const meta = [
                    g.item.podcastName,
                    multi
                      ? `${g.refs.length} references`
                      : first.s.startSec > 0
                        ? formatTimestamp(first.s.startSec)
                        : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                  return (
                    <div key={g.item.itemId} className="rounded-xl border">
                      <button
                        type="button"
                        onClick={() => (multi ? toggleGroup(g.item.itemId) : openSource(first.s))}
                        className="group flex w-full items-center gap-3 p-2.5 text-left transition-colors hover:bg-muted/50"
                      >
                        {!multi && (
                          <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/15 font-sans text-[11px] font-medium text-primary">
                            {first.n}
                          </span>
                        )}
                        <div className="size-9 shrink-0 overflow-hidden rounded-md bg-muted">
                          {g.item.artworkUrl ? (
                            <img src={hiResArtwork(g.item.artworkUrl, 120)} alt="" className="size-full object-cover" />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1 font-sans">
                          <div className="line-clamp-1 text-sm font-medium">{g.item.itemTitle}</div>
                          <div className="truncate text-xs text-muted-foreground">{meta}</div>
                        </div>
                        {multi ? (
                          <ChevronDown
                            className={`size-4 shrink-0 text-muted-foreground transition-transform ${openGroups.has(g.item.itemId) ? "rotate-180" : ""}`}
                          />
                        ) : (
                          <Play className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        )}
                      </button>
                      {multi && openGroups.has(g.item.itemId) && (
                        <ul className="border-t">
                          {g.refs.map(({ s, n }) => (
                            <li key={n} className="border-b last:border-b-0">
                              <button
                                type="button"
                                onClick={() => openSource(s)}
                                className="group flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
                              >
                                <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/15 font-sans text-[11px] font-medium text-primary">
                                  {n}
                                </span>
                                <span className="flex-1 font-sans tabular-nums text-muted-foreground">
                                  {s.startSec > 0 ? formatTimestamp(s.startSec) : "Reference"}
                                </span>
                                <Play className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
              {highlightSources.length > 0 && (
                <div className="space-y-2">
                  {highlightSources.map((s, i) => (
                    <button
                      key={`hl-${i}`}
                      type="button"
                      onClick={() => openSource(s)}
                      className="group flex w-full items-start gap-3 rounded-xl border p-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
                    >
                      <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wide text-primary">
                        Highlight
                      </span>
                      <span className="min-w-0 flex-1 font-serif text-sm italic leading-snug">
                        &ldquo;{s.snippet ?? s.itemTitle}&rdquo;
                        <span className="mt-1 block font-sans text-xs not-italic text-muted-foreground">
                          {s.itemTitle}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
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
