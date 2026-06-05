"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { EpisodeCard, type LibEpisode } from "@/components/episode-card"
import { useCommand } from "@/components/command-context"
import { formatTimestamp } from "@/lib/format"

type Hit = {
  chunkId: string; episodeId: string; episodeTitle: string
  content: string; startSec: number; endSec: number; similarity: number
}

export function Library({ initialEpisodes }: { initialEpisodes: LibEpisode[] }) {
  const { openCommand } = useCommand()
  const [episodes, setEpisodes] = useState(initialEpisodes)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const anyInFlight = episodes.some((e) => !["ready", "failed"].includes(e.status))
    if (!anyInFlight) return
    const t = setInterval(() => {
      fetch("/api/episodes").then((r) => r.json()).then((d) => setEpisodes(d.episodes ?? [])).catch(() => {})
    }, 6000)
    return () => clearInterval(t)
  }, [episodes])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    const q = query.trim()
    if (q.length < 2) { setHits(null); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const d = await fetch("/api/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: q, limit: 12 }),
        }).then((r) => r.json())
        setHits(d.hits ?? [])
      } finally {
        setSearching(false)
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
            <Link key={h.chunkId} href={`/episodes/${h.episodeId}`}>
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {episodes.map((e) => (
            <EpisodeCard key={e.id} episode={e} />
          ))}
        </div>
      )}
    </div>
  )
}
