# Highlights in /ask — Design

**Date:** 2026-06-13
**Status:** Approved design, ready for implementation planning

## Summary

Make a user's saved **highlights searchable in `/ask`**: embed each highlight, search
them semantically alongside transcript/article chunks, and surface the matches as
**distinct "Highlight" sources** in the answer. Curated highlights become a
first-class retrieval signal across every ask surface — the conversation `/ask`
(library-wide and attached-to-an-item), and the search-page one-shot answer.

## Decisions (from brainstorming)

- **Retrieval:** *semantic* — give each highlight an embedding and vector-search it
  like chunks (paraphrased queries still match). Not keyword-only, not ride-along.
- **Presentation:** highlights appear as **distinct sources** with a "Highlight"
  badge and the snippet text, alongside podcast/video/article sources.
- **Scope:** *full* — conversation `/ask` (library-wide **and** attached-item) +
  the search-page answer (`/api/answer`).
- **Backfill:** existing highlights are embedded as part of shipping (run against
  the app DB), so the feature works on day one — not lazily.

## Architecture

Retrieval is **additive**: the existing chunk search is unchanged; a parallel
`searchHighlights` runs and its top matches are appended to the unified source list
the answer cites. Highlight sources are flagged so each UI can render them
distinctly. Embeddings reuse the existing `embedTexts`/`embedQuery`
(`text-embedding-3-small`, 1536 dims — matches `chunks.embedding`).

## Components

### 1. Storage & embedding
- Add nullable `embedding vector(1536)` to `highlights` (`lib/db/schema.ts`).
  Migration `0008_highlight_embedding` (hand-authored + journal entry). No vector
  index initially (row count is small; seq scan is fine — revisit with HNSW if it
  grows).
- **Embed on create:** `app/api/highlights/route.ts` `POST` calls
  `embedQuery(text)` and stores the vector with the new row. Embedding failure is
  caught and logged; the highlight still saves (inline marks / `/highlights`
  unaffected — it's just not ask-retrievable until backfilled).
- The repo `create` (`lib/db/highlights.ts`) accepts an optional `embedding` and
  writes it.

### 2. Retrieval — `searchHighlights`
`lib/db/search.ts`: `searchHighlights(db, queryEmbedding, { limit?, minSimilarity?, itemId? })`
→ cosine similarity over `highlights.embedding` (skip NULL embeddings), inner-join
`items`. Returns `HighlightHit`:
```
{ highlightId, itemId, itemTitle, podcastName, artworkUrl, audioUrl, videoId,
  text (snippet), startSec (locator.sec ?? 0), similarity }
```
Defaults: `limit 3`, `minSimilarity ≈ 0.35` (tunable), optional `itemId` filter for
attached-item ask.

### 3. A shared source-assembly helper
`lib/ai/ask-sources.ts` — turns chunk hits + highlight hits into one numbered list,
reusing the existing item+moment grouping for chunks (the `groupHitsIntoSources`
logic) and appending highlight sources after. Exposes the unified `sources` array
(each entry flagged `isHighlight` or not, carrying `snippet` for highlights) and a
`numberFor` mapping so context excerpts line up with citation `[n]`s. Highlight
excerpts are labeled for the model: `[n] (Highlight — {title}) {text}`.

### 4. Ask routes
- **`app/api/chat/route.ts`:**
  - *Library-wide:* run `hybridSearch` (chunks) + `searchHighlights` (no itemId);
    assemble unified sources via the helper.
  - *Attached-item:* alongside the transcript/chunk context, run
    `searchHighlights({ itemId })` and append the item's matching highlights as
    sources (and labeled context excerpts), so a question about one item surfaces
    the highlights you made on it.
- **`app/api/answer/route.ts`** (search page): same — `hybridSearch` +
  `searchHighlights`, unified via the helper.

### 5. Source type + UI
- Extend the source types with `isHighlight?: boolean` and `snippet?: string | null`:
  `ChatSource` (`lib/db/schema.ts`) and the client `ChatSourceRef`
  (`components/chat-message.tsx`); the search-page `Source` type
  (`components/search-view.tsx`).
- **`components/chat-message.tsx`:** highlight sources render as their own card with
  a **"Highlight" badge** + the snippet (serif, quote-like), separate from the
  episode-grouped cards. Click → `openSource` (jumps to the moment when
  `startSec > 0`).
- **`components/search-view.tsx`:** highlight sources render as distinct badged
  rows in the Sources section (excluded from the episode `groupSources` grouping),
  linking via `episodeHref`. Inline `[n]` citations resolve to them as normal.

### 6. Backfill
A runnable script `scripts/backfill-highlight-embeddings.ts` (loads `.env.local`,
connects via `DATABASE_URL`, embeds every highlight with a NULL embedding in
batches, idempotent). Executed against the app DB as the final implementation step
so existing highlights are searchable immediately.

## Data flow

```
ask → embed query
    → hybridSearch(chunks)  +  searchHighlights(highlights[, itemId])
    → assembleAskSources(): unified numbered sources (highlights flagged) + context
    → answer with [n] citations
    → sources list: episode/article cards (grouped) + distinct Highlight cards
```

## Error handling

- Highlight with NULL embedding (pre-backfill / failed embed) → not returned by
  `searchHighlights` (skipped), never errors.
- Embedding failure on create → logged; highlight still saved.
- Below-`minSimilarity` matches dropped; `limit` caps the count so highlights never
  crowd out chunk sources.

## Testing

- **Unit:** `assembleAskSources` numbering (chunk sources first, highlights appended,
  `numberFor` correct, `isHighlight`/`snippet` set); `searchHighlights` row mapping
  (locator.sec → startSec, NULL-embedding skip) via a test-DB query with a seeded
  embedding.
- **Integration (test DB):** `POST /api/highlights` persists an embedding; the repo
  `create` round-trips the vector.
- **Build + manual:** ask a question matching a highlight in both the conversation
  `/ask` and the search page → a "Highlight" source appears and links to the item;
  attached-item ask surfaces that item's highlights.

## Scope

**In scope (v1):** `highlights.embedding` + migration; embed-on-create + repo
support; `searchHighlights`; `assembleAskSources`; integration in `chat` route
(library-wide + attached) and `answer` route; `isHighlight`/`snippet` source fields
+ distinct rendering in `chat-message` and `search-view`; the backfill script, run.

**Deferred:** an HNSW index on `highlights.embedding` (only if volume grows);
embedding the highlight `note` (we embed `text` only for now).

## Modularity note

`assembleAskSources` centralizes the chunk+highlight merge so both ask routes share
one numbering/labeling path; `searchHighlights` mirrors `searchChunks`’ shape, and
the `isHighlight`/`snippet` flags are the only UI seam — a future source type plugs
in the same way.
