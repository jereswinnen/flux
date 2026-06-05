"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
    id: string; title: string; podcastName: string | null; artworkUrl: string | null
    status: string; errorMessage: string | null; publishedAt: string | null
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

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex gap-4">
        <div className="size-24 shrink-0 overflow-hidden rounded-lg bg-muted md:size-32">
          {episode.artworkUrl ? <img src={episode.artworkUrl} alt="" className="size-full object-cover" /> : null}
        </div>
        <div className="min-w-0 space-y-2">
          <h1 className="text-xl font-semibold md:text-2xl">{episode.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {episode.podcastName && <span>{episode.podcastName}</span>}
            {episode.publishedAt && <span>· {formatRelativeDate(episode.publishedAt)}</span>}
            <Badge variant={statusVariant(episode.status)} className={inFlight ? "animate-pulse" : ""}>
              {episode.status}
            </Badge>
          </div>
          {episode.status === "failed" && (
            <div className="space-y-1">
              <p className="text-sm text-destructive">{episode.errorMessage}</p>
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
          )}
          {inFlight && <p className="text-sm text-muted-foreground">Processing… this page updates automatically.</p>}
        </div>
      </div>

      {transcript ? (
        <Tabs defaultValue="insights" className="w-full">
          <TabsList>
            <TabsTrigger value="insights">Insights</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="ask">Ask</TabsTrigger>
          </TabsList>

          <TabsContent value="insights" className="space-y-4 pt-2">
            {insights?.summary && <p className="text-sm leading-relaxed">{insights.summary}</p>}
            {insights?.takeaways?.length ? (
              <div>
                <h3 className="mb-1 text-sm font-medium">Takeaways</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {insights.takeaways.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            ) : null}
            {insights?.topics?.length ? (
              <div className="flex flex-wrap gap-1">
                {insights.topics.map((t, i) => <Badge key={i} variant="secondary">{t}</Badge>)}
              </div>
            ) : null}
            {insights?.quotes?.length ? (
              <div className="space-y-2">
                {insights.quotes.map((q, i) => (
                  <blockquote key={i} className="border-l-2 pl-3 text-sm italic">
                    &ldquo;{q.text}&rdquo; <span className="text-muted-foreground">[{formatTimestamp(q.approxTimestampSec)}]</span>
                  </blockquote>
                ))}
              </div>
            ) : null}
            {insights?.entities?.length ? (
              <div className="flex flex-wrap gap-1">
                {insights.entities.map((e, i) => <Badge key={i} variant="outline">{e.name}</Badge>)}
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="transcript" className="pt-2">
            <ScrollArea className="h-[60vh] rounded-md border p-4">
              <div className="space-y-1 text-sm">
                {transcript.segments.map((s, i) => (
                  <p key={i}>
                    <span className="mr-2 tabular-nums text-muted-foreground">{formatTimestamp(s.start)}</span>
                    {s.text}
                  </p>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="ask" className="pt-2">
            <EpisodeChat episodeId={episode.id} />
          </TabsContent>
        </Tabs>
      ) : (
        <p className="text-sm text-muted-foreground">
          {episode.status === "failed" ? "Processing failed." : "Transcript will appear here once processing finishes."}
        </p>
      )}
    </div>
  )
}
