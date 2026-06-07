"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { EpisodeCard, type LibEpisode } from "@/components/episode-card"
import { useCommand } from "@/components/command-context"
import { hiResArtwork } from "@/lib/artwork"
import { formatTimestamp } from "@/lib/format"

type Hit = {
  chunkId: string; episodeId: string; episodeTitle: string
  content: string; startSec: number; endSec: number; similarity: number
}

type ShowGroup = { name: string; artworkUrl: string | null; episodes: LibEpisode[] }

function episodeTime(e: LibEpisode): number {
  return new Date(e.publishedAt ?? e.createdAt).getTime()
}

function groupByShow(episodes: LibEpisode[]): ShowGroup[] {
  const groups = new Map<string, ShowGroup>()
  for (const e of episodes) {
    const name = e.podcastName ?? "Unknown show"
    let g = groups.get(name)
    if (!g) {
      g = { name, artworkUrl: e.artworkUrl, episodes: [] }
      groups.set(name, g)
    }
    if (!g.artworkUrl && e.artworkUrl) g.artworkUrl = e.artworkUrl
    g.episodes.push(e)
  }
  const result = [...groups.values()]
  for (const g of result) g.episodes.sort((a, b) => episodeTime(b) - episodeTime(a))
  // Shows with the most recent activity float to the top.
  result.sort((a, b) => episodeTime(b.episodes[0]) - episodeTime(a.episodes[0]))
  return result
}

export function Library({ initialEpisodes }: { initialEpisodes: LibEpisode[] }) {
  const { openCommand } = useCommand()
  const [episodes, setEpisodes] = useState(initialEpisodes)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeq = useRef(0)

  const anyInFlight = episodes.some((e) => !["ready", "failed"].includes(e.status))
  useEffect(() => {
    if (!anyInFlight) return
    const t = setInterval(() => {
      fetch("/api/episodes").then((r) => r.json()).then((d) => setEpisodes(d.episodes ?? [])).catch(() => {})
    }, 6000)
    return () => clearInterval(t)
  }, [anyInFlight])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    const q = query.trim()
    if (q.length < 2) { setHits(null); return }
    debounce.current = setTimeout(async () => {
      const seq = ++searchSeq.current
      setSearching(true)
      try {
        const d = await fetch("/api/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: q, limit: 12 }),
        }).then((r) => r.json())
        if (seq !== searchSeq.current) return
        setHits(d.hits ?? [])
      } finally {
        if (seq === searchSeq.current) setSearching(false)
      }
    }, 400)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query])

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your episodes and transcript moments…"
          className="pl-9"
        />
      </div>

      {hits !== null ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {searching ? "Searching…" : `${hits.length} moment${hits.length === 1 ? "" : "s"}`}
          </h2>
          {hits.map((h) => (
            <Link key={h.chunkId} href={`/episodes/${h.episodeId}?t=${h.startSec}`}>
              <Card className="p-3 transition-colors hover:border-foreground/20">
                <div className="text-xs text-muted-foreground">
                  {h.episodeTitle} · [{formatTimestamp(h.startSec)}]
                </div>
                <p className="mt-1 line-clamp-3 text-sm">{h.content}</p>
              </Card>
            </Link>
          ))}
          {!searching && hits.length === 0 && (
            <p className="text-sm text-muted-foreground">No matching moments found.</p>
          )}
        </section>
      ) : episodes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
          <p className="text-muted-foreground">No episodes yet.</p>
          <Button onClick={openCommand}>Add your first episode</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groupByShow(episodes).map((g) => (
            <section key={g.name} className="space-y-3">
              <div className="flex items-center gap-3">
                {g.artworkUrl ? (
                  <img
                    src={hiResArtwork(g.artworkUrl, 120)}
                    alt=""
                    className="size-9 shrink-0 rounded-md border object-cover"
                  />
                ) : (
                  <div className="size-9 shrink-0 rounded-md border bg-muted" />
                )}
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold leading-tight">{g.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {g.episodes.length} episode{g.episodes.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
                {g.episodes.map((e) => (
                  <EpisodeCard key={e.id} episode={e} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
