"use client"

import Link from "next/link"
import { Hash, Lightbulb, ListOrdered, Quote, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { formatTimestamp } from "@/lib/format"
import { useHighlightsOptional } from "@/components/highlights-context"
import { MarkedText } from "@/components/highlight-marks"

export type InsightsData = {
  summary?: string | null
  takeaways?: string[] | null
  topics?: string[] | null
  chapters?: { title: string; startSec: number }[] | null
  quotes?: { text: string; approxTimestampSec: number }[] | null
  entities?: { name: string; type: string }[] | null
} | null

export type MentionedEntity = {
  id: string
  name: string
  slug: string
  type: string
  description: string | null
  imageUrl: string | null
  metadata: { author?: string; publishedYear?: number } | null
  context: string | null
  approxTimestampSec: number | null
  mentionCount: number
}

const ENTITY_GROUPS: { type: string; label: string }[] = [
  { type: "person", label: "People" },
  { type: "company", label: "Companies" },
  { type: "book", label: "Books" },
  { type: "product", label: "Products" },
  { type: "place", label: "Places" },
  { type: "other", label: "Also mentioned" },
]

export type InsightSection = { id: string; label: string }

// The sections present for a given insights object, in render order — drives the
// on-this-page nav. Ids match the anchor ids rendered below.
export function insightSections(insights: InsightsData, hasEntities?: boolean): InsightSection[] {
  if (!insights && !hasEntities) return []
  const out: InsightSection[] = []
  if (insights?.summary) out.push({ id: "summary", label: "Overview" })
  if (insights?.chapters?.length) out.push({ id: "chapters", label: "Chapters" })
  if (insights?.takeaways?.length) out.push({ id: "takeaways", label: "Key takeaways" })
  if (insights?.quotes?.length) out.push({ id: "quotes", label: "Notable quotes" })
  if (insights?.topics?.length) out.push({ id: "topics", label: "Topics" })
  if (hasEntities || insights?.entities?.length) out.push({ id: "mentioned", label: "Mentioned" })
  return out
}

function Section({
  id,
  icon,
  title,
  children,
}: {
  id: string
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-4">
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
  entities = [],
  onSeek,
}: {
  insights: InsightsData
  entities?: MentionedEntity[]
  onSeek: (sec: number) => void
}) {
  if (!insights && entities.length === 0)
    return <p className="text-sm text-muted-foreground">No insights yet.</p>

  const chapters = insights?.chapters ?? []
  const takeaways = insights?.takeaways ?? []
  const quotes = insights?.quotes ?? []
  const topics = insights?.topics ?? []
  const legacyEntities = insights?.entities ?? []

  const hl = useHighlightsOptional()
  const marksFor = (kind: string, index: number) =>
    (hl?.highlights ?? [])
      .filter((h) => h.kind === kind && h.locator?.index === index)
      .map((h) => ({ id: h.id, text: h.text }))

  return (
    <div className="space-y-10">
      {insights?.summary && (
        <section id="summary" className="scroll-mt-20">
          <p className="font-serif text-xl leading-relaxed text-foreground">{insights.summary}</p>
        </section>
      )}

      {chapters.length > 0 && (
        <Section id="chapters" icon={<ListOrdered className="size-3.5" />} title="Chapters">
          <ol className="overflow-hidden rounded-lg border">
            {chapters.map((c, i) => (
              <li key={i} className="border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => onSeek(c.startSec)}
                  className="group flex w-full items-baseline gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
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
        <Section id="takeaways" icon={<Lightbulb className="size-3.5" />} title="Key takeaways">
          <ul className="space-y-4">
            {takeaways.map((t, i) => (
              <li key={i} data-hl-kind="takeaway" data-hl-index={String(i)} className="flex gap-3 font-serif text-lg leading-relaxed">
                <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />
                <span>
                  {hl ? <MarkedText text={t} marks={marksFor("takeaway", i)} onMarkClick={hl.openMark} /> : t}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {quotes.length > 0 && (
        <Section id="quotes" icon={<Quote className="size-3.5" />} title="Notable quotes">
          <div className="space-y-5">
            {quotes.map((q, i) => (
              <blockquote
                key={i}
                data-hl-kind="quote"
                data-hl-index={String(i)}
                data-hl-sec={String(q.approxTimestampSec)}
                className="border-l-2 border-primary/40 pl-4 font-serif text-lg italic leading-relaxed"
              >
                &ldquo;{hl ? <MarkedText text={q.text} marks={marksFor("quote", i)} onMarkClick={hl.openMark} /> : q.text}&rdquo;{" "}
                {q.approxTimestampSec > 0 && (
                  <button
                    type="button"
                    onClick={() => onSeek(q.approxTimestampSec)}
                    className="align-middle font-sans text-sm not-italic text-muted-foreground hover:text-foreground hover:underline"
                  >
                    [{formatTimestamp(q.approxTimestampSec)}]
                  </button>
                )}
              </blockquote>
            ))}
          </div>
        </Section>
      )}

      {topics.length > 0 && (
        <Section id="topics" icon={<Hash className="size-3.5" />} title="Topics">
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

      {entities.length > 0 ? (
        <Section id="mentioned" icon={<Users className="size-3.5" />} title="Mentioned">
          <div className="space-y-5">
            {ENTITY_GROUPS.map(({ type, label }) => {
              const items = entities.filter((e) => (e.type ?? "other") === type)
              if (items.length === 0) return null
              if (type === "book") {
                return (
                  <div key={type} className="space-y-2">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <div className="flex flex-wrap gap-3">
                      {items.map((e) => (
                        <Link
                          key={e.id}
                          href={`/entities/${e.slug}`}
                          className="group w-24 space-y-1.5"
                        >
                          <div className="aspect-2/3 w-24 overflow-hidden rounded-md border bg-muted shadow-sm transition-shadow group-hover:shadow-md">
                            {e.imageUrl ? (
                              <img src={e.imageUrl} alt="" className="size-full object-cover" />
                            ) : (
                              <div className="flex size-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                                {e.name}
                              </div>
                            )}
                          </div>
                          <p className="line-clamp-2 text-xs font-medium leading-snug">{e.name}</p>
                          {e.metadata?.author && (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {e.metadata.author}
                            </p>
                          )}
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              }
              return (
                <div key={type} className="space-y-2">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((e) => (
                      <HoverCard key={e.id}>
                        <HoverCardTrigger asChild>
                          <Link href={`/entities/${e.slug}`}>
                            <Badge variant="outline" className="hover:bg-muted">
                              {e.name}
                            </Badge>
                          </Link>
                        </HoverCardTrigger>
                        <HoverCardContent>
                          <div className="flex gap-3">
                            {e.imageUrl && (
                              <div className="size-12 shrink-0 overflow-hidden rounded-full bg-muted">
                                <img src={e.imageUrl} alt="" className="size-full object-cover" />
                              </div>
                            )}
                            <div className="min-w-0 space-y-1">
                              <p className="text-sm font-medium">{e.name}</p>
                              {e.description && (
                                <p className="line-clamp-3 text-xs text-muted-foreground">
                                  {e.description}
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground">
                                Mentioned in {e.mentionCount} episode{e.mentionCount === 1 ? "" : "s"}
                                {e.approxTimestampSec != null && e.approxTimestampSec > 0 && (
                                  <>
                                    {" · "}
                                    <button
                                      type="button"
                                      onClick={() => onSeek(e.approxTimestampSec!)}
                                      className="tabular-nums hover:text-foreground hover:underline"
                                    >
                                      {formatTimestamp(e.approxTimestampSec)}
                                    </button>
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      ) : legacyEntities.length > 0 ? (
        <Section id="mentioned" icon={<Users className="size-3.5" />} title="Mentioned">
          {/* Legacy fallback: episodes not yet backfilled render the old badges. */}
          <div className="space-y-4">
            {ENTITY_GROUPS.map(({ type, label }) => {
              const items = legacyEntities.filter((e) => (e.type ?? "other") === type)
              if (items.length === 0) return null
              return (
                <div key={type} className="space-y-2">
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
      ) : null}
    </div>
  )
}
