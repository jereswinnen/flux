import Link from "next/link"
import { notFound } from "next/navigation"
import { ExternalLink } from "lucide-react"
import { db } from "@/lib/db"
import {
  coMentionedEntities,
  episodesMentioningEntity,
  getEntityBySlug,
} from "@/lib/db/entities"
import { AppHeader } from "@/components/app-header"
import { Badge } from "@/components/ui/badge"
import { hiResArtwork } from "@/lib/artwork"
import { episodeHref } from "@/lib/episode-href"
import { formatTimestamp } from "@/lib/format"

export const dynamic = "force-dynamic"

const TYPE_LABELS: Record<string, string> = {
  person: "Person",
  company: "Company",
  book: "Book",
  product: "Product",
  place: "Place",
  other: "Mention",
}

export default async function EntityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entity = await getEntityBySlug(db, slug)
  if (!entity) notFound()

  const [mentions, related] = await Promise.all([
    episodesMentioningEntity(db, entity.id),
    coMentionedEntities(db, entity.id),
  ])

  const externalUrl =
    entity.wikipediaUrl ??
    (entity.externalIds?.googleBooksId
      ? `https://books.google.com/books?id=${entity.externalIds.googleBooksId}`
      : null) ??
    (entity.externalIds?.itunesId
      ? `https://apps.apple.com/app/id${entity.externalIds.itunesId}`
      : null)
  const externalLabel = entity.wikipediaUrl
    ? "Wikipedia"
    : entity.externalIds?.googleBooksId
      ? "Google Books"
      : entity.type === "book"
        ? "Apple Books"
        : "App Store"
  const bookMeta = [entity.metadata?.author, entity.metadata?.publishedYear]
    .filter(Boolean)
    .join(" · ")

  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Library", href: "/" }, { label: entity.name }]} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 md:p-6">
        <div className="mx-auto w-full max-w-3xl space-y-8">
          <header className="flex items-start gap-4">
            {entity.imageUrl && (
              <div
                className={`shrink-0 overflow-hidden bg-muted ${
                  entity.type === "book" ? "h-28 w-20 rounded-md" : "size-20 rounded-full"
                }`}
              >
                <img src={entity.imageUrl} alt="" className="size-full object-cover" />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold">{entity.name}</h1>
                <Badge variant="secondary">{TYPE_LABELS[entity.type] ?? entity.type}</Badge>
              </div>
              {entity.type === "book" && bookMeta && (
                <p className="text-sm text-muted-foreground">{bookMeta}</p>
              )}
              {entity.description && (
                <p className="text-sm text-muted-foreground">{entity.description}</p>
              )}
              {externalUrl && (
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  {externalLabel}
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </header>

          {entity.summary && (
            <p className="font-serif text-lg leading-relaxed">{entity.summary}</p>
          )}

          <section className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Mentioned in {mentions.length} episode{mentions.length === 1 ? "" : "s"}
            </h2>
            {mentions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No episodes yet.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                {mentions.map((m) => (
                  <Link
                    key={m.id}
                    href={
                      m.approxTimestampSec != null
                        ? episodeHref(m.id, m.approxTimestampSec)
                        : `/episodes/${m.id}`
                    }
                    className="flex items-start gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-muted"
                  >
                    <div className="size-10 shrink-0 overflow-hidden rounded bg-muted">
                      {m.artworkUrl ? (
                        <img src={hiResArtwork(m.artworkUrl, 120)} alt="" className="size-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.title}</p>
                      {m.context && (
                        <p className="line-clamp-2 text-sm text-muted-foreground">{m.context}</p>
                      )}
                    </div>
                    {m.approxTimestampSec != null && (
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {formatTimestamp(m.approxTimestampSec)}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </section>

          {related.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Often mentioned with
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {related.map((r) => (
                  <Link key={r.id} href={`/entities/${r.slug}`}>
                    <Badge variant="outline" className="hover:bg-muted">
                      {r.name}
                    </Badge>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
