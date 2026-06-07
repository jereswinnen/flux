"use client"

import { useEffect, useState } from "react"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EpisodeCard, type LibEpisode } from "@/components/episode-card"
import { useCommand } from "@/components/command-context"
import { hiResArtwork } from "@/lib/artwork"

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

  const anyInFlight = episodes.some((e) => !["ready", "failed"].includes(e.status))
  useEffect(() => {
    if (!anyInFlight) return
    const t = setInterval(() => {
      fetch("/api/episodes").then((r) => r.json()).then((d) => setEpisodes(d.episodes ?? [])).catch(() => {})
    }, 6000)
    return () => clearInterval(t)
  }, [anyInFlight])

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <Button
        variant="outline"
        onClick={openCommand}
        className="w-full max-w-xl justify-start gap-2 text-muted-foreground"
      >
        <Search className="size-4" />
        Search your library or add an episode…
        <kbd className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[11px]">⌘K</kbd>
      </Button>

      {episodes.length === 0 ? (
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
