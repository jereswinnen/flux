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
import { useVideoPlayer } from "@/components/video-player"
import { LiveTranscript } from "@/components/live-transcript"

type Segment = {
  start: number
  end: number
  text: string
  words?: { start: number; end: number; word: string }[]
}
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
    type: string
    videoId: string | null
  }
  transcript: { fullText: string; segments: Segment[] } | null
  insights: Insights
  entities?: MentionedEntity[]
}

function YouTubeBody({
  videoId,
  transcript,
  insights,
  entities,
  tab,
  onTabChange,
  startSec,
  title,
  itemId,
}: {
  videoId: string
  transcript: { segments: Segment[] }
  insights: Insights
  entities: MentionedEntity[]
  tab: string
  onTabChange: (v: string) => void
  startSec?: number
  title?: string
  itemId: string
}) {
  const video = useVideoPlayer()
  const slotRef = useRef<HTMLDivElement>(null)

  // Load this video into the GLOBAL player on mount; it persists across nav.
  useEffect(() => {
    video.cue(videoId, { chapters: insights?.chapters ?? undefined, startSec, title, itemId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId])

  // Register the inline slot the global player overlays while it's on-screen.
  useEffect(() => {
    video.registerSlot(slotRef.current)
    return () => video.registerSlot(null)
  }, [video])

  return (
    <>
      {/* The global video player overlays this slot while it's visible. */}
      <div ref={slotRef} className="mb-4 aspect-video w-full rounded-lg bg-black" />
      <Tabs value={tab} onValueChange={onTabChange}>
        <div className="sticky top-0 z-10 -mx-4 mb-2 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6">
          <TabsList>
            <TabsTrigger value="transcript">Live Transcript</TabsTrigger>
            <TabsTrigger value="insights">Insights</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="transcript" className="pb-10 pt-2">
          <LiveTranscriptBound segments={transcript.segments} />
        </TabsContent>
        <TabsContent value="insights" className="pb-10 pt-2">
          <EpisodeInsightsBound insights={insights} entities={entities} />
        </TabsContent>
      </Tabs>
    </>
  )
}

function LiveTranscriptBound({ segments }: { segments: Segment[] }) {
  const { currentSec, seekTo } = useVideoPlayer()
  return <LiveTranscript segments={segments} currentSec={currentSec} onSeek={seekTo} />
}

function EpisodeInsightsBound({ insights, entities }: { insights: Insights; entities: MentionedEntity[] }) {
  const { seekTo } = useVideoPlayer()
  return <EpisodeInsights insights={insights} entities={entities} onSeek={seekTo} />
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
        itemId: episode.id,
        audioUrl: episode.audioUrl,
        title: episode.title,
        artworkUrl: episode.artworkUrl,
        markers: quoteMarkers,
      }
    : null
  const seek = (sec: number) => {
    if (track) player.cue(track, sec)
  }
  const isYouTube = episode.type === "youtube" && !!episode.videoId
  // YouTube items lead with the live transcript; podcasts lead with insights.
  const [tab, setTab] = useState(isYouTube ? "transcript" : "insights")
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
              itemId={episode.id}
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
          ) : isYouTube && episode.videoId ? (
            <YouTubeBody
              videoId={episode.videoId}
              transcript={transcript}
              insights={insights}
              entities={entities}
              tab={tab}
              onTabChange={setTab}
              startSec={tParam ? Math.floor(Number(tParam)) || undefined : undefined}
              title={episode.title}
              itemId={episode.id}
            />
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
                <LiveTranscript
                  segments={transcript.segments}
                  currentSec={player.track?.itemId === episode.id ? player.current : 0}
                  onSeek={seek}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>

      {/* Floating on-this-page nav — right edge, vertically centered, doesn't shift
          content. Shared across podcasts and videos (tab state is lifted here). */}
      {transcript && tab === "insights" && sections.length > 0 && (
        <div className="fixed right-6 top-1/2 z-20 hidden -translate-y-1/2 xl:block">
          <InsightsNav sections={sections} scrollRef={scrollRef} />
        </div>
      )}
    </>
  )
}
