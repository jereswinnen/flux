# Highlights — Design

**Date:** 2026-06-12
**Status:** Approved design, ready for implementation planning

## Summary

Let the user **highlight passages** across their library — free text selection in
podcast/video transcripts and in insights (key takeaways, notable quotes) — with
an optional note, and assemble everything on a single **`/highlights`** page. The
model is deliberately source-agnostic so future sources (web articles, Kindle
highlights) plug in with **no schema change**, mirroring the existing
`SourceAdapter` pattern.

## Decisions (from brainstorming)

- **Highlightable:** free text selection (any span in transcript / takeaways /
  quotes), not whole-item toggles — generalizes to article & Kindle prose.
- **Notes:** each highlight may carry an optional note/annotation.
- **Kindle (future):** imported **as highlights** directly (a Kindle import writes
  `kind: "kindle"` highlight rows), not as content you then highlight.
- **Page:** a flat reverse-chronological feed, filterable by source type and
  searchable.

## Core model decision

Chosen approach: **text snapshot + `kind` discriminator + JSONB `locator`**
(rejected: per-source anchor tables — not modular; char-offset anchors — fragile
on re-transcription). The snapshot keeps a highlight displayable even if the
source changes; `kind` + `locator` is the extension seam.

## Data model

```
highlights
  id          uuid PK
  itemId      uuid FK → items (ON DELETE cascade)   -- source item (always set)
  kind        text        -- transcript | takeaway | quote | article | kindle | …
  text        text        -- the highlighted passage (snapshot; always displayable)
  note        text NULL   -- optional annotation
  locator     jsonb       -- per-kind anchor for "jump back":
                          --   transcript → { sec: number, segmentStart?: number }
                          --   quote      → { index: number, sec?: number }
                          --   takeaway   → { index: number }
                          --   article    → { charStart: number, charEnd: number }  (future)
                          --   kindle     → { location: string }                    (future)
  createdAt   timestamp with time zone DEFAULT now() NOT NULL
```

Indexes: `(item_id)`, `(created_at desc)`. New Drizzle table in `lib/db/schema.ts`
+ a hand-authored incremental migration (consistent with the project's migration
approach — `ALTER`/`CREATE TABLE`, registered in `meta/_journal.json`).

A highlight always belongs to an `item` and cascade-deletes with it.

## API + DTO

DTO layer in `lib/api/highlight-dto.ts` (mirrors `lib/api/dto.ts`):

```ts
interface HighlightDTO {
  id: string
  kind: string
  text: string
  note: string | null
  createdAt: string                 // ISO 8601
  item: {
    id: string
    type: ItemType
    title: string
    source: string | null           // podcastName / channel / author
    artworkUrl: string | null
  }
  jumpHref: string                  // where clicking it navigates
}
```

Endpoints (Next.js route handlers under `app/api/highlights/`):

- `POST /api/highlights` — body `{ itemId, kind, text, note?, locator }`. Validates
  `itemId` exists, `text` non-empty (trimmed). Returns the created row.
- `GET /api/highlights?type=&q=` — flat list, newest-first, inner-joined to `items`
  for card context. Optional `type` filter (`podcast|youtube|article|kindle`) and
  `q` case-insensitive substring over `text` + `note`. Returns `HighlightDTO[]`.
- `PATCH /api/highlights/[id]` — body `{ note }` (edit/clear the note).
- `DELETE /api/highlights/[id]`.

Repo: `lib/db/highlights.ts` (`makeHighlightRepo(db)` → `create`, `list({type?,q?})`,
`updateNote`, `remove`) + a `highlightRepo` singleton, following `lib/db/items.ts`.

**`highlightJumpHref(kind, itemId, locator)`** (the read-side per-kind seam): for
`transcript`/`quote` with a numeric `sec` → `/episodes/{itemId}?t={sec}` (the
existing deep-link cues the audio bar or the video mini); otherwise →
`/episodes/{itemId}`. New kinds add a case here.

