"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Play, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AppHeader } from "@/components/app-header"
import { usePlayer, type AudioMarker, type Track } from "@/components/player-context"
import { hiResArtwork } from "@/lib/artwork"
import { formatRelativeDate, formatTimestamp } from "@/lib/format"
import { EpisodeActions } from "@/components/episode-actions"
import { EpisodeInsights, insightSections, type MentionedEntity } from "@/components/episode-insights"
import { InsightsNav } from "@/components/insights-nav"

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
  entities?: MentionedEntity[]
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "ready") return "default"
  if (status === "failed") return "destructive"
  return "secondary"
}

export function EpisodeView({ episode, transcript, insights, entities = [] }: EpisodeViewProps) {
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
  const [tab, setTab] = useState("insights")
  const scrollRef = useRef<HTMLDivElement>(null)
  const sections = insightSections(insights, entities.length > 0)

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
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`/ask?attach=${episode.id}`}>
                <Sparkles className="size-4" /> Ask
              </Link>
            </Button>
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
      {/* One natural scroll region under the pinned breadcrumb. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-4 md:px-6 md:py-6">
          {/* Episode header — one compact row on every breakpoint */}
          <header className="flex items-start gap-3 pb-5 sm:gap-4">
            <div className="size-12 shrink-0 overflow-hidden rounded-md bg-muted sm:size-14">
              {episode.artworkUrl ? (
                <img src={hiResArtwork(episode.artworkUrl, 240)} alt="" className="size-full object-cover" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="line-clamp-2 text-base font-semibold leading-snug sm:text-lg">{episode.title}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground sm:text-sm">
                {meta.map((m, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span aria-hidden>·</span>}
                    <span>{m}</span>
                  </span>
                ))}
              </div>
            </div>
          </header>

          {episode.status === "failed" ? (
            <div className="space-y-3">
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
            <div className="text-sm text-muted-foreground">Processing… this page updates automatically.</div>
          ) : (
            <Tabs value={tab} onValueChange={setTab}>
              {/* Tab bar sticks just under the breadcrumb while content scrolls. */}
              <div className="sticky top-0 z-10 -mx-4 mb-2 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6">
                <TabsList>
                  <TabsTrigger value="insights">Insights</TabsTrigger>
                  <TabsTrigger value="transcript">Transcript</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="insights" className="pb-10 pt-2">
                <EpisodeInsights insights={insights} entities={entities} onSeek={seek} />
              </TabsContent>

              <TabsContent value="transcript" className="pb-10 pt-2">
                <div className="space-y-2 font-serif text-lg leading-relaxed">
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
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>

      {/* Floating on-this-page nav — right edge, vertically centered, doesn't shift content. */}
      {transcript && tab === "insights" && sections.length > 0 && (
        <div className="fixed right-6 top-1/2 z-20 hidden -translate-y-1/2 xl:block">
          <InsightsNav sections={sections} scrollRef={scrollRef} />
        </div>
      )}
    </>
  )
}
