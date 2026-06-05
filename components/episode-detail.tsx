"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { formatTimestamp } from "@/lib/format"
import { EpisodeChat } from "@/components/episode-chat"

type Segment = { start: number; end: number; text: string }
type Insights = {
  summary?: string | null
  takeaways?: string[] | null
  topics?: string[] | null
  quotes?: { text: string; approxTimestampSec: number }[] | null
  entities?: { name: string; type: string }[] | null
} | null

export function EpisodeDetail(props: {
  episode: { id: string; title: string; podcastName?: string | null; status: string; errorMessage?: string | null }
  transcript: { fullText: string; segments: Segment[] } | null
  insights: Insights
}) {
  const router = useRouter()
  const { episode } = props
  const inFlight = !["ready", "failed"].includes(episode.status)

  // Poll until the episode finishes processing.
  useEffect(() => {
    if (!inFlight) return
    const t = setInterval(() => router.refresh(), 4000)
    return () => clearInterval(t)
  }, [inFlight, router])

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{episode.title}</h1>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <span>{episode.podcastName}</span>
          <Badge variant={episode.status === "ready" ? "default" : episode.status === "failed" ? "destructive" : "secondary"}>
            {episode.status}
          </Badge>
        </div>
        {episode.status === "failed" && (
          <div className="space-y-1">
            <p className="text-destructive text-sm">{episode.errorMessage}</p>
            <button
              className="text-sm underline"
              onClick={async () => {
                await fetch(`/api/episodes/${episode.id}/retry`, { method: "POST" })
                router.refresh()
              }}
            >
              Retry
            </button>
          </div>
        )}
        {inFlight && <p className="text-muted-foreground text-sm">Processing… this page updates automatically.</p>}
      </header>

      {props.insights && (
        <Card className="space-y-3 p-4">
          <h2 className="font-medium">Insights</h2>
          {props.insights.summary && <p className="text-sm">{props.insights.summary}</p>}
          {props.insights.takeaways?.length ? (
            <ul className="list-disc pl-5 text-sm">
              {props.insights.takeaways.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          ) : null}
          {props.insights.topics?.length ? (
            <div className="flex flex-wrap gap-1">
              {props.insights.topics.map((t, i) => <Badge key={i} variant="secondary">{t}</Badge>)}
            </div>
          ) : null}
          {props.insights.quotes?.length ? (
            <div className="space-y-1 text-sm">
              {props.insights.quotes.map((q, i) => (
                <blockquote key={i} className="border-l-2 pl-2 italic">
                  &ldquo;{q.text}&rdquo; <span className="text-muted-foreground">[{formatTimestamp(q.approxTimestampSec)}]</span>
                </blockquote>
              ))}
            </div>
          ) : null}
        </Card>
      )}

      {props.transcript && <EpisodeChat episodeId={episode.id} />}

      {props.transcript && (
        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Transcript</h2>
          <div className="max-h-[480px] space-y-1 overflow-y-auto text-sm">
            {props.transcript.segments.map((s, i) => (
              <p key={i}>
                <span className="text-muted-foreground mr-2 tabular-nums">{formatTimestamp(s.start)}</span>
                {s.text}
              </p>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