## Creation UX (free text selection)

One reusable layer; each surface only stamps data attributes.

- **`Highlightable`** (`components/highlightable.tsx`) — wraps a region and stamps
  `data-hl-item={itemId}`, `data-hl-kind`, and locator bits: `data-hl-sec` on
  transcript lines, `data-hl-index` on a takeaway/quote.
- **`useHighlightSelection`** + **`HighlightPopover`** — a hook (mounted once on the
  detail view) listens for a text selection landing inside a `[data-hl-item]`
  region; on `mouseup` it positions a floating **"Highlight"** button at the
  selection. Clicking reads `selection.toString()` and the nearest `[data-hl-*]`
  ancestor, builds the payload via `buildLocator`, and `POST`s it (optimistic
  toast). An optional note can be added from the popover or later on the page.
- **`buildLocator(kind, el, selectionText)`** (the write-side per-kind seam):
  transcript → `{ sec: Number(el.dataset.hlSec) }`; quote → `{ index, sec }`;
  takeaway → `{ index }`. New surfaces (article, Kindle) render `Highlightable`
  with their attributes; the hook/popover/locator switch are untouched.

Surfaces wired in v1: transcript lines (`LiveTranscript`), takeaways and quotes
(`EpisodeInsights`).

## Highlights page

- Route `app/highlights/page.tsx` (server component → `highlightRepo.list` via the
  DTO mapper) + a sidebar nav entry (`components/app-sidebar.tsx`).
- **Flat reverse-chronological feed.** Each card: the highlighted **text** (serif,
  prominent), the optional **note** beneath, and a compact **source row**
  (artwork thumbnail + item title + source-type icon + relative date). Clicking the
  card navigates to `jumpHref`.
- **Filter chips** by source type (All / Podcasts / Videos / Articles / Kindle) +
  a **search box**; both drive `?type=&q=` (server-side) so it scales.
- Per-card hover actions: **edit note**, **delete** (existing confirm pattern).

## Scope

**In scope (v1):** `highlights` table + migration; create/list/patch/delete API +
DTO + `highlightJumpHref`; `Highlightable` + `useHighlightSelection` +
`HighlightPopover` + `buildLocator` wired into transcript, takeaways, quotes; the
`/highlights` page + sidebar entry.

**Deferred (additive, no schema change):**
- Inline re-marking of saved highlights in the source (re-anchoring a free-text
  span into the live, word-highlighting transcript is finicky — its own pass).
- Article source: a `kind: "article"` surface + `buildLocator`/`jumpHref` cases.
- Kindle source: an importer that writes `kind: "kindle"` rows + a `jumpHref` case.

## Modularity recap

The seam is `kind` + `locator`. Write-side (`buildLocator`), read-side
(`highlightJumpHref`), the API, and the page are all source-agnostic. A new source
touches only those small switch points + stamps `Highlightable` attributes (or, for
Kindle, writes highlight rows on import) — the same shape as the `SourceAdapter`
pattern used for ingestion.

## Error handling

- Create: 400 on missing `itemId`/empty `text`; 404 if the item doesn't exist.
- Selection popover: a failed `POST` shows an error toast; the optimistic entry is
  rolled back.
- `DELETE`/`PATCH`: 404 if the highlight is gone.
- A highlight whose `locator` lacks a usable anchor falls back to
  `/episodes/{itemId}` (no `?t=`).

## Testing

- **Unit:** `buildLocator` (selection context → locator per kind), `highlightJumpHref`
  (kind+locator → URL), the DTO mapper (row → `HighlightDTO`, ISO date, jumpHref).
- **Integration (test DB):** `highlightRepo` + `POST`/`GET` (create, newest-first,
  `type` filter, `q` search) and `DELETE`.
- **Build + manual:** the selection popover and the `/highlights` page (consistent
  with how UI has been verified in this project).
