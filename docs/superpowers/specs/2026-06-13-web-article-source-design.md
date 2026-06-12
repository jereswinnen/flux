# Web Article Source — Design

**Date:** 2026-06-13
**Status:** Approved design, ready for implementation planning

## Summary

Let the user save a **web article** by pasting its URL. The server extracts the
article's content and images, then runs it through the **same analysis pipeline**
podcasts and videos use — so an article becomes a first-class library entry:
semantically searchable, available in `/ask`, with AI insights (summary,
takeaways, quotes, topics, entities) and free-text **highlights**. The reading
view renders a clean, Reader-View-style page. The work plugs into the existing
`SourceAdapter` pattern with **no changes to the analysis pipeline's core**.

## Decisions (from brainstorming)

- **Scope:** *full treatment* — chunk + embed for search/ask, generate insights,
  highlightable. Articles are first-class, not a lighter read-it-later store.
- **Extraction:** *self-hosted* — server-side `fetch` + Mozilla Readability. No
  third party, no new infra. JS-only SPAs / hard paywalls may fail (marked
  `failed` with a clear message); a headless-browser fallback is explicitly out
  of scope.
- **Images:** *hotlink originals* — store source image URLs and load them from
  the origin. Lead image becomes the item artwork; inline images render in the
  body. Accepted tradeoff: a source removing/blocking an image can break it later.
- **Reading view:** *rich, sanitized formatting* — preserve headings, emphasis,
  links, lists, blockquotes, inline images. Free-text highlight anywhere in the
  body (snapshot saved; clicking opens the article — articles have no timestamps).

## Architecture

Reuse the `SourceAdapter` interface (`lib/sources/types.ts`) and the existing
`processContent` pipeline (`lib/pipeline/process-content.ts`). `processContent`
already does: store transcript → insights → chunk + embed → entity resolution →
status `ready`, and is decoupled from Modal. An article adapter extracts the page,
backfills metadata, and calls `processContent` directly. Article-specific code is
confined to: URL detection, extraction, rich-HTML storage + display.

*(Rejected: a separate article analysis path — would duplicate
chunk/embed/insights/entities for no benefit.)*

## Components

### 1. Ingest & routing
- **`articleAdapter`** (`lib/sources/article.ts`), `type: "article"`.
  - `detect(input)`: `true` when `input` is an `http(s)` URL **and** not a YouTube
    URL, not a feed URL (`looksLikeFeedUrl`), and not a direct audio file
    (extension `.mp3/.m4a/.aac/.ogg/.wav/.flac`). Registered **last** in
    `URL_ADAPTERS` so YouTube wins first; audio/feed are disambiguated in the
    add-command UI.
  - `resolve(url)`: cheap, no network — returns
    `{ type: "article", title: url, sourceUrl: url, sourceMetadata: {} }`
    (title is a placeholder, backfilled after extraction).
  - `startProcessing(item)`: see §3.
- **Add-command** (`components/add-command.tsx`): a plain web URL now offers
  **"Add this article"** → `ingestItem({ url })`. The existing "Add this audio
  URL" path is kept only for URLs with an audio file extension. YouTube and feed
  branches unchanged.
- Registered in `BY_TYPE` and `URL_ADAPTERS` in `lib/sources/registry.ts`.

### 2. Extraction (`lib/article/extract.ts`)
- Pure-ish module: `extractArticle(url): Promise<ExtractedArticle>`.
- `fetch(url)` with a desktop browser `User-Agent` and a **timeout** (e.g. 15s via
  `AbortSignal.timeout`). Non-2xx or non-HTML content-type → throw.
- Parse with **linkedom** (lightweight DOM, serverless-friendly), run
  **@mozilla/readability** → `{ title, byline, siteName, excerpt, lang,
  content (HTML), textContent (plain) }`; lead image from `og:image` (fallback:
  first body `<img>`).
- **Sanitize** `content` with **sanitize-html**: allow `h1–h4, p, ul/ol/li,
  blockquote, pre, code, a[href], img[src|alt], strong/em/b/i, figure,
  figcaption, hr, br`; drop `script/style/iframe`, all event handlers, and
  non-`http(s)` URLs. Add `rel="noopener noreferrer"` + `target="_blank"` to
  links; `loading="lazy"` to images.
- Returns `ExtractedArticle = { title, byline?, siteName?, leadImageUrl?,
  excerpt?, contentHtml, textContent, publishedAt? }`.
- Empty/too-short `textContent` (Readability found nothing) → throw a clear error.

### 3. `startProcessing(item)` (in the adapter)
1. `extractArticle(item.sourceUrl)`.
2. `itemRepo.updateMeta(item.id, { title, podcastName: byline ?? siteName,
   artworkUrl: leadImageUrl, publishedAt })`.
3. Build **paragraph segments** from `textContent` — split on blank lines into
   blocks; each block → one segment matching the existing `Segment` shape (from
   `lib/ai/chunk`) with its timestamp fields set to `0` (articles have no
   timestamps). A small helper `paragraphsToSegments(text)`.
4. `processContent({ itemId: item.id, transcript: textContent, segments,
   contentHtml }, { db })`.

`fireProcessing` (in `app/api/items/route.ts`) already runs `startProcessing`
fire-and-forget and records `failed` on throw — **no change needed there**.

### 4. Storage
- Add a **nullable `content_html text`** column to the **`transcripts`** table
  (the per-item content record). No new table.
