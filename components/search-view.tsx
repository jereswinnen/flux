"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Loader2, Search, Sparkles } from "lucide-react"
import { Input } from "@/components/ui/input"
import { hiResArtwork } from "@/lib/artwork"
import { formatTimestamp } from "@/lib/format"

type Source = {
  chunkId: string
  episodeId: string
  episodeTitle: string
  podcastName: string | null
  artworkUrl: string | null
  content: string
  startSec: number
  endSec: number
}

type Group = {
  episodeId: string
  episodeTitle: string
  podcastName: string | null
  artworkUrl: string | null
  items: (Source & { n: number })[]
}

function groupSources(sources: Source[]): Group[] {
  const groups: Group[] = []
  const byEp = new Map<string, Group>()
  sources.forEach((s, idx) => {
    let g = byEp.get(s.episodeId)
    if (!g) {
      g = {
        episodeId: s.episodeId,
        episodeTitle: s.episodeTitle,
        podcastName: s.podcastName,
        artworkUrl: s.artworkUrl,
        items: [],
      }
      byEp.set(s.episodeId, g)
      groups.push(g)
    }
    g.items.push({ ...s, n: idx + 1 })
  })
  return groups
}

// Render the answer as markdown, turning [n] citations into chip links to the
// source moment. We rewrite bare [n] into a `cite:n` link, then render that as a
// small superscript chip in the markdown `a` handler.
function Answer({ text, sources }: { text: string; sources: Source[] }) {
  const withCitations = text.replace(/\[(\d+)\](?!\()/g, "[$1](cite:$1)")
  return (
    <div className="prose prose-base max-w-none leading-relaxed dark:prose-invert prose-p:my-2 prose-a:text-primary prose-li:my-0.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }: { href?: string; children?: React.ReactNode }) {
            if (href?.startsWith("cite:")) {
              const n = Number(href.slice(5))
              const s = sources[n - 1]
              if (s) {
                return (
                  <Link
                    href={`/episodes/${s.episodeId}?t=${Math.floor(s.startSec)}`}
                    title={`${s.episodeTitle} · ${formatTimestamp(s.startSec)}`}
                    className="mx-0.5 inline-flex size-4 translate-y-[-0.15em] items-center justify-center rounded bg-primary/15 align-baseline text-[10px] font-medium text-primary no-underline hover:bg-primary/25"
                  >
                    {n}
                  </Link>
                )
              }
              return <>{children}</>
            }
            return (
              <a href={href} className="text-primary hover:underline">
                {children}
              </a>
            )
          },
        }}
      >
        {withCitations}
      </ReactMarkdown>
    </div>
  )
}

export function SearchView({ query }: { query: string }) {
  const router = useRouter()
  const [input, setInput] = useState(query)
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const seq = useRef(0)

  useEffect(() => {
    setInput(query)
    const q = query.trim()
    if (q.length < 2) {
      setAnswer(null)
      setSources([])
      return
    }
    const mySeq = ++seq.current
    setLoading(true)
    setAnswer(null)
    fetch("/api/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (mySeq !== seq.current) return
        setAnswer(d.answer ?? null)
        setSources(d.sources ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (mySeq === seq.current) setLoading(false)
      })
  }, [query])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const q = input.trim()
    if (q.length >= 2) router.push(`/search?q=${encodeURIComponent(q)}`)
  }

  const groups = groupSources(sources)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8">
      <form onSubmit={submit} className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything across your library…"
          className="h-11 pl-9 text-base"
          autoFocus
        />
      </form>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Reading your library…
        </div>
      )}

      {!loading && query.trim().length >= 2 && (
        <>
          {answer ? (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Sparkles className="size-3.5" /> Answer
              </h2>
              <Answer text={answer} sources={sources} />
            </section>
          ) : (
            <p className="text-muted-foreground">
              Nothing in your library covers that yet.
            </p>
          )}

          {groups.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sources
              </h2>
              <div className="space-y-3">
                {groups.map((g) => {
                  const [first, ...rest] = g.items
                  return (
                    <div key={g.episodeId} className="rounded-lg border p-3">
                      <Link
                        href={`/episodes/${g.episodeId}`}
                        className="mb-2 flex items-center gap-2.5"
                      >
                        <div className="size-8 shrink-0 overflow-hidden rounded bg-muted">
                          {g.artworkUrl ? (
                            <img src={hiResArtwork(g.artworkUrl, 120)} alt="" className="size-full object-cover" />
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{g.episodeTitle}</div>
                          {g.podcastName && (
                            <div className="truncate text-xs text-muted-foreground">{g.podcastName}</div>
                          )}
                        </div>
                      </Link>
                      <Moment item={first} />
                      {rest.length > 0 && (
                        <details className="group mt-1">
                          <summary className="cursor-pointer list-none px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                            {rest.length} more moment{rest.length === 1 ? "" : "s"}
                          </summary>
                          <div className="mt-1 space-y-1">
                            {rest.map((it) => (
                              <Moment key={it.chunkId} item={it} />
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Moment({ item }: { item: Source & { n: number } }) {
  return (
    <Link
      href={`/episodes/${item.episodeId}?t=${Math.floor(item.startSec)}`}
      className="flex gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted"
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[10px] font-medium text-primary">
        {item.n}
      </span>
      <p className="min-w-0 flex-1 text-sm">
        <span className="line-clamp-2">{item.content}</span>
        <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
          {formatTimestamp(item.startSec)}
        </span>
      </p>
    </Link>
  )
}
