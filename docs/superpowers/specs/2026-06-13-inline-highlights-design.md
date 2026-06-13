# Inline Highlights (re-marking + remove) — Design

**Date:** 2026-06-13
**Status:** Approved design, ready for implementation planning

## Summary

Visually re-draw a user's saved highlights inside the content they came from — the
**article body** and the **insights** (key takeaways, notable quotes) — and let the
user **click a highlight to remove it** via a small popover. This completes the
"inline re-marking" follow-up deferred from the original Highlights spec.

## Decisions (from brainstorming)

- **Click action:** clicking an inline highlight opens a small **popover** anchored
  to it, showing the note (if any) + a **Remove highlight** button. (Note-editing is
  a later add; the popover is its home.)
- **Unfindable highlights:** if a saved snapshot can't be located in the live
  content (text changed, or the selection crossed a tag boundary), **silently skip**
  the inline mark. The highlight still exists and shows on `/highlights`.
- **Scope (v1 surfaces):** **article body** + **insights** (takeaways, quotes) for
  podcast / video / article items. The **live transcript is deferred** — it already
  runs a word-level karaoke-highlight span system, and overlaying a second span
  system there is its own pass. Transcript highlights still save and appear on
  `/highlights`; they just aren't re-drawn inline yet.

## Core approach — two marking mechanisms

Highlights store a *text snapshot* + `kind`/`locator`. Re-drawing means finding that
snapshot in the rendered content. The mechanism differs by who owns the DOM:

- **Insights (React-controlled):** declarative string-splitting. A pure helper
  `markText(text, marks)` splits a takeaway/quote string at the snapshot's match
  offsets and returns React nodes with `<mark>` around matches. No DOM mutation.
- **Article body (uncontrolled `dangerouslySetInnerHTML`):** a component
  (`HighlightedHtml`) sets the sanitized HTML, then walks the container's text nodes
  after render and wraps single-text-node matches in `<mark>`. Safe because React
  doesn't manage that subtree.

*(Rejected: DOM-walking the React-rendered insights — fights the reconciler.
Rejected: server-side mark injection — couples storage to one render and can't
update live on create/remove.)*

## Anchoring per kind (narrow, then match)

- `takeaway` → locator `index` selects the takeaway; match the snapshot within that
  string.
- `quote` → locator `index` selects the quote; match within it.
- `article` → no positional anchor; match the snapshot in the prose. First
  single-text-node occurrence wins; cross-tag / not-found → skipped.

The matcher is exact-substring (trimmed). On multiple matches in one string, the
first wins; overlapping highlights → first wins, later ones skipped inline (still on
`/highlights`).

## Components & data flow

- **`highlightRepo.list` gains an `itemId` filter** (`lib/db/highlights.ts`): add
  `itemId?: string` to the opts; when set, `filters.push(eq(highlights.itemId, itemId))`.
  `GET /api/highlights?itemId=` passes it through (additive; existing `type`/`q`
  untouched).
- **`app/episodes/[id]/page.tsx`** (server component) fetches the item's highlights
  via `highlightRepo.list({ itemId })` and passes them to `EpisodeView` as a typed
  `highlights` prop (`{ id, kind, text, note, locator }[]`).
- **`components/highlights-context.tsx`** — a client `HighlightsProvider` scoped to
  the detail view, seeded with the fetched highlights. Exposes `highlights`,
  `add(h)`, and `remove(id)` (optimistic; `remove` also fires
  `DELETE /api/highlights/[id]`, rolling back + error toast on failure). Both marking
  mechanisms and the create flow read/write this context, so create/remove stay in
  sync without a full refetch.
- **`components/highlight-marks.tsx`** —
  - `markText(text, marks, onClick)` — the insights splitter (pure; returns nodes).
  - `HighlightedHtml({ html, marks, onMarkClick })` — the article prose walker.
  - `HighlightMark` — the shared `<mark>` element (themed style + click handler) and
    the `HighlightPopover` (note + Remove), anchored to the clicked mark.
- **Wiring:**
  - `components/episode-insights.tsx` — takeaways/quotes render through `markText`
    using the context's highlights filtered to that kind+index. Keeps the existing
    `data-hl-*` attributes for *creating* new highlights.
  - `components/episode-view.tsx` — mount `HighlightsProvider`; the article body
    renders via `HighlightedHtml` (replacing the raw `dangerouslySetInnerHTML`),
    keeping the `data-hl-kind="article"` wrapper.
  - `components/highlight-layer.tsx` — on a successful save `POST`, call the
    context's `add(row)` so the new highlight marks instantly.

## Visual style

A subtle themed highlighter: translucent accent background (`bg-primary/15`,
slightly stronger on hover), small rounding, `cursor: pointer`. A removed mark
disappears; the surrounding text reflows normally.

## Error handling

- Unfindable snapshot → skip the inline mark (no broken/misplaced mark).
- Failed `DELETE` → keep the mark, show an error toast, roll back the optimistic
  removal.
- Overlapping highlights on the same span → first wins inline; later ones still on
  `/highlights`.

## Testing

- **Unit:** `markText` — single match, multiple snapshots in one string, no match,
  overlapping (first wins), match offset correctness; per-kind anchor selection
  (filter highlights to takeaway/quote index, article body).
- **Integration (test DB):** `highlightRepo.list({ itemId })` returns only that
  item's highlights, newest-first.
- **Build + manual:** the `HighlightedHtml` text-node walker on a real article,
  popover open/remove, instant marking on create, and that removing reflows cleanly.

## Scope

**In scope (v1):** `itemId` filter on repo + route; `HighlightsProvider`;
`markText` + `HighlightedHtml` + `HighlightMark`/popover; wiring into insights
(takeaways, quotes), the article body, and the create flow; remove via popover.

**Deferred (additive):** inline marks in the live transcript (word-highlight overlay
is its own pass); note editing from the popover; multi-text-node / cross-tag
re-anchoring; highlight-overlap rendering.

## Modularity note

The marking layer reads the same `kind`/`locator`/`text` model the create side
already produces, so a future source/surface re-uses `markText` (React-rendered) or
`HighlightedHtml` (raw HTML) and the same popover — no new concepts.
