"use client"

import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ChevronRight, Link2, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { useCommand } from "@/components/command-context"
import { hiResArtwork } from "@/lib/artwork"
import { isUrl, looksLikeFeedUrl } from "@/lib/url"
import { isYouTubeUrl } from "@/lib/sources/youtube-url"
import { formatRelativeDate, formatTimestamp } from "@/lib/format"

type Show = { collectionId: number; name: string; artistName: string; artworkUrl?: string; feedUrl?: string }
type EpisodeResult = {
  trackId: number; collectionId: number; title: string; podcastName: string
  audioUrl?: string; artworkUrl?: string; feedUrl?: string; releaseDate?: string; durationSec?: number
}
type FeedEpisode = {
  title: string; guid?: string; audioUrl: string; publishedAt?: string; durationSec?: number
}
type LibEpisode = {
  id: string; title: string; podcastName: string | null; artworkUrl: string | null
  status: string; publishedAt: string | null
}
type Moment = {
  chunkId: string; itemId: string; itemTitle: string; podcastName: string | null
  artworkUrl: string | null; content: string; startSec: number; endSec: number
}

function Thumb({ src, alt }: { src?: string | null; alt: string }) {
  const url = hiResArtwork(src, 120)
  if (!url) return <div className="size-9 shrink-0 rounded bg-muted" aria-hidden />
  return <img src={url} alt={alt} className="size-9 shrink-0 rounded object-cover" />
}

