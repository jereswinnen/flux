"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Play } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AppHeader } from "@/components/app-header"
import { ChatPanel } from "@/components/chat-panel"
import { usePlayer, type AudioMarker, type Track } from "@/components/player-context"
import { hiResArtwork } from "@/lib/artwork"
import { formatRelativeDate, formatTimestamp } from "@/lib/format"
import { EpisodeActions } from "@/components/episode-actions"
import { EpisodeInsights } from "@/components/episode-insights"

type Segment = { start: number; end: number; text: string }
type Insights = {
  summary?: string | null
  takeaways?: string[] | null
  topics?: string[] | null
  chapters?: { title: string; startSec: number }[] | null
  quotes?: { text: string; approxTimestampSec: number }[] | null
  entities?: { name: string; type: string }[] | null
} | null

export type EpisodeViewProps = {
  episode: {
    id: string
    title: string
    podcastName: string | null
    artworkUrl: string | null
    status: string
    errorMessage: string | null
    publishedAt: string | null
    durationSec: number | null
    audioUrl: string | null
    sourceUrl: string | null
  }
  transcript: { fullText: string; segments: Segment[] } | null
  insights: Insights
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "ready") return "default"
  if (status === "failed") return "destructive"
  return "secondary"
}

export function EpisodeView({ episode, transcript, insights }: EpisodeViewProps) {
  const router = useRouter()
  const inFlight = !["ready", "failed"].includes(episode.status)
  const player = usePlayer()
  const quoteMarkers: AudioMarker[] = (insights?.quotes ?? []).map((q) => ({
    sec: q.approxTimestampSec,
    label: q.text,
  }))
  const track: Track | null = episode.audioUrl
    ? {
        episodeId: episode.id,
        audioUrl: episode.audioUrl,
        title: episode.title,
        artworkUrl: episode.artworkUrl,
        markers: quoteMarkers,
      }
    : null
  const seek = (sec: number) => {
    if (track) player.cue(track, sec)
  }
  // Deep-link: /episodes/[id]?t=<sec> cues the player to that moment on load.
  const searchParams = useSearchParams()
  const tParam = searchParams.get("t")
  useEffect(() => {
    if (tParam && track) player.cue(track, Number(tParam))
    // Only react to the deep-link param changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tParam])

  useEffect(() => {
    if (!inFlight) return
    const t = setInterval(() => router.refresh(), 4000)
    return () => clearInterval(t)
  }, [inFlight, router])

  const meta = [
    episode.podcastName,
    episode.durationSec ? formatTimestamp(episode.durationSec) : null,
    episode.publishedAt ? formatRelativeDate(episode.publishedAt) : null,
  ].filter(Boolean) as string[]

  return (
    <>
      <AppHeader
        breadcrumbs={[{ label: "Library", href: "/" }, { label: episode.title }]}
        actions={
          <>
            {episode.status !== "ready" && (
              <Badge variant={statusVariant(episode.status)} className={inFlight ? "animate-pulse" : ""}>
                {episode.status}
              </Badge>
            )}
            {track && (
              <Button size="sm" onClick={() => player.play(track)} className="gap-2">
                <Play className="size-4" /> Play
              </Button>
            )}
            <EpisodeActions
              episodeId={episode.id}
              episode={{
                title: episode.title,
                podcastName: episode.podcastName,
                durationSec: episode.durationSec,
                publishedAt: episode.publishedAt,
                sourceUrl: episode.sourceUrl,
              }}
              transcript={transcript}
              insights={insights}
            />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Episode header */}
        <header className="flex shrink-0 items-center gap-4 border-b p-4 md:px-6">
          <div className="size-14 shrink-0 overflow-hidden rounded-md bg-muted md:size-16">
            {episode.artworkUrl ? (
              <img src={hiResArtwork(episode.artworkUrl, 240)} alt="" className="size-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{episode.title}</h1>
            <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              {meta.map((m, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden>·</span>}
                  <span className="truncate">{m}</span>
                </span>
              ))}
            </div>
          </div>
        </header>

      {episode.status === "failed" ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 md:p-6">
          <p className="text-sm text-destructive">{episode.errorMessage ?? "Processing failed."}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await fetch(`/api/episodes/${episode.id}/retry`, { method: "POST" })
              router.refresh()
            }}
          >
            Retry
          </Button>
        </div>
      ) : !transcript ? (
        <div className="p-4 text-sm text-muted-foreground md:p-6">
          Processing… this page updates automatically.
        </div>
      ) : (
        // Bounded by the viewport shell: the active left tab scrolls on its own,
        // and the chat rail flexes the remaining column height (plain h-full).
        <div className="grid min-h-0 flex-1 gap-6 p-4 md:p-6 lg:grid-cols-3">
          <div className="flex min-h-0 flex-col lg:col-span-2">
            <Tabs defaultValue="insights" className="flex min-h-0 flex-1 flex-col">
              <TabsList className="shrink-0 self-start">
                <TabsTrigger value="insights">Insights</TabsTrigger>
                <TabsTrigger value="transcript">Transcript</TabsTrigger>
                {/* Chat is a tab on mobile; it lives in the side rail on desktop. */}
                <TabsTrigger value="chat" className="lg:hidden">Chat</TabsTrigger>
              </TabsList>

              <TabsContent value="insights" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <div className="pb-6 pr-4 pt-4">
                    <EpisodeInsights insights={insights} onSeek={seek} />
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="transcript" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <div className="space-y-2 pb-6 pr-4 pt-4 font-serif text-lg leading-relaxed">
                    {transcript.segments.map((s, i) => (
                      <p key={s.start ?? i}>
                        <button
                          type="button"
                          onClick={() => seek(s.start)}
                          className="mr-2 font-sans text-sm tabular-nums text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {formatTimestamp(s.start)}
                        </button>
                        {s.text}
                      </p>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="chat" className="min-h-0 flex-1 pt-3 lg:hidden">
                <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card">
                  <ChatPanel episodeId={episode.id} onSeek={seek} emptyHint="Ask about this episode." />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <aside className="hidden min-h-0 lg:col-span-1 lg:block">
            <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card">
              <ChatPanel episodeId={episode.id} onSeek={seek} emptyHint="Ask about this episode." />
            </div>
          </aside>
        </div>
      )}
      </div>
    </>
  )
}
