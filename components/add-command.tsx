"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Link2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { useCommand } from "@/components/command-context"
import { isUrl, looksLikeFeedUrl } from "@/lib/url"
import { formatRelativeDate } from "@/lib/format"

type Show = { collectionId: number; name: string; artistName: string; artworkUrl?: string; feedUrl?: string }
type EpisodeResult = {
  trackId: number; collectionId: number; title: string; podcastName: string
  audioUrl?: string; artworkUrl?: string; feedUrl?: string; releaseDate?: string; durationSec?: number
}
type FeedEpisode = {
  title: string; guid?: string; audioUrl: string; publishedAt?: string; durationSec?: number
}

function Thumb({ src, alt }: { src?: string; alt: string }) {
  if (!src) return <div className="size-9 shrink-0 rounded bg-muted" aria-hidden />
  return <img src={src} alt={alt} className="size-9 shrink-0 rounded object-cover" />
}

export function AddCommand() {
  const router = useRouter()
  const { open, setOpen } = useCommand()

  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<"search" | "episodes">("search")
  const [shows, setShows] = useState<Show[]>([])
  const [episodes, setEpisodes] = useState<EpisodeResult[]>([])
  const [feedEpisodes, setFeedEpisodes] = useState<FeedEpisode[]>([])
  const [context, setContext] = useState<{ name?: string; artworkUrl?: string; feedUrl?: string }>({})
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeq = useRef(0)

  useEffect(() => {
    if (!open) {
      setQuery(""); setMode("search"); setShows([]); setEpisodes([]); setFeedEpisodes([]); setContext({})
    }
  }, [open])

  useEffect(() => {
    if (mode !== "search") return
    if (debounce.current) clearTimeout(debounce.current)
    const q = query.trim()
    if (q.length < 2 || isUrl(q)) { setShows([]); setEpisodes([]); return }
    debounce.current = setTimeout(async () => {
      const seq = ++searchSeq.current
      setLoading(true)
      try {
        const [showRes, epRes] = await Promise.all([
          fetch(`/api/itunes/search?type=podcast&q=${encodeURIComponent(q)}`).then((r) => r.json()),
          fetch(`/api/itunes/search?type=episode&q=${encodeURIComponent(q)}`).then((r) => r.json()),
        ])
        if (seq !== searchSeq.current) return
        setShows((showRes.results ?? []).slice(0, 6))
        setEpisodes((epRes.results ?? []).filter((e: EpisodeResult) => e.audioUrl).slice(0, 6))
      } finally {
        if (seq === searchSeq.current) setLoading(false)
      }
    }, 350)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query, mode])

  async function loadShowEpisodes(feedUrl: string, ctx: { name?: string; artworkUrl?: string }) {
    setLoading(true); setMode("episodes"); setQuery(""); setContext({ ...ctx, feedUrl })
    try {
      const data = await fetch(`/api/itunes/episodes?feedUrl=${encodeURIComponent(feedUrl)}`).then((r) => r.json())
      setContext({ name: ctx.name ?? data.showName, artworkUrl: ctx.artworkUrl ?? data.artworkUrl, feedUrl })
      setFeedEpisodes((data.episodes ?? []).slice(0, 30))
    } catch {
      toast.error("Couldn't load that feed")
      setMode("search")
    } finally {
      setLoading(false)
    }
  }

  async function ingest(payload: Record<string, unknown>) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/episodes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add")
      const { episode } = await res.json()
      toast.success("Episode queued for transcription")
      setOpen(false)
      router.push(`/episodes/${episode.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add")
    } finally {
      setSubmitting(false)
    }
  }

  const urlQuery = isUrl(query.trim()) ? query.trim() : null

  return (
    <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={mode === "episodes"}>
      <CommandInput
        placeholder={mode === "episodes" ? "Filter episodes…" : "Search podcasts, episodes, or paste a URL…"}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && (
          <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        )}

        {mode === "search" && (
          <>
            {!loading && query.trim().length < 2 && (
              <CommandEmpty>Type to search Apple Podcasts, or paste an episode/feed URL.</CommandEmpty>
            )}

            {urlQuery && (
              <CommandGroup heading="URL">
                <CommandItem
                  value={`url-${urlQuery}`}
                  disabled={submitting}
                  onSelect={() => {
                    if (looksLikeFeedUrl(urlQuery)) {
                      loadShowEpisodes(urlQuery, {})
                    } else {
                      ingest({ title: urlQuery, audioUrl: urlQuery, sourceUrl: urlQuery })
                    }
                  }}
                >
                  <Link2 className="size-4" />
                  {looksLikeFeedUrl(urlQuery) ? "Load feed episodes" : "Add this audio URL"}
                </CommandItem>
              </CommandGroup>
            )}

            {shows.length > 0 && (
              <CommandGroup heading="Shows">
                {shows.map((s) => (
                  <CommandItem
                    key={`show-${s.collectionId}`}
                    value={`show-${s.collectionId}`}
                    disabled={!s.feedUrl}
                    onSelect={() => s.feedUrl && loadShowEpisodes(s.feedUrl, { name: s.name, artworkUrl: s.artworkUrl })}
                  >
                    <Thumb src={s.artworkUrl} alt={s.name} />
                    <div className="min-w-0">
                      <div className="truncate">{s.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{s.artistName}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {episodes.length > 0 && (
              <CommandGroup heading="Episodes">
                {episodes.map((e) => (
                  <CommandItem
                    key={`ep-${e.trackId}`}
                    value={`ep-${e.trackId}`}
                    disabled={submitting}
                    onSelect={() =>
                      ingest({
                        title: e.title,
                        audioUrl: e.audioUrl,
                        podcastName: e.podcastName,
                        artworkUrl: e.artworkUrl,
                        publishedAt: e.releaseDate,
                        durationSec: e.durationSec,
                        itunesTrackId: e.trackId,
                        itunesCollectionId: e.collectionId,
                      })
                    }
                  >
                    <Thumb src={e.artworkUrl} alt={e.title} />
                    <div className="min-w-0">
                      <div className="truncate">{e.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{e.podcastName}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!loading && query.trim().length >= 2 && !urlQuery && shows.length === 0 && episodes.length === 0 && (
              <CommandEmpty>No results for &ldquo;{query.trim()}&rdquo;.</CommandEmpty>
            )}
          </>
        )}

        {mode === "episodes" && (
          <>
            <CommandGroup>
              <CommandItem value="__back" onSelect={() => { setMode("search"); setFeedEpisodes([]) }}>
                <ArrowLeft className="size-4" /> Back to search
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={context.name ?? "Episodes"}>
              {feedEpisodes.map((e, i) => (
                <CommandItem
                  key={`feed-${i}`}
                  value={`feed-${i}-${e.title}`}
                  disabled={submitting || !e.audioUrl}
                  onSelect={() =>
                    ingest({
                      title: e.title,
                      audioUrl: e.audioUrl,
                      podcastName: context.name,
                      artworkUrl: context.artworkUrl,
                      episodeGuid: e.guid,
                      publishedAt: e.publishedAt,
                      durationSec: e.durationSec,
                      sourceUrl: context.feedUrl,
                    })
                  }
                >
                  <Thumb src={context.artworkUrl} alt={e.title} />
                  <div className="min-w-0">
                    <div className="truncate">{e.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{formatRelativeDate(e.publishedAt)}</div>
                  </div>
                </CommandItem>
              ))}
              {!loading && feedEpisodes.length === 0 && <CommandEmpty>No episodes found in this feed.</CommandEmpty>}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
