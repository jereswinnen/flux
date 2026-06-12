# Web Article Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users paste a web-article URL and have the server extract its content + images, then run it through the existing analysis pipeline so the article becomes a fully searchable, askable, highlightable, insight-bearing library entry with a clean reading view.

**Architecture:** A new `articleAdapter` (the existing `SourceAdapter` pattern) fetches the page, extracts it with Mozilla Readability, sanitizes the HTML, backfills item metadata, and calls the existing `processContent` pipeline — which already does insights → chunk → embed → entities → status. Article-specific code is confined to extraction, a `content_html` column, and a reading-view branch. Highlights need zero changes (the stack already handles `kind: "article"`).

**Tech Stack:** Next.js 16, Drizzle (postgres-js), Postgres, Vitest, TypeScript, `@mozilla/readability` + `linkedom` + `sanitize-html`.

**Spec:** `docs/superpowers/specs/2026-06-13-web-article-source-design.md`

## File Structure

- **Create:** `lib/article/extract.ts` (+ `test/article/extract.test.ts`), `lib/sources/article.ts` (+ `test/sources/article.test.ts`), `lib/episode-href.ts` (+ `test/episode-href.test.ts`), `lib/db/migrations/0007_article_content.sql`.
- **Modify:** `lib/db/schema.ts` (transcripts `content_html`), `lib/db/migrations/meta/_journal.json`, `lib/pipeline/process-content.ts` (persist `contentHtml`), `lib/sources/registry.ts` (register adapter), `components/add-command.tsx` ("Add this article"), `lib/db/search.ts` is **not** touched, `components/search-view.tsx` + `components/chat-message.tsx` + `app/entities/[slug]/page.tsx` + `components/add-command.tsx` (use `episodeHref`), `app/episodes/[id]/page.tsx` (pass `contentHtml`), `components/episode-view.tsx` (article branch).

---

## Task 1: Article extraction module

**Files:** Create `lib/article/extract.ts`, `test/article/extract.test.ts`.

Network `fetch` is isolated in `extractArticle`; the parse/sanitize core (`parseArticle`) is pure and unit-tested against fixture HTML.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install @mozilla/readability linkedom sanitize-html
npm install -D @types/sanitize-html
```
Expected: installs succeed, `package.json` updated.

- [ ] **Step 2: Write `test/article/extract.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { parseArticle, paragraphsToSegments } from "@/lib/article/extract"

const HTML = `<!doctype html><html><head>
  <title>Site Title</title>
  <meta property="og:image" content="/images/hero.jpg">
  <meta property="og:site_name" content="Example Times">
  <meta name="author" content="Jane Doe">
  <meta property="article:published_time" content="2026-01-02T03:04:05Z">
</head><body>
  <article>
    <h1>The Real Headline</h1>
    <p>First paragraph with enough words to clear the readability content
       threshold so the parser treats this as a genuine article body and not
       boilerplate navigation chrome that should be discarded.</p>
    <p>Second paragraph continues the discussion with additional sentences,
       a <a href="/rel/link">relative link</a> and an
       <img src="/rel/inline.png" alt="inline"> inline image to absolutize.</p>
    <script>window.evil = 1</script>
    <p onclick="steal()">Third paragraph with an event handler to strip.</p>
  </article>
</body></html>`

describe("parseArticle", () => {
  const a = parseArticle(HTML, "https://example.com/news/story")

  it("pulls title, byline, site name, lead image (absolutized)", () => {
    expect(a.title).toBe("The Real Headline")
    expect(a.byline).toBe("Jane Doe")
    expect(a.siteName).toBe("Example Times")
    expect(a.leadImageUrl).toBe("https://example.com/images/hero.jpg")
    expect(a.publishedAt).toBe("2026-01-02T03:04:05Z")
  })

  it("returns plain textContent for the pipeline", () => {
    expect(a.textContent).toContain("First paragraph")
    expect(a.textContent).not.toContain("<p>")
  })

  it("sanitizes: no scripts, no event handlers, absolutized urls", () => {
    expect(a.contentHtml).not.toContain("<script")
    expect(a.contentHtml).not.toContain("onclick")
    expect(a.contentHtml).not.toContain("window.evil")
    expect(a.contentHtml).toContain('href="https://example.com/rel/link"')
    expect(a.contentHtml).toContain('src="https://example.com/rel/inline.png"')
    expect(a.contentHtml).toContain('loading="lazy"')
  })
})

