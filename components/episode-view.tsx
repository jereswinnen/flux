"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Play } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useConversation } from "@/components/use-conversation"
import { ConversationView } from "@/components/conversation-view"
import { ConversationSwitcher } from "@/components/conversation-switcher"
import { usePlayer, type AudioMarker, type Track } from "@/components/player-context"
import { formatRelativeDate, formatTimestamp } from "@/lib/format"

type Segment = { start: number; end: number; text: string }
type Insights = {
  summary?: string | null
  takeaways?: string[] | null
  topics?: string[] | null
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
  const [activeConvo, setActiveConvo] = useState<string | null>(null)
  const chat = useConversation(activeConvo)

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
    <div className="flex flex-1 flex-col">
      {/* Minimal header */}
      <header className="flex items-center gap-4 border-b p-4 md:px-6">
        <div className="size-14 shrink-0 overflow-hidden rounded-md bg-muted md:size-16">
          {episode.artworkUrl ? (
            <img src={episode.artworkUrl} alt="" className="size-full object-cover" />
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
        {track && (
          <Button
            size="sm"
            onClick={() => player.play(track)}
            className="shrink-0 gap-2"
          >
            <Play className="size-4" /> Play
          </Button>
        )}
        {episode.status !== "ready" && (
          <Badge variant={statusVariant(episode.status)} className={inFlight ? "animate-pulse" : ""}>
            {episode.status}
          </Badge>
        )}
      </header>

      {episode.status === "failed" ? (
        <div className="space-y-3 p-4 md:p-6">
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
        // Split: tabbed insights/transcript (left), chat sidebar (right)
        <div className="grid flex-1 gap-6 p-4 md:p-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Tabs defaultValue="insights">
              <TabsList>
                <TabsTrigger value="insights">Insights</TabsTrigger>
                <TabsTrigger value="transcript">Transcript</TabsTrigger>
                {/* Chat is a tab on mobile; it lives in the side rail on desktop. */}
                <TabsTrigger value="chat" className="lg:hidden">Chat</TabsTrigger>
              </TabsList>

              <TabsContent value="insights" className="pt-3">
                <Card className="space-y-5 p-5">
                  {insights?.summary && (
                    <p className="font-serif text-lg leading-relaxed">{insights.summary}</p>
                  )}
                  {insights?.takeaways?.length ? (
                    <div>
                      <h3 className="mb-2 text-sm font-medium text-muted-foreground">Takeaways</h3>
                      <ul className="list-disc space-y-1.5 pl-5 font-serif text-lg leading-relaxed">
                        {insights.takeaways.map((t, i) => (
                          <li key={i}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {insights?.topics?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {insights.topics.map((t, i) => (
                        <Link key={i} href={`/topics/${encodeURIComponent(t)}`}>
                          <Badge variant="secondary" className="hover:bg-secondary/70">
                            {t}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {insights?.quotes?.length ? (
                    <div className="space-y-3">
                      {insights.quotes.map((q, i) => (
                        <blockquote key={i} className="border-l-2 pl-3 font-serif text-lg italic leading-relaxed">
                          &ldquo;{q.text}&rdquo;{" "}
                          <button
                            type="button"
                            onClick={() => seek(q.approxTimestampSec)}
                            className="font-sans text-sm text-muted-foreground not-italic hover:text-foreground hover:underline"
                          >
                            [{formatTimestamp(q.approxTimestampSec)}]
                          </button>
                        </blockquote>
                      ))}
                    </div>
                  ) : null}
                  {insights?.entities?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {insights.entities.map((e, i) => (
                        <Link key={i} href={`/topics/${encodeURIComponent(e.name)}`}>
                          <Badge variant="outline" className="hover:bg-muted">
                            {e.name}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {!insights && <p className="text-sm text-muted-foreground">No insights yet.</p>}
                </Card>
              </TabsContent>

              <TabsContent value="transcript" className="pt-3">
                <Card className="p-5">
                  <ScrollArea className="h-[60vh] pr-3">
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
                  </ScrollArea>
                </Card>
              </TabsContent>

              <TabsContent value="chat" className="pt-3 lg:hidden">
                <Card className="p-5">
                  <div className="flex h-full flex-col gap-3">
                    <ConversationSwitcher episodeId={episode.id} activeId={activeConvo} onSelect={setActiveConvo} />
                    <ConversationView chat={chat} onSeek={seek} disabled={!activeConvo} emptyHint="Ask about this episode." />
                  </div>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <aside className="hidden lg:col-span-1 lg:block">
            <Card className="space-y-3 p-4 lg:sticky lg:top-6 max-h-[75vh] flex flex-col">
              <h2 className="text-sm font-medium text-muted-foreground">Ask this episode</h2>
              <div className="flex flex-1 flex-col gap-3 min-h-0">
                <ConversationSwitcher episodeId={episode.id} activeId={activeConvo} onSelect={setActiveConvo} />
                <ConversationView chat={chat} onSeek={seek} disabled={!activeConvo} emptyHint="Ask about this episode." />
              </div>
            </Card>
          </aside>
        </div>
      )}
    </div>
  )
}