- `schema.ts`: add `contentHtml: text("content_html")` to `transcripts`.
- `lib/pipeline/process-content.ts`: `TranscriptResult` gains optional
  `contentHtml?: string`; the transcript `insert` persists it. Existing callers
  (Modal callback) omit it → stays `null`, behavior unchanged.
- Migration **`0007_article_content`** — hand-authored
  (`ALTER TABLE "transcripts" ADD COLUMN "content_html" text;`) + `_journal.json`
  entry, consistent with the project's migration convention.

### 5. Reading view (`components/episode-view.tsx`, article branch)
- Branch on `item.type === "article"`: **no audio/video player**.
- Render: hero image (if any), title, byline + site name, published date, a
  **"View original ↗"** link to `sourceUrl`, then the sanitized `content_html`
  in a `prose` container.
- The article body is wrapped in a single `data-hl-kind="article"` region.
- The shared **insights** panel (summary/takeaways/quotes/topics) and the
  **Mentioned** entities section render unchanged — they read `processContent`
  output, which articles produce normally.
- The detail server component (`app/episodes/[id]/page.tsx`) fetches
  `content_html` for the item (article-only); see Performance for projection
  rules.

### 6. Highlights — **zero changes to the highlight stack**
- `buildLocator` already returns `{}` for `article` (default case);
  `highlightJumpHref` already returns the bare `/episodes/{id}` for `article`.
  `HIGHLIGHT_KINDS` already includes `"article"`; `/highlights` already has an
  "Articles" filter chip. Wrapping the body in `data-hl-kind="article"` is the
  only wiring required, and it lives in the reading view (§5).

### 7. Search / Ask
- Article chunks embed and surface in search + `/ask` automatically via
  `processContent`. Article hits carry `startSec 0` (no real timestamp).
- The search-result and "top moments" jump links omit `?t=` when the item
  `type === "article"`, so clicking opens `/episodes/{id}` cleanly. (Adjust the
  one or two places that build `/episodes/{id}?t={sec}` from a search hit.)

## Data flow

```
paste URL
  → POST /api/items { url }
  → detectAdapter → articleAdapter.resolve (placeholder item, status=processing)
  → item saved → 201 returned immediately
  → fireProcessing → articleAdapter.startProcessing
       → extractArticle (fetch + Readability + sanitize)
       → itemRepo.updateMeta (title, byline, lead image, date)
       → processContent (store transcript+contentHtml → insights → chunk+embed
         → entities → status=ready)
  → reading view + search + /ask + highlights all live
```

## Performance ("fast to load / store / ask")

- **Store:** extraction is a single timed `fetch` + parse; sanitization runs
  **once at write time** so reads never re-process HTML. All analysis is async
  (fire-and-forget) — the `POST /api/items` response returns as soon as the
  placeholder row is created.
- **Load:** `content_html` can be large, so it is **excluded from every list and
  search projection** — only the detail page selects it (a single indexed lookup
  by `item_id`). The reading view is server-rendered; the stored HTML is already
  sanitized, so the client does no parsing. Inline images use
  `loading="lazy"` + `decoding="async"`.
- **Ask / search:** identical cost to podcasts/videos — same chunk size
  (`targetTokens: 600`) and pgvector index. No article-specific query path.
- **No N+1:** the detail page fetches item + transcript(`content_html`) +
  insights with the existing per-item reads; nothing added to library/feed
  queries.

## Error handling

- Unreachable / non-HTML / non-2xx / blocked / JS-only (empty body) →
  `extractArticle` throws → item marked `failed` with the message (same UX as a
  failed podcast/YouTube job; the detail page shows the error + a retry path that
  already exists).
- Sanitization is mandatory before storage (XSS): stored HTML never contains
  scripts, event handlers, or non-`http(s)` URLs.
- Hotlinked images that later 404 degrade gracefully (broken `<img>`); accepted.

## Testing

- **Unit:**
  - `extractArticle` against a saved HTML fixture → asserts title/byline/lead
    image/`textContent`/sanitized `contentHtml`.
  - sanitizer drops `<script>`/event handlers/`javascript:` URLs.
  - `articleAdapter.detect` — article URL `true`; YouTube / feed / `.mp3` /
    non-URL → `false`.
  - `paragraphsToSegments` — blank-line splitting, zero timestamps.
- **Integration (test DB):** `processContent` with a `contentHtml` persists it on
  the `transcripts` row and still produces chunks/insights.
- **Build + manual:** paste a real article → reading view renders (hero, prose,
  images, "View original") → insights + Mentioned populate → highlight a passage
  (appears on `/highlights`) → article appears in search/`/ask`.

## New dependencies

`@mozilla/readability`, `linkedom`, `sanitize-html` (+ `@types/sanitize-html`).
All lightweight, pure-Node, no infrastructure.

## Scope

**In scope (v1):** `articleAdapter` + detection + add-command entry; `extractArticle`
+ sanitization; `content_html` column + migration + `processContent` plumbing;
article reading view + "View original" + body highlight region; search-jump
no-timestamp handling for articles; the tests above.

**Out of scope (deferred, additive):** headless-browser fallback for JS-only
sites; image re-hosting; per-paragraph highlight anchoring/scroll-to; manual
paste-the-text (URL-only for v1); readability tuning per-domain.

## Modularity recap

A new source type still touches only: a `SourceAdapter`, registry registration,
and (if it has a distinct display) a detail-view branch. Articles add an
extraction module and one nullable content column, and inherit search, ask,
insights, entities, and highlights for free — the same seam the podcast and
YouTube sources use.