describe("paragraphsToSegments", () => {
  it("splits on blank lines, zero timestamps", () => {
    const segs = paragraphsToSegments("one two\n\nthree four\n\n  \n\nfive")
    expect(segs).toEqual([
      { start: 0, end: 0, text: "one two" },
      { start: 0, end: 0, text: "three four" },
      { start: 0, end: 0, text: "five" },
    ])
  })
})
```

- [ ] **Step 3: Run — expect FAIL** (`npm test -- test/article/extract.test.ts`).

- [ ] **Step 4: Create `lib/article/extract.ts`**

```ts
import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import sanitizeHtml from "sanitize-html"
import type { Segment } from "@/lib/ai/chunk"

export interface ExtractedArticle {
  title: string
  byline?: string
  siteName?: string
  leadImageUrl?: string
  excerpt?: string
  publishedAt?: string
  contentHtml: string
  textContent: string
}

/** Absolutize a possibly-relative URL against the article URL; drop on failure. */
function absolutize(href: string | null | undefined, base: string): string | undefined {
  if (!href) return undefined
  try {
    return new URL(href, base).toString()
  } catch {
    return undefined
  }
}

function sanitize(html: string, base: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "p", "ul", "ol", "li", "blockquote", "pre", "code",
      "a", "img", "strong", "em", "b", "i", "figure", "figcaption", "hr", "br",
    ],
    allowedAttributes: { a: ["href"], img: ["src", "alt"] },
    allowedSchemes: ["http", "https"],
    transformTags: {
      a: (tagName, attribs) => {
        const href = absolutize(attribs.href, base)
        return {
          tagName: "a",
          attribs: href
            ? { href, target: "_blank", rel: "noopener noreferrer" }
            : {},
        }
      },
      img: (tagName, attribs) => {
        const src = absolutize(attribs.src, base)
        return {
          tagName: "img",
          attribs: src
            ? { src, alt: attribs.alt ?? "", loading: "lazy", decoding: "async" }
            : {},
        }
      },
    },
    // Drop empty <a>/<img> left when a URL failed to absolutize.
    exclusiveFilter: (f) =>
      (f.tag === "a" && !f.attribs.href) || (f.tag === "img" && !f.attribs.src),
  })
}

/** Pure parse + sanitize. `url` is used to absolutize relative links/images. */
export function parseArticle(html: string, url: string): ExtractedArticle {
  const { document } = parseHTML(html)

  const meta = (sel: string) =>
    document.querySelector(sel)?.getAttribute("content") ?? undefined
  const ogImage = meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]')
  const ogSite = meta('meta[property="og:site_name"]')
  const published = meta('meta[property="article:published_time"]')

  const parsed = new Readability(document).parse()
  if (!parsed || !parsed.textContent || parsed.textContent.trim().length < 200) {
    throw new Error("Could not extract article content from this page")
  }

  const contentHtml = sanitize(parsed.content ?? "", url)
  // Fallback lead image: first <img> in the sanitized body.
  const firstImg = parseHTML(contentHtml).document.querySelector("img")?.getAttribute("src")

  return {
    title: (parsed.title || document.title || url).trim(),
    byline: parsed.byline?.trim() || meta('meta[name="author"]'),
    siteName: parsed.siteName?.trim() || ogSite,
    leadImageUrl: absolutize(ogImage, url) ?? firstImg ?? undefined,
    excerpt: parsed.excerpt?.trim() || undefined,
    publishedAt: published,
    contentHtml,
    textContent: parsed.textContent.trim(),
  }
}

/** Fetch the page then parse it. Throws on network / non-HTML / empty body. */
export async function extractArticle(url: string): Promise<ExtractedArticle> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  })
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
  const ct = res.headers.get("content-type") ?? ""
  if (!ct.includes("html")) throw new Error("URL is not an HTML page")
  const html = await res.text()
  return parseArticle(html, url)
}

