# Episode→Item Rename (SP2b) — Plan / Map

> Mechanical rename, behavior-preserving. Proof of correctness = green `npm run typecheck`, `npm run build`, `npm test`, lint at the 11-error baseline. No logic changes.

**Scope decision:** rename everything that refers to the **polymorphic library item**. **Keep** genuine podcast-episode domain terms (they really model episodes): `lib/itunes` (`EpisodeResult`, `searchEpisodes`, `mapEpisode`), `lib/rss` (`FeedEpisode`, `ParsedFeed`), `app/api/itunes/episodes/route.ts`, and `add-command.tsx`'s local iTunes/RSS `EpisodeResult`/`FeedEpisode` types.

## Rename map

### File moves (git mv) + their primary symbol
| From | To | Symbol rename |
|---|---|---|
| `components/episode-view.tsx` | `components/item-view.tsx` | `EpisodeView`→`ItemView`, `EpisodeViewProps`→`ItemViewProps` |
| `components/episode-card.tsx` | `components/item-card.tsx` | `EpisodeCard`→`ItemCard`, `LibEpisode`→`LibItem` |
| `components/episode-actions.tsx` | `components/item-actions.tsx` | `EpisodeActions`→`ItemActions` |
| `components/episode-insights.tsx` | `components/item-insights.tsx` | `EpisodeInsights`→`ItemInsights` (keep `InsightsData`/`MentionedEntity`/`insightSections`/`InsightSection`) |
| `lib/episode-href.ts` | `lib/item-href.ts` | `episodeHref`→`itemHref` |
| `lib/ai/episode-context.ts` | `lib/ai/transcript-context.ts` | (exports `buildTranscriptContext`/`MAX_TRANSCRIPT_TOKENS`/`estimateTokens` — no symbol rename, filename only) |
| `lib/export/episode-markdown.ts` | `lib/export/item-markdown.ts` | `buildEpisodeMarkdown`→`buildItemMarkdown`, `ExportEpisode`→`ExportItem` (keep `ExportInsights`/`ExportTranscript`) |
| `app/episodes/[id]/page.tsx` | `app/items/[id]/page.tsx` | (web route move; add redirect — see below) |
| `test/episode-href.test.ts` | `test/item-href.test.ts` | update import + calls |
| `test/ai/episode-context.test.ts` | `test/ai/transcript-context.test.ts` | update import |
| `test/export/episode-markdown.test.ts` | `test/export/item-markdown.test.ts` | update import + symbol |
| `test/db/episode-delete.test.ts` | `test/db/item-delete.test.ts` | (filename only) |

### Symbol renames (no file move)
| From | To | File |
|---|---|---|
| `entitiesForEpisode` | `entitiesForItem` | `lib/db/entities.ts` (+ the `as entitiesForItem` alias in `app/api/items/[id]/route.ts` becomes a direct import) |
| `episodesMentioningEntity` | `itemsMentioningEntity` | `lib/db/entities.ts` |
| `resolveEpisodeEntities` | `resolveItemEntities` | `lib/entities/resolve.ts` (+ caller in `lib/pipeline/process-content.ts`) |
| `episodesMentioning` | `itemsMentioning` | `lib/db/topics.ts` |
| `sharedEpisodes` | `sharedItems` | `lib/db/entities.ts` (internal result field) |
| `segsByEpisode` | `segsByItem` | `lib/db/search.ts` (local var) |
| `AttachableEpisode` | `AttachableItem` | `components/conversation-view.tsx` (+ `ask-view.tsx` import) |
| `RecentEpisode` | `RecentItem` | `components/app-sidebar.tsx` (local) |

### Web route move + redirect
- Move `app/episodes/[id]/page.tsx` → `app/items/[id]/page.tsx` (rename the `EpisodeView` import to `ItemView`).
- Add `app/episodes/[id]/page.tsx` as a redirect stub so old links/bookmarks still work:
```tsx
import { redirect } from "next/navigation"
export default async function LegacyEpisodeRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/items/${id}`)
}
```
- `itemHref(itemId, startSec?)` now returns `/items/${itemId}` (was `/episodes/`). Update its body.
- Update ~23 hardcoded `/episodes/${...}` URL literals → `/items/${...}` across: `add-command.tsx` (recents/lib/ingest/moment goTo), `app-sidebar.tsx` (link + isActive), `global-player.tsx`, `video-player.tsx`, `highlights-feed.tsx`, `search-view.tsx`, `app/entities/[slug]/page.tsx`, `lib/highlights/locator.ts` (both `/episodes/` strings). Update the 6 `episodeHref(...)` call sites → `itemHref(...)`.

### User-facing strings (content is mixed now, so de-"episode")
- `app-sidebar.tsx` "Add episode (⌘K)" → "Add to library (⌘K)".
- `add-command.tsx` "Episode queued for transcription" → "Added to your library"; the `mode: "search" | "episodes"` internal union may stay (it's about browsing a podcast feed's episodes — genuine).
- `episode-insights.tsx`→`item-insights.tsx` "Mentioned in {n} episode(s)" → "Mentioned in {n} item(s)".
- `app/topics/[slug]/page.tsx` "Episodes mentioning…"/"No episodes found." → "Items mentioning…"/"No items found." (and the `episodesMentioning`→`itemsMentioning` call).

## Execution (two passes, each ends green)
**Pass A — lib/db/tests:** `item-href` (+ callers), `transcript-context`, `item-markdown`, `entities`/`topics`/`resolve`/`process-content` function renames, `search.ts` var, and the three lib test renames. Verify `npm run typecheck`.

**Pass B — components/route/strings:** the four component file+symbol renames (+ all importers), `AttachableItem`, `RecentItem`, the `/episodes/[id]`→`/items/[id]` route move + redirect stub, all hardcoded `/episodes/` URLs, `itemHref` call sites, and the user-facing strings. Verify `npm run typecheck` + `npm run build`.

**Final:** `npm test` (all pass), `npm run build`, lint baseline; grep that no `episode-view`/`EpisodeView`/`episodeHref`/`/episodes/` (except the redirect stub + iTunes route) remain; merge.

## Keep (do NOT rename)
`lib/itunes/*` (`EpisodeResult`, `searchEpisodes`, `mapEpisode`), `lib/rss/*` (`FeedEpisode`), `app/api/itunes/episodes/route.ts`, `add-command.tsx` local iTunes/RSS `EpisodeResult`/`FeedEpisode`, and the redirect stub at `app/episodes/[id]/page.tsx`.
