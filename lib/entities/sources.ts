import type { EntityType } from "@/lib/db/schema"

export interface Candidate {
  source: "wikipedia" | "googleBooks" | "itunes"
  title: string
  description?: string
  summary?: string
  imageUrl?: string
  url?: string
  wikidataId?: string
  externalIds?: { itunesId?: number; isbn?: string; googleBooksId?: string }
  metadata?: { author?: string; publishedYear?: number }
}

// Wikimedia asks API clients to identify themselves.
const HEADERS = { "User-Agent": "flux-podcast-kb/0.1 (hey@jeremys.be)" }

// Light in-memory TTL cache (same pattern as lib/itunes/client.ts). Entity
// lookups repeat across episodes within a process lifetime.
const cache = new Map<string, { at: number; data: unknown }>()
const TTL_MS = 60 * 60_000

async function getJson(url: string): Promise<unknown> {
  const hit = cache.get(url)
  const now = Date.now()
  if (hit) {
    if (now - hit.at < TTL_MS) return hit.data
    cache.delete(url)
  }
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`entity source request failed: ${res.status} ${url}`)
  const data: unknown = await res.json()
  cache.set(url, { at: now, data })
  return data
}

interface WikiSearchPage {
  key: string
}

interface WikiSearchResult {
  pages?: WikiSearchPage[]
}

interface WikiSummary {
  title?: string
  description?: string
  extract?: string
  thumbnail?: { source?: string }
  content_urls?: { desktop?: { page?: string } }
  wikibase_item?: string
}

async function wikipediaCandidates(name: string): Promise<Candidate[]> {
  const search = (await getJson(
    `https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(name)}&limit=3`,
  )) as WikiSearchResult
  const pages = (search.pages ?? []).filter((p) => typeof p.key === "string")
  const settled = await Promise.allSettled(
    pages.map((page) =>
      getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.key)}`),
    ),
  )
  return settled
    .filter((s): s is PromiseFulfilledResult<unknown> => s.status === "fulfilled")
    .map((s) => {
      const summary = s.value as WikiSummary
      return {
        source: "wikipedia" as const,
        title: summary.title ?? name,
        description: summary.description ?? undefined,
        summary: summary.extract ?? undefined,
        imageUrl: summary.thumbnail?.source ?? undefined,
        url: summary.content_urls?.desktop?.page ?? undefined,
        wikidataId: summary.wikibase_item ?? undefined,
      }
    })
}

interface BookIdentifier {
  type: string
  identifier: string
}

interface VolumeInfo {
  title?: string
  authors?: string[]
  publishedDate?: string
  description?: string
  imageLinks?: { thumbnail?: string }
  industryIdentifiers?: BookIdentifier[]
  canonicalVolumeLink?: string
  infoLink?: string
}

interface BookItem {
  id?: string
  volumeInfo?: VolumeInfo
}

interface GoogleBooksResult {
  items?: BookItem[]
}

async function googleBooksCandidates(name: string): Promise<Candidate[]> {
  const data = (await getJson(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(name)}&maxResults=3&printType=books`,
  )) as GoogleBooksResult
  const items = data.items ?? []
  return items.map((item) => {
    const v = item.volumeInfo ?? {}
    const isbn = (v.industryIdentifiers ?? []).find(
      (i) => i.type === "ISBN_13" || i.type === "ISBN_10",
    )?.identifier
    const year = v.publishedDate ? Number(String(v.publishedDate).slice(0, 4)) : undefined
    const externalIds =
      isbn !== undefined || item.id !== undefined ? { isbn, googleBooksId: item.id } : undefined
    return {
      source: "googleBooks" as const,
      title: v.title ?? name,
      description: v.authors?.length ? `Book by ${v.authors.join(", ")}` : "Book",
      summary: v.description ?? undefined,
      imageUrl: v.imageLinks?.thumbnail?.replace(/^http:/, "https:") ?? undefined,
      url: v.canonicalVolumeLink ?? v.infoLink ?? undefined,
      externalIds,
      metadata: {
        author: v.authors?.[0],
        publishedYear: Number.isFinite(year) ? year : undefined,
      },
    }
  })
}

interface ItunesResult {
  trackId?: number
  trackName?: string
  sellerName?: string
  description?: string
  artworkUrl100?: string
  trackViewUrl?: string
}

interface ItunesSearchResult {
  results?: ItunesResult[]
}

async function itunesProductCandidates(name: string): Promise<Candidate[]> {
  const data = (await getJson(
    `https://itunes.apple.com/search?media=software&limit=2&term=${encodeURIComponent(name)}`,
  )) as ItunesSearchResult
  const results = data.results ?? []
  return results.map((r) => ({
    source: "itunes" as const,
    title: r.trackName ?? name,
    description: r.sellerName ? `App by ${r.sellerName}` : "App",
    summary: typeof r.description === "string" ? r.description.slice(0, 400) : undefined,
    imageUrl: r.artworkUrl100 ?? undefined,
    url: r.trackViewUrl ?? undefined,
    externalIds: r.trackId !== undefined ? { itunesId: r.trackId } : undefined,
  }))
}

type SourceOutcome = { candidates: Candidate[]; errored: boolean }

const attempt = async (p: Promise<Candidate[]>): Promise<SourceOutcome> => {
  try {
    return { candidates: await p, errored: false }
  } catch {
    return { candidates: [], errored: true }
  }
}

// Top external candidates for an extracted entity, routed by type. Per-source
// failures degrade to [] so enrichment never blocks the pipeline. However,
// searchCandidates throws when ALL sources errored with no candidates, so
// callers can mark the entity retryably failed.
export async function searchCandidates(name: string, type: EntityType): Promise<Candidate[]> {
  const sources =
    type === "book"
      ? [googleBooksCandidates(name)]
      : type === "product"
        ? [wikipediaCandidates(name), itunesProductCandidates(name)]
        : [wikipediaCandidates(name)]
  const outcomes = await Promise.all(sources.map(attempt))
  const candidates = outcomes.flatMap((o) => o.candidates)
  if (candidates.length === 0 && outcomes.every((o) => o.errored)) {
    throw new Error(`all candidate sources failed for "${name}" (${type})`)
  }
  return candidates
}
