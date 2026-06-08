"use client"

import Link from "next/link"
import { Hash, Lightbulb, ListOrdered, Quote, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatTimestamp } from "@/lib/format"

export type InsightsData = {
  summary?: string | null
  takeaways?: string[] | null
  topics?: string[] | null
  chapters?: { title: string; startSec: number }[] | null
  quotes?: { text: string; approxTimestampSec: number }[] | null
  entities?: { name: string; type: string }[] | null
} | null

const ENTITY_GROUPS: { type: string; label: string }[] = [
  { type: "person", label: "People" },
  { type: "company", label: "Companies" },
  { type: "book", label: "Books" },
  { type: "product", label: "Products" },
  { type: "place", label: "Places" },
  { type: "other", label: "Also mentioned" },
]

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

export function EpisodeInsights({
  insights,
  onSeek,
}: {
  insights: InsightsData
  onSeek: (sec: number) => void
}) {
  if (!insights) return <p className="text-sm text-muted-foreground">No insights yet.</p>

  const chapters = insights.chapters ?? []
  const takeaways = insights.takeaways ?? []
  const quotes = insights.quotes ?? []
  const topics = insights.topics ?? []
  const entities = insights.entities ?? []

  return (
    <div className="space-y-8">
      {insights.summary && (
        <p className="font-serif text-xl leading-relaxed text-foreground">{insights.summary}</p>
      )}

      {chapters.length > 0 && (
        <Section icon={<ListOrdered className="size-3.5" />} title="Chapters">
          <ol className="overflow-hidden rounded-lg border">
            {chapters.map((c, i) => (
              <li key={i} className="border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => onSeek(c.startSec)}
                  className="group flex w-full items-baseline gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted"
                >
                  <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground group-hover:text-foreground">
                    {formatTimestamp(c.startSec)}
                  </span>
                  <span className="text-sm font-medium">{c.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {takeaways.length > 0 && (
        <Section icon={<Lightbulb className="size-3.5" />} title="Key takeaways">
          <ul className="space-y-2.5">
            {takeaways.map((t, i) => (
              <li key={i} className="flex gap-3 font-serif text-lg leading-relaxed">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {quotes.length > 0 && (
        <Section icon={<Quote className="size-3.5" />} title="Notable quotes">
          <div className="space-y-4">
            {quotes.map((q, i) => (
              <blockquote
                key={i}
                className="border-l-2 border-primary/40 pl-4 font-serif text-lg italic leading-relaxed"
              >
                &ldquo;{q.text}&rdquo;{" "}
                <button
                  type="button"
                  onClick={() => onSeek(q.approxTimestampSec)}
                  className="align-middle font-sans text-sm not-italic text-muted-foreground hover:text-foreground hover:underline"
                >
                  [{formatTimestamp(q.approxTimestampSec)}]
                </button>
              </blockquote>
            ))}
          </div>
        </Section>
      )}

      {topics.length > 0 && (
        <Section icon={<Hash className="size-3.5" />} title="Topics">
          <div className="flex flex-wrap gap-1.5">
            {topics.map((t, i) => (
              <Link key={i} href={`/topics/${encodeURIComponent(t)}`}>
                <Badge variant="secondary" className="hover:bg-secondary/70">
                  {t}
                </Badge>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {entities.length > 0 && (
        <Section icon={<Users className="size-3.5" />} title="Mentioned">
          <div className="space-y-3">
            {ENTITY_GROUPS.map(({ type, label }) => {
              const items = entities.filter((e) => (e.type ?? "other") === type)
              if (items.length === 0) return null
              return (
                <div key={type} className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((e, i) => (
                      <Link key={i} href={`/topics/${encodeURIComponent(e.name)}`}>
                        <Badge variant="outline" className="hover:bg-muted">
                          {e.name}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}
    </div>
  )
}
