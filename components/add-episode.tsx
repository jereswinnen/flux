"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Show = { collectionId: number; name: string; artistName: string; artworkUrl?: string; feedUrl?: string }
type Episode = {
  trackId?: number
  title: string
  podcastName?: string
  audioUrl?: string
  artworkUrl?: string
  feedUrl?: string
  guid?: string
  releaseDate?: string
  publishedAt?: string
  durationSec?: number
}

async function submitEpisode(payload: Record<string, unknown>) {
  const res = await fetch("/api/episodes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? "submit failed")
  return (await res.json()).episode as { id: string }
}

export function AddEpisode() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onSubmit(payload: Record<string, unknown>) {
    setBusy(true)
    try {
      const ep = await submitEpisode(payload)
      toast.success("Episode queued for transcription")
      router.push(`/episodes/${ep.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Tabs defaultValue="shows" className="w-full max-w-2xl">
      <TabsList>
        <TabsTrigger value="shows">Search shows</TabsTrigger>
        <TabsTrigger value="episodes">Search episodes</TabsTrigger>
        <TabsTrigger value="url">Paste URL</TabsTrigger>
      </TabsList>

      <TabsContent value="shows">
        <SearchShows onPick={onSubmit} busy={busy} />
      </TabsContent>
      <TabsContent value="episodes">
        <SearchEpisodes onPick={onSubmit} busy={busy} />
      </TabsContent>
      <TabsContent value="url">
        <PasteUrl onSubmit={onSubmit} busy={busy} />
      </TabsContent>
    </Tabs>
  )
}

function SearchShows({ onPick, busy }: { onPick: (p: Record<string, unknown>) => void; busy: boolean }) {
  const [q, setQ] = useState("")
  const [shows, setShows] = useState<Show[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])

  async function search() {
    const res = await fetch(`/api/itunes/search?type=podcast&q=${encodeURIComponent(q)}`)
    setShows((await res.json()).results)
    setEpisodes([])
  }
  async function loadEpisodes(show: Show) {
    const res = await fetch(`/api/itunes/episodes?feedUrl=${encodeURIComponent(show.feedUrl ?? "")}`)
    const data = await res.json()
    setEpisodes(
      (data.episodes ?? []).map((e: Episode) => ({ ...e, podcastName: show.name, artworkUrl: show.artworkUrl })),
    )
  }

  return (
    <div className="space-y-3 pt-3">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search podcasts…" />
        <Button onClick={search}>Search</Button>
      </div>
      {shows.map((s) => (
        <Card key={s.collectionId} className="cursor-pointer p-3" onClick={() => loadEpisodes(s)}>
          <div className="font-medium">{s.name}</div>
          <div className="text-muted-foreground text-sm">{s.artistName}</div>
        </Card>
      ))}
      {episodes.map((e, i) => (
        <Card key={i} className="flex items-center justify-between p-3">
          <div className="min-w-0">
            <div className="truncate font-medium">{e.title}</div>
            <div className="text-muted-foreground text-sm">{e.podcastName}</div>
          </div>
          <Button
            disabled={busy || !e.audioUrl}
            onClick={() =>
              onPick({
                title: e.title,
                audioUrl: e.audioUrl,
                podcastName: e.podcastName,
                artworkUrl: e.artworkUrl,
                episodeGuid: e.guid,
                publishedAt: e.publishedAt,
                durationSec: e.durationSec,
              })
            }
          >
            Add
          </Button>
        </Card>
      ))}
    </div>
  )
}

function SearchEpisodes({ onPick, busy }: { onPick: (p: Record<string, unknown>) => void; busy: boolean }) {
  const [q, setQ] = useState("")
  const [episodes, setEpisodes] = useState<Episode[]>([])

  async function search() {
    const res = await fetch(`/api/itunes/search?type=episode&q=${encodeURIComponent(q)}`)
    setEpisodes((await res.json()).results)
  }

  return (
    <div className="space-y-3 pt-3">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search episodes…" />
        <Button onClick={search}>Search</Button>
      </div>
      {episodes.map((e, i) => (
        <Card key={i} className="flex items-center justify-between p-3">
          <div className="min-w-0">
            <div className="truncate font-medium">{e.title}</div>
            <div className="text-muted-foreground text-sm">{e.podcastName}</div>
          </div>
          <Button
            disabled={busy || !e.audioUrl}
            onClick={() =>
              onPick({
                title: e.title,
                audioUrl: e.audioUrl,
                podcastName: e.podcastName,
                artworkUrl: e.artworkUrl,
                publishedAt: e.releaseDate,
                durationSec: e.durationSec,
              })
            }
          >
            Add
          </Button>
        </Card>
      ))}
    </div>
  )
}

function PasteUrl({ onSubmit, busy }: { onSubmit: (p: Record<string, unknown>) => void; busy: boolean }) {
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [feedEpisodes, setFeedEpisodes] = useState<Episode[] | null>(null)
  const [showName, setShowName] = useState<string | undefined>()

  // Accepts either a direct audio URL or an RSS feed URL.
  async function load() {
    setFeedEpisodes(null)
    const res = await fetch(`/api/itunes/episodes?feedUrl=${encodeURIComponent(url)}`)
    if (!res.ok) {
      toast.error("Could not parse that as a feed. If it's a direct audio URL, give it a title and Add it.")
      return
    }
    const data = await res.json()
    setShowName(data.showName)
    setFeedEpisodes(data.episodes ?? [])
  }

  return (
    <div className="space-y-3 pt-3">
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Audio URL (.mp3) or RSS feed URL" />
      <div className="flex gap-2">
        <Button variant="outline" onClick={load} disabled={!url}>
          Load feed
        </Button>
      </div>

      {feedEpisodes === null ? (
        <div className="space-y-2 border-t pt-3">
          <p className="text-muted-foreground text-sm">…or add a direct audio URL:</p>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Episode title" />
          <Button
            disabled={busy || !url || !title}
            onClick={() => onSubmit({ title, audioUrl: url, sourceUrl: url })}
          >
            Add episode
          </Button>
        </div>
      ) : (
        feedEpisodes.map((e, i) => (
          <Card key={i} className="flex items-center justify-between p-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{e.title}</div>
              <div className="text-muted-foreground text-sm">{showName}</div>
            </div>
            <Button
              disabled={busy || !e.audioUrl}
              onClick={() =>
                onSubmit({
                  title: e.title,
                  audioUrl: e.audioUrl,
                  podcastName: showName,
                  sourceUrl: url,
                  episodeGuid: e.guid,
                  publishedAt: e.publishedAt,
                  durationSec: e.durationSec,
                })
              }
            >
              Add
            </Button>
          </Card>
        ))
      )}
    </div>
  )
}
