"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EpisodeChat } from "@/components/episode-chat"
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
        <Badge variant={statusVariant(episode.status)} className={inFlight ? "animate-pulse" : ""}>
          {episode.status}
        </Badge>
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
                        <Badge key={i} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {insights?.quotes?.length ? (
                    <div className="space-y-3">
                      {insights.quotes.map((q, i) => (
                        <blockquote key={i} className="border-l-2 pl-3 font-serif text-lg italic leading-relaxed">
                          &ldquo;{q.text}&rdquo;{" "}
                          <span className="font-sans text-sm text-muted-foreground not-italic">
                            [{formatTimestamp(q.approxTimestampSec)}]
                          </span>
                        </blockquote>
                      ))}
                    </div>
                  ) : null}
                  {insights?.entities?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {insights.entities.map((e, i) => (
                        <Badge key={i} variant="outline">
                          {e.name}
                        </Badge>
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
                          <span className="mr-2 font-sans text-sm tabular-nums text-muted-foreground">
                            {formatTimestamp(s.start)}
                          </span>
                          {s.text}
                        </p>
                      ))}
                    </div>
                  </ScrollArea>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <aside className="lg:col-span-1">
            <Card className="space-y-3 p-4 lg:sticky lg:top-6">
              <h2 className="text-sm font-medium text-muted-foreground">Ask this episode</h2>
              <EpisodeChat episodeId={episode.id} />
            </Card>
          </aside>
        </div>
      )}
    </div>
  )
}