// Highlight the matched query terms inside a transcript snippet.
function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  if (terms.length === 0) return <>{text}</>
  const parts = text.split(new RegExp(`(${terms.join("|")})`, "gi"))
  const set = new Set(terms.map((t) => t.toLowerCase()))
  return (
    <>
      {parts.map((p, i) =>
        set.has(p.toLowerCase()) ? (
          <mark key={i} className="rounded bg-primary/20 px-0.5 text-foreground">{p}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

export function AddCommand() {
  const router = useRouter()
  const { open, setOpen } = useCommand()

  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<"search" | "episodes">("search")
  const [shows, setShows] = useState<Show[]>([])
  const [episodes, setEpisodes] = useState<EpisodeResult[]>([])
  const [feedEpisodes, setFeedEpisodes] = useState<FeedEpisode[]>([])
  const [libEpisodes, setLibEpisodes] = useState<LibEpisode[]>([])
  const [moments, setMoments] = useState<Moment[]>([])
  const [recents, setRecents] = useState<LibEpisode[]>([])
  const [context, setContext] = useState<{ name?: string; artworkUrl?: string; feedUrl?: string }>({})
  const [loading, setLoading] = useState(false)
  const [localLoading, setLocalLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [active, setActive] = useState("")
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeq = useRef(0)

  useEffect(() => {
    if (!open) {
      setQuery(""); setMode("search"); setShows([]); setEpisodes([]); setFeedEpisodes([])
      setLibEpisodes([]); setMoments([]); setContext({}); setActive("")
      return
    }
    // Load recent episodes for the empty state.
    fetch("/api/episodes")
      .then((r) => r.json())
      .then((d) => setRecents((d.episodes ?? []).slice(0, 6)))
      .catch(() => {})
  }, [open])

  useEffect(() => {
    if (mode !== "search") return
    if (debounce.current) clearTimeout(debounce.current)
    const q = query.trim()
    if (q.length < 2 || isUrl(q)) {
      setShows([]); setEpisodes([]); setLibEpisodes([]); setMoments([])
      return
    }
    debounce.current = setTimeout(async () => {
      const seq = ++searchSeq.current
      setLoading(true); setLocalLoading(true)
      // Your own library and Apple Podcasts resolve in parallel.
      fetch("/api/library/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (seq !== searchSeq.current) return
          setLibEpisodes(d.episodes ?? [])
          setMoments(d.moments ?? [])
        })
        .catch(() => {})
        .finally(() => { if (seq === searchSeq.current) setLocalLoading(false) })

      try {
        const [showRes, epRes] = await Promise.all([
          fetch(`/api/itunes/search?type=podcast&q=${encodeURIComponent(q)}`).then((r) => r.json()),
          fetch(`/api/itunes/search?type=episode&q=${encodeURIComponent(q)}`).then((r) => r.json()),
        ])
        if (seq !== searchSeq.current) return
        setShows((showRes.results ?? []).slice(0, 5))
        setEpisodes((epRes.results ?? []).filter((e: EpisodeResult) => e.audioUrl).slice(0, 5))
      } finally {
        if (seq === searchSeq.current) setLoading(false)
      }
    }, 350)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query, mode])

  async function loadShowEpisodes(feedUrl: string, ctx: { name?: string; artworkUrl?: string }) {
    setLoading(true); setMode("episodes"); setQuery(""); setActive(""); setContext({ ...ctx, feedUrl })
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

  async function ingestItem(payload: Record<string, unknown>) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add")
      const { item } = await res.json()
      toast.success("Item queued for transcription")
      setOpen(false)
      router.push(`/episodes/${item.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add")
    } finally {
      setSubmitting(false)
    }
  }

  function goTo(href: string) {
    setOpen(false)
    router.push(href)
  }

  const urlQuery = isUrl(query.trim()) ? query.trim() : null
  const typing = query.trim().length >= 2 && !urlQuery
  const noLocalResults = typing && !localLoading && libEpisodes.length === 0 && moments.length === 0
  const noAddResults = typing && !loading && shows.length === 0 && episodes.length === 0

  function goBack() {
    setMode("search")
    setFeedEpisodes([])
    setActive("")
  }

  // Arrow-key drill navigation: → opens the highlighted show, ← goes back.
  // Caret guards keep normal text editing in the input intact.
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const el = e.target as HTMLInputElement
    const isInput = el?.tagName === "INPUT"
    const atEnd = isInput && el.selectionStart === el.value.length && el.selectionStart === el.selectionEnd
    const atStart = isInput && el.selectionStart === 0 && el.selectionEnd === 0
    if (mode === "search" && e.key === "ArrowRight" && atEnd) {
      // Read the currently-highlighted item straight from cmdk's DOM so this
      // works no matter where the show sits among library/moment results.
      const selected = document.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]')
      const value = selected?.getAttribute("data-value") ?? active
      const show = shows.find((s) => `show-${s.collectionId}` === value)
      if (show?.feedUrl) {
        e.preventDefault()
        loadShowEpisodes(show.feedUrl, { name: show.name, artworkUrl: show.artworkUrl })
      }
    } else if (mode === "episodes" && e.key === "ArrowLeft" && atStart) {
      e.preventDefault()
      goBack()
    }
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="sm:max-w-2xl">
      <Command shouldFilter={mode === "episodes"} onValueChange={setActive} onKeyDown={handleKeyDown}>
      <CommandInput
        placeholder={mode === "episodes" ? "Filter episodes…" : "Search your library, Apple Podcasts, or paste a URL…"}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[460px]">
        {(loading || localLoading) && (
          <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Searching…
          </div>
        )}

        {mode === "search" && (
          <>
            {!typing && !urlQuery && recents.length > 0 && (
              <CommandGroup heading="Recent">
                {recents.map((e) => (
                  <CommandItem key={`recent-${e.id}`} value={`recent-${e.id}`} onSelect={() => goTo(`/episodes/${e.id}`)}>
                    <Thumb src={e.artworkUrl} alt={e.title} />
                    <div className="min-w-0">
                      <div className="truncate">{e.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{e.podcastName}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {!typing && !urlQuery && recents.length === 0 && (
              <CommandEmpty>Search your library, Apple Podcasts, or paste an episode/feed URL.</CommandEmpty>
            )}

            {urlQuery && (
              <CommandGroup heading="URL">
                <CommandItem
                  value={`url-${urlQuery}`}
                  disabled={submitting}
                  onSelect={() => {
                    if (isYouTubeUrl(urlQuery)) {
                      ingestItem({ url: urlQuery })
                    } else if (looksLikeFeedUrl(urlQuery)) {
                      loadShowEpisodes(urlQuery, {})
                    } else {
                      ingest({ title: urlQuery, audioUrl: urlQuery, sourceUrl: urlQuery })
                    }
                  }}
                >
                  <Link2 className="size-4" />
                  {isYouTubeUrl(urlQuery)
                    ? "Add this YouTube video"
                    : looksLikeFeedUrl(urlQuery)
                      ? "Load feed episodes"
                      : "Add this audio URL"}
                </CommandItem>
              </CommandGroup>
            )}

            {typing && (
              <CommandGroup heading="Search">
                <CommandItem
                  value="__search-all"
                  onSelect={() => goTo(`/search?q=${encodeURIComponent(query.trim())}`)}
                >
                  <Sparkles className="size-4" />
                  Search your library for &ldquo;{query.trim()}&rdquo;
                </CommandItem>
              </CommandGroup>
            )}

            {libEpisodes.length > 0 && (
              <CommandGroup heading="In your library">
                {libEpisodes.map((e) => (
                  <CommandItem key={`lib-${e.id}`} value={`lib-${e.id}`} onSelect={() => goTo(`/episodes/${e.id}`)}>
                    <Thumb src={e.artworkUrl} alt={e.title} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{e.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{e.podcastName}</div>
                    </div>
                    {e.status !== "ready" && (
                      <Badge variant={e.status === "failed" ? "destructive" : "secondary"}>{e.status}</Badge>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {moments.length > 0 && (
              <CommandGroup heading="Top moments">
                {moments.slice(0, 3).map((m) => (
                  <CommandItem
                    key={`moment-${m.chunkId}`}
                    value={`moment-${m.chunkId}`}
                    onSelect={() => goTo(`/episodes/${m.itemId}?t=${Math.floor(m.startSec)}`)}
                  >
                    <Thumb src={m.artworkUrl} alt={m.itemTitle} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm">
                        <Highlight text={m.content} query={query} />
                      </p>
                      <div className="truncate text-xs text-muted-foreground">{m.itemTitle}</div>
                    </div>
                    <CommandShortcut>{formatTimestamp(m.startSec)}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {(shows.length > 0 || episodes.length > 0) && (
              <CommandGroup heading="Add from Apple Podcasts">
                {shows.map((s) => (
                  <CommandItem
                    key={`show-${s.collectionId}`}
                    value={`show-${s.collectionId}`}
                    disabled={!s.feedUrl}
                    onSelect={() => s.feedUrl && loadShowEpisodes(s.feedUrl, { name: s.name, artworkUrl: s.artworkUrl })}
                  >
                    <Thumb src={s.artworkUrl} alt={s.name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{s.name}</div>
                      <div className="truncate text-xs text-muted-foreground">Show · {s.artistName}</div>
                    </div>
                    {s.feedUrl && <ChevronRight className="size-4 text-muted-foreground" />}
                  </CommandItem>
                ))}
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

            {noLocalResults && noAddResults && (
              <CommandEmpty>No results for &ldquo;{query.trim()}&rdquo;.</CommandEmpty>
            )}
          </>
        )}

        {mode === "episodes" && (
          <>
            <CommandGroup>
              <CommandItem value="__back" onSelect={goBack}>
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
      <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><kbd className="rounded bg-muted px-1 py-0.5">↑↓</kbd> navigate</span>
        {mode === "search" ? (
          <span className="flex items-center gap-1"><kbd className="rounded bg-muted px-1 py-0.5">→</kbd> open show</span>
        ) : (
          <span className="flex items-center gap-1"><kbd className="rounded bg-muted px-1 py-0.5">←</kbd> back</span>
        )}
        <span className="ml-auto flex items-center gap-1"><kbd className="rounded bg-muted px-1 py-0.5">↵</kbd> open / add</span>
      </div>
      </Command>
    </CommandDialog>
  )
}