/** Article body → pipeline segments. Articles have no timestamps (start/end 0). */
export function paragraphsToSegments(text: string): Segment[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((t) => ({ start: 0, end: 0, text: t }))
}
```

- [ ] **Step 5: Run — expect PASS** (`npm test -- test/article/extract.test.ts`). If Readability+linkedom needs a minor tweak (e.g. the lead-image fallback), adjust the implementation, not the assertions. Then commit:

```bash
git add lib/article/extract.ts test/article/extract.test.ts package.json package-lock.json
git commit -m "feat(article): Readability extraction + sanitization"
```

---

## Task 2: Article source adapter

**Files:** Create `lib/sources/article.ts`, `test/sources/article.test.ts`.

- [ ] **Step 1: Write `test/sources/article.test.ts`** (detection only — `startProcessing` does network + DB and is covered by build + manual)

```ts
import { describe, expect, it } from "vitest"
import { articleAdapter } from "@/lib/sources/article"

describe("articleAdapter.detect", () => {
  it("accepts a normal web article URL", () => {
    expect(articleAdapter.detect("https://example.com/2026/the-story")).toBe(true)
    expect(articleAdapter.detect("http://blog.example.org/posts/hello")).toBe(true)
  })
  it("rejects youtube, feeds, audio files, and non-URLs", () => {
    expect(articleAdapter.detect("https://youtu.be/dQw4w9WgXcQ")).toBe(false)
    expect(articleAdapter.detect("https://example.com/feed")).toBe(false)
    expect(articleAdapter.detect("https://example.com/podcast.rss")).toBe(false)
    expect(articleAdapter.detect("https://cdn.example.com/ep/12.mp3")).toBe(false)
    expect(articleAdapter.detect("not a url")).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `lib/sources/article.ts`**

```ts
import type { ItemRow } from "@/lib/api/dto"
import { db } from "@/lib/db"
import { itemRepo } from "@/lib/db/items"
import type { NewItem } from "@/lib/db/items"
import { processContent } from "@/lib/pipeline/process-content"
import { extractArticle, paragraphsToSegments } from "@/lib/article/extract"
import { isUrl, looksLikeFeedUrl } from "@/lib/url"
import { isYouTubeUrl } from "@/lib/sources/youtube-url"
import type { SourceAdapter } from "./types"

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|wav|flac)(\?|#|$)/i

export const articleAdapter: SourceAdapter = {
  type: "article",
  detect: (input) =>
    isUrl(input) &&
    !isYouTubeUrl(input) &&
    !looksLikeFeedUrl(input) &&
    !AUDIO_EXT.test(input.trim()),
  async resolve(input): Promise<NewItem> {
    return {
      type: "article",
      title: input.trim(), // placeholder; backfilled after extraction
      sourceUrl: input.trim(),
      sourceMetadata: {},
    }
  },
  async startProcessing(item: ItemRow) {
    if (!item.sourceUrl) throw new Error("article item missing sourceUrl")
    const article = await extractArticle(item.sourceUrl)
    await itemRepo.updateMeta(item.id, {
      title: article.title,
      podcastName: article.byline ?? article.siteName,
      artworkUrl: article.leadImageUrl,
      publishedAt: article.publishedAt ? new Date(article.publishedAt) : undefined,
    })
    await processContent(
      {
        itemId: item.id,
        transcript: article.textContent,
        segments: paragraphsToSegments(article.textContent),
        contentHtml: article.contentHtml,
      },
      { db },
    )
  },
}
```

NOTE: confirm `itemRepo.updateMeta`'s accepted fields (`title`, `podcastName`, `artworkUrl`, `publishedAt`) match `lib/db/items.ts` — the YouTube callback uses the same. If `updateMeta` rejects `undefined` fields, omit undefined keys (build the object conditionally like the Modal callback does).

- [ ] **Step 4: Run — expect PASS** (`npm test -- test/sources/article.test.ts`); `npm run typecheck` clean. Commit:

```bash
git add lib/sources/article.ts test/sources/article.test.ts
git commit -m "feat(article): source adapter (detect + extract + processContent)"
```

---

## Task 3: Schema — `content_html` on transcripts

**Files:** Modify `lib/db/schema.ts`.

- [ ] **Step 1: Add the column** to the `transcripts` table (after `segments`):

```ts
export const transcripts = pgTable("transcripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  fullText: text("full_text").notNull(),
  segments: jsonb("segments").$type<TranscriptSegment[]>(),
  contentHtml: text("content_html"),
})
```

- [ ] **Step 2: Typecheck** — `npm run typecheck`; `schema.ts` clean.

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): transcripts.content_html (article reading view)"
```

---

## Task 4: Migration `0007_article_content`

**Files:** Create `lib/db/migrations/0007_article_content.sql`; Modify `lib/db/migrations/meta/_journal.json`.

- [ ] **Step 1: Create `lib/db/migrations/0007_article_content.sql`** (verbatim)

```sql
ALTER TABLE "transcripts" ADD COLUMN "content_html" text;
```

- [ ] **Step 2: Append to `lib/db/migrations/meta/_journal.json`** entries array (after the `idx: 6` entry — add a comma after its closing brace):

```json
    {
      "idx": 7,
      "version": "7",
      "when": 1781400000000,
      "tag": "0007_article_content",
      "breakpoints": true
    }
```

- [ ] **Step 3: Apply to the app DB**

Run: `npm run db:migrate`
Expected: applied, no error.

- [ ] **Step 4: Commit**

```bash
git add lib/db/migrations/0007_article_content.sql lib/db/migrations/meta/_journal.json
git commit -m "chore(db): migration for transcripts.content_html"
```

---

## Task 5: Pipeline plumbing for `contentHtml`

**Files:** Modify `lib/pipeline/process-content.ts`, Test `test/pipeline/process-content-article.test.ts`.

- [ ] **Step 1: Add `contentHtml` to `TranscriptResult` and persist it.** In `lib/pipeline/process-content.ts`, change the interface and the transcript insert:

Interface (add the optional field):
```ts
export interface TranscriptResult {
  itemId: string
  transcript: string
  segments: Segment[]
  contentHtml?: string
}
```

Transcript insert (add the column):
```ts
    // 1. Store transcript
    await db.insert(schema.transcripts).values({
      itemId: result.itemId,
      fullText: result.transcript,
      segments: result.segments,
      contentHtml: result.contentHtml,
    })
```

(Everything else in `processContent` is unchanged. Existing callers omit `contentHtml`, so it stores `null`.)

- [ ] **Step 2: Write `test/pipeline/process-content-article.test.ts`** (test-DB; injects stub deps so no network/LLM, asserts `content_html` persists and status → ready)

```ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeItemRepo } from "@/lib/db/items"
import { processContent } from "@/lib/pipeline/process-content"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const items = makeItemRepo(db)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
beforeEach(async () => {
  await db.delete(schema.transcripts)
  await db.delete(schema.items)
})
afterAll(async () => {
  await client.end()
})

test("persists content_html and marks the item ready", async () => {
  const item = await items.create({ type: "article", title: "A", sourceUrl: "https://x/y" })
  await processContent(
    {
      itemId: item.id,
      transcript: "hello world body text",
      segments: [{ start: 0, end: 0, text: "hello world body text" }],
      contentHtml: "<p>hello world</p>",
    },
    {
      db,
      generateInsights: async () => ({
        summary: "s", takeaways: [], topics: [], chapters: [], quotes: [], entities: [],
      }),
      embedTexts: async (texts) => texts.map(() => Array(1536).fill(0)),
      resolveEntities: async () => {},
    },
  )
  const [t] = await db.select().from(schema.transcripts).where(eq(schema.transcripts.itemId, item.id))
  expect(t.contentHtml).toBe("<p>hello world</p>")
  const after = await items.getById(item.id)
  expect(after?.status).toBe("ready")
})
```

NOTE: confirm the embedding vector width (the stub uses 1536). If `lib/ai/embeddings` / the `chunks.embedding` column uses a different dimension, match it. Confirm the `Insights` stub shape against `lib/ai/insights` (fields may be nullable — `summary/takeaways/topics/chapters/quotes/entities`). Adjust the stub to satisfy the type if needed; keep the two assertions.

- [ ] **Step 3: Run — expect PASS** (`npm test -- test/pipeline/process-content-article.test.ts`). Commit:

```bash
git add lib/pipeline/process-content.ts test/pipeline/process-content-article.test.ts
git commit -m "feat(pipeline): persist contentHtml on the transcript row"
```

---

## Task 6: Register adapter + add-command entry

**Files:** Modify `lib/sources/registry.ts`, `components/add-command.tsx`.

- [ ] **Step 1: Register in `lib/sources/registry.ts`.** Import and add the article adapter; it must be **last** in `URL_ADAPTERS` (it matches broadly):

```ts
import type { NewItem } from "@/lib/db/items"
import { articleAdapter } from "./article"
import { podcastAdapter } from "./podcast"
import type { SourceAdapter } from "./types"
import { youtubeAdapter } from "./youtube"

// URL-based adapters checked in order by detect(); article is the broad fallback.
const URL_ADAPTERS: SourceAdapter[] = [youtubeAdapter, articleAdapter]
const BY_TYPE: Partial<Record<NewItem["type"], SourceAdapter>> = {
  podcast: podcastAdapter,
  youtube: youtubeAdapter,
  article: articleAdapter,
}
```

(Leave `detectAdapter`/`getAdapter` unchanged.)

- [ ] **Step 2: Add-command "Add this article" entry.** In `components/add-command.tsx`, the URL group currently routes youtube / feed / else→audio. Update the `else` branch to add an article, and only treat audio-extension URLs as audio. Replace the `urlQuery` `CommandItem`'s `onSelect` and label logic:

Add this import near the other `@/lib/...` imports:
```ts
import { articleAdapter } from "@/lib/sources/article"
```

Replace the existing `onSelect` for the URL item with:
```tsx
                  onSelect={() => {
                    if (isYouTubeUrl(urlQuery)) {
                      ingestItem({ url: urlQuery })
                    } else if (looksLikeFeedUrl(urlQuery)) {
                      loadShowEpisodes(urlQuery, {})
                    } else if (articleAdapter.detect(urlQuery)) {
                      ingestItem({ url: urlQuery })
                    } else {
                      ingest({ title: urlQuery, audioUrl: urlQuery, sourceUrl: urlQuery })
                    }
                  }}
```

Replace the label expression with:
```tsx
                  {isYouTubeUrl(urlQuery)
                    ? "Add this YouTube video"
                    : looksLikeFeedUrl(urlQuery)
                      ? "Load feed episodes"
                      : articleAdapter.detect(urlQuery)
                        ? "Add this article"
                        : "Add this audio URL"}
```

NOTE: `articleAdapter` imports `@/lib/db` (server singleton) transitively via its module. If importing it into this client component pulls server-only code into the client bundle and the build errors, instead **inline the same predicate** here: `isUrl(urlQuery) && !isYouTubeUrl(urlQuery) && !looksLikeFeedUrl(urlQuery) && !/\.(mp3|m4a|aac|ogg|oga|wav|flac)(\?|#|$)/i.test(urlQuery)` (import `isUrl` from `@/lib/url`, already used in this file). Prefer the inline predicate if there's any doubt — it avoids the server-import risk entirely.

- [ ] **Step 3: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors (baseline 11).

- [ ] **Step 4: Commit**

```bash
git add lib/sources/registry.ts components/add-command.tsx
git commit -m "feat(article): register adapter + add-command entry"
```

---

## Task 7: `episodeHref` helper — drop `?t=` when there's no timestamp

**Files:** Create `lib/episode-href.ts`, `test/episode-href.test.ts`; Modify `components/search-view.tsx`, `components/chat-message.tsx`, `app/entities/[slug]/page.tsx`, `components/add-command.tsx`.

Articles have `startSec 0` on every chunk/quote; a `?t=0` deep link is meaningless. This helper centralizes the rule (drop `?t=` when `sec <= 0`), which is correct for every type.

- [ ] **Step 1: Write `test/episode-href.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { episodeHref } from "@/lib/episode-href"

describe("episodeHref", () => {
  it("adds ?t= for a positive timestamp", () => {
    expect(episodeHref("i1", 42.7)).toBe("/episodes/i1?t=42")
  })
  it("omits ?t= for zero / missing (articles)", () => {
    expect(episodeHref("i1", 0)).toBe("/episodes/i1")
    expect(episodeHref("i1")).toBe("/episodes/i1")
    expect(episodeHref("i1", -5)).toBe("/episodes/i1")
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `lib/episode-href.ts`**

```ts
/** Link to an episode/item, deep-linking to a timestamp only when one exists.
 *  Articles (and any zero-timestamp hit) get the bare item URL. */
export function episodeHref(itemId: string, startSec?: number): string {
  if (typeof startSec === "number" && startSec > 0) {
    return `/episodes/${itemId}?t=${Math.floor(startSec)}`
  }
  return `/episodes/${itemId}`
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Replace the search-hit/moment `?t=` call sites** with `episodeHref` (import it in each file: `import { episodeHref } from "@/lib/episode-href"`):

- `components/search-view.tsx:89` → `href={episodeHref(s.itemId, s.startSec)}`
- `components/search-view.tsx:281` → `href={episodeHref(item.itemId, item.startSec)}`
- `components/chat-message.tsx:86` → `router.push(episodeHref(s.itemId, s.startSec))`
- `app/entities/[slug]/page.tsx:112` → `? episodeHref(m.id, m.approxTimestampSec)` (keep the surrounding ternary; replace only the truthy URL string)
- `components/add-command.tsx:332` → `onSelect={() => goTo(episodeHref(m.itemId, m.startSec))}`

(Leave `lib/highlights/locator.ts:48` alone — it already guards `sec > 0`.)

- [ ] **Step 6: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors.

- [ ] **Step 7: Commit**

```bash
git add lib/episode-href.ts test/episode-href.test.ts components/search-view.tsx components/chat-message.tsx app/entities/[slug]/page.tsx components/add-command.tsx
git commit -m "feat: episodeHref helper — omit ?t= for zero-timestamp (article) hits"
```

---

## Task 8: Reading view (article branch)

**Files:** Modify `app/episodes/[id]/page.tsx`, `components/episode-view.tsx`.

- [ ] **Step 1: Pass `contentHtml` from the page.** In `app/episodes/[id]/page.tsx`, the transcript prop currently is:

```tsx
        transcript={transcript ? { fullText: transcript.fullText, segments: transcript.segments ?? [] } : null}
```
Change it to include the HTML:
```tsx
        transcript={transcript ? { fullText: transcript.fullText, segments: transcript.segments ?? [], contentHtml: transcript.contentHtml ?? null } : null}
```

- [ ] **Step 2: Extend the `EpisodeView` transcript prop type.** In `components/episode-view.tsx`, change:
```tsx
  transcript: { fullText: string; segments: Segment[] } | null
```
to:
```tsx
  transcript: { fullText: string; segments: Segment[]; contentHtml?: string | null } | null
```

- [ ] **Step 3: Add the `ArticleBody` component** to `components/episode-view.tsx` (above `EpisodeView`):

```tsx
function ArticleBody({
  contentHtml,
  leadImageUrl,
  sourceUrl,
  insights,
  entities,
  tab,
  onTabChange,
}: {
  contentHtml: string
  leadImageUrl: string | null
  sourceUrl: string | null
  insights: Insights
  entities: MentionedEntity[]
  tab: string
  onTabChange: (v: string) => void
}) {
  return (
    <Tabs value={tab} onValueChange={onTabChange}>
      <div className="sticky top-0 z-10 -mx-4 mb-2 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6">
        <TabsList>
          <TabsTrigger value="article">Article</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="article" className="pb-10 pt-2">
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            View original <ExternalLink className="size-3.5" />
          </a>
        )}
        {leadImageUrl && (
          <img
            src={leadImageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="mb-6 aspect-video w-full rounded-lg object-cover"
          />
        )}
        <div
          data-hl-kind="article"
          className="prose prose-neutral max-w-none dark:prose-invert prose-img:rounded-lg"
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      </TabsContent>
      <TabsContent value="insights" className="pb-10 pt-2">
        <EpisodeInsights insights={insights} entities={entities} onSeek={() => {}} />
      </TabsContent>
    </Tabs>
  )
}
```

Add `ExternalLink` to the existing lucide import on line 6:
```tsx
import { ExternalLink, Play, Sparkles } from "lucide-react"
```

NOTE: the project uses Tailwind v4. If the `prose` classes (`@tailwindcss/typography`) are **not** available (check: grep for `typography` in `package.json` / CSS), drop the `prose*` classes and use a readable fallback: `className="max-w-none space-y-4 text-[15px] leading-7 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_a]:underline [&_img]:rounded-lg [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:italic"` on the body div. Keep `data-hl-kind="article"` either way.

- [ ] **Step 4: Branch to `ArticleBody` in `EpisodeView`'s render.** Add an `isArticle` flag and a render branch. After the `isYouTube` line (`const isYouTube = ...`), add:
```tsx
  const isArticle = episode.type === "article"
```
Change the initial tab so articles lead with the article body:
```tsx
  const [tab, setTab] = useState(isYouTube ? "transcript" : isArticle ? "article" : "insights")
```
In the render chain (the `episode.status === "failed" ? ... : !transcript ? ... : isYouTube ? <YouTubeBody/> : (...podcast Tabs...)`), insert an article branch **before** the YouTube branch:
```tsx
          ) : isArticle && transcript.contentHtml ? (
            <ArticleBody
              contentHtml={transcript.contentHtml}
              leadImageUrl={episode.artworkUrl}
              sourceUrl={episode.sourceUrl}
              insights={insights}
              entities={entities}
              tab={tab}
              onTabChange={setTab}
            />
          ) : isYouTube && episode.videoId ? (
```

(The existing `HighlightLayer` mounted at the end of `EpisodeView` already covers the article body via `data-hl-kind="article"` — no highlight wiring needed.)

- [ ] **Step 5: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors.

- [ ] **Step 6: Commit**

```bash
git add app/episodes/[id]/page.tsx components/episode-view.tsx
git commit -m "feat(article): reading view — prose body, hero, view-original, highlightable"
```

---

## Task 9: Final verification

- [ ] **Step 1:** `npm run typecheck` (clean); `npm test` (all pass — new article/adapter/pipeline/episode-href tests included); `npm run build` (succeeds); `npm run lint` (no new errors vs. the pre-existing 11).
- [ ] **Step 2 (manual):** paste a real article URL into the add-command → "Add this article" → detail page shows "Processing…" then the reading view (hero, prose, inline images, "View original"); the Insights tab shows summary/takeaways/quotes/topics; the Mentioned entities populate; selecting body text shows "Highlight" and it appears on `/highlights` under the Articles filter; the article surfaces in `/search` and `/ask` (clicking a hit opens `/episodes/{id}` with no `?t=`).

---

## Self-Review (plan author)

- **Spec coverage:** ingest/routing + detect ✅ (Tasks 2, 6); extraction + sanitize + images ✅ (Task 1); `content_html` storage + migration + pipeline plumbing ✅ (Tasks 3–5); reading view + View original + highlight region ✅ (Task 8); search no-`?t=` for articles ✅ (Task 7); full-treatment search/ask/insights/entities inherited via `processContent` (Tasks 2, 5); performance — `content_html` only read on the detail page (Task 8 `select().from(transcriptsTable)` already isolated there; list/search queries untouched), sanitize-once-at-write (Task 1), lazy images (Tasks 1, 8), async analysis (existing `fireProcessing`) ✅. Highlights "zero change" claim verified against shipped `buildLocator`/`highlightJumpHref`/`HIGHLIGHT_KINDS` (default case → `{}` / bare href; "Articles" chip already present).
- **Placeholder scan:** none — complete code or exact edits per step. Two "confirm/adjust" notes (embedding width in the pipeline test; `prose` availability) are delegated with a concrete fallback because those facts live in code/config, not the spec.
- **Type consistency:** `Segment {start,end,text}` (from `lib/ai/chunk`) used by `paragraphsToSegments` and the pipeline test; `ExtractedArticle` fields consumed by the adapter; `TranscriptResult.contentHtml?` flows schema → pipeline → page prop → `EpisodeView` transcript type → `ArticleBody`; `episodeHref(itemId, startSec?)` signature consistent across all five call sites; `articleAdapter.detect` predicate matches the inline add-command fallback.
