# API Consolidation & iOS-Ready Surface (SP2a) — Design

**Date:** 2026-06-13
**Status:** Approved design, ready for implementation planning

**Context:** Sub-project #2a of the hardening sweep (SP1 = DB hygiene, done). This is the behavioral, iOS-facing half: make `/api/items` the single canonical surface, add read-later state, a unified `SourceDTO`, env-gated auth, and clean up SSRF + the `x-sources` hack. The mechanical `episode→item` symbol rename is **SP2b** (separate, after this). The iOS app (separate native repo) will consume this API to: read articles for later, browse podcasts/videos, view highlights, and Ask.

## Decisions

- Unified `SourceDTO` uses a `kind` discriminator (`"item" | "highlight" | "web"`) **and retains** the existing `isHighlight`/`isWeb`/`url` fields — so stored `messages.sources` and the current web client need no migration; iOS gets the clean discriminator.
- Auth is **env-gated**: with `API_AUTH_TOKEN` unset the API is fully open (today's behavior); when set, requests must be same-origin (`Origin`/`Referer` host === `APP_URL`) **or** carry a matching `Authorization: Bearer`.
- Read-later is a single `readState` column (`unread`/`read`/`archived`), default `unread`.

## Components

### 1. Read-later state
- Migration `0012_item_read_state.sql`: `ALTER TABLE "items" ADD COLUMN "read_state" text DEFAULT 'unread' NOT NULL;`
- `schema.ts`: `readState: text("read_state").$type<ItemReadState>().notNull().default("unread")`, with `export type ItemReadState = "unread" | "read" | "archived"`.
- `ItemDTO` gains `readState: ItemReadState`; `itemToDTO` maps it.
- `itemRepo.setReadState(id, state)`.

### 2. Canonical item API
- **`GET /api/items/[id]`** — the full detail bundle for one item (one call for an iOS detail screen):
  `{ item: ItemDTO, transcript: { fullText, segments, contentHtml } | null, insights: <row> | null, entities: MentionedEntity[], highlights: HighlightDTO[] }`. Built from `itemRepo.getById` + the transcript/insights selects + `entitiesForItem` + `highlightRepo.list({ itemId })` (the same data `app/episodes/[id]/page.tsx` assembles today, moved/shared into the route).
- **`DELETE /api/items/[id]`** — `itemRepo.remove(id)`; 404 if the item doesn't exist; else **204 No Content**.
- **`PATCH /api/items/[id]`** — body `{ readState }`; validates against `ItemReadState`; 404 if missing; returns the updated `ItemDTO`.
- `POST /api/items` (exists) handles podcast payloads (`{ type:"podcast", … }` via `podcastInputToNewItem`) and `{ url }` dispatch — unchanged.
- `/api/items/[id]/retry` (exists, adapter-aware, `contentHtml`-correct) — unchanged.
- **`GET /api/library/search`** (currently POST, returns raw rows under `episodes`): keep POST for now but return `{ items: ItemDTO[], moments: SourceDTO[] }` (DTO + renamed key; moments become `SourceDTO` with `kind:"item"`).

### 3. Migrate web clients off `/api/episodes*`, then delete the legacy routes
Repoint every fetch (per the audit inventory) to `/api/items*` and update the response keys:
- `add-command.tsx` — recents GET → `/api/items` (`d.items`); podcast `ingest()` POST → `/api/items` with `{ type:"podcast", … }`, read `{ item }`, navigate by `item.id`; `/api/library/search` keys → `d.items`/`d.moments`.
- `app-sidebar.tsx`, `library.tsx`, `ask-view.tsx` — GET `/api/items`, read `d.items` (fields available on `ItemDTO`: note `source` replaces `podcastName`, `videoId` is top-level).
- `episode-actions.tsx` — retry → `POST /api/items/[id]/retry`; delete → `DELETE /api/items/[id]`.
- `episode-view.tsx` failed-state retry button → `POST /api/items/[id]/retry`.
- `app/episodes/[id]/page.tsx` (server detail page) — keep rendering server-side, but source its data from the shared loader the new GET route uses (so page + API stay in sync). It currently passes raw `podcastName`; align its `EpisodeView` prop to the DTO `source` field (a small prop tweak — `EpisodeView` is renamed in SP2b, not here).
- **Delete** `app/api/episodes/route.ts`, `app/api/episodes/[id]/route.ts`, `app/api/episodes/[id]/retry/route.ts`. (Removes the retry-drops-`content_html` + podcast-only-retry bugs at the source.)

Clients consuming `ItemDTO` must read `source` (not `podcastName`) and top-level `videoId`/`readState`; update those field reads as part of the migration.

### 4. Unified `SourceDTO`
`lib/api/source-dto.ts`:
```ts
export type SourceKind = "item" | "highlight" | "web"
export interface SourceDTO {
  kind: SourceKind
  itemId: string          // "" for web
  itemTitle: string
  startSec: number
  source: string | null   // show/channel/author (was podcastName)
  artworkUrl: string | null
  audioUrl: string | null
  videoId: string | null
  url: string | null      // web only
  snippet: string | null  // highlight/web text
  // retained for back-compat with stored messages.sources + current web client:
  isHighlight?: boolean
  isWeb?: boolean
}
```
A `toSourceDTO()` helper derives `kind` from the existing flags (`isWeb` → `web`, `isHighlight` → `highlight`, else `item`) and maps `podcastName → source`. The chat route (`onFinish` persistence stays flag-based `ChatSource`; the GET-conversation/`/api/answer`/`/api/library/search` responses emit `SourceDTO`). The web client keeps reading flags (still present); iOS reads `kind`.

### 5. Env-gated auth — `middleware.ts`
Root `middleware.ts` with `config.matcher` covering `/api/:path*` **except** `/api/modal/callback`:
```
const token = process.env.API_AUTH_TOKEN
if (!token) return NextResponse.next()             // open (today)
const origin = req.headers.get("origin") ?? req.headers.get("referer") ?? ""
const sameOrigin = origin.startsWith(process.env.APP_URL ?? "")
const bearer = req.headers.get("authorization") === `Bearer ${token}`
if (sameOrigin || bearer) return NextResponse.next()
return new NextResponse("Unauthorized", { status: 401 })
```
(Same-origin keeps the web UI working; the bearer is the iOS credential. Origin is spoofable but, combined with the token requirement for external callers, is an acceptable personal-app gate. `/api/modal/callback` keeps its own HMAC secret and must stay matcher-excluded.)

### 6. SSRF + transport cleanup
- Call `assertFetchableUrl(feedUrl)` in `/api/itunes/episodes` before `fetchAndParseFeed` (guards the RSS fetch, matching the article extractor).
- **Drop the `x-sources` header.** Library sources are already persisted in the chat `onFinish` and the client re-syncs the message after the stream (`syncAfterStream`). Remove the header set (chat route) and read (`use-conversation`); show library sources from the synced/persisted message (web sources already arrive via the stream's `source-*` parts during streaming, unchanged). iOS reads sources from `GET /api/conversations/[id]`.

## Data flow / iOS view

iOS: `GET /api/items` (queue, filter by `type`/`readState`) → `GET /api/items/[id]` (full detail incl. article `contentHtml`, insights, highlights) → `PATCH` to mark read/archived → highlights via `/api/highlights` → Ask via `POST /api/answer` (one-shot, returns `SourceDTO[]`). All authenticated with the bearer token.

## Error handling
- `GET/DELETE/PATCH /api/items/[id]`: 404 when the item is absent; PATCH 400 on an invalid `readState`.
- Auth middleware: 401 with no body for unauthorized; never blocks the Modal callback.
- Deleting the legacy routes: confirm no remaining client references before removal (grep clean).

## Testing
- **Unit:** `toSourceDTO` (flag→kind mapping, `podcastName→source`); `itemToDTO` includes `readState`.
- **Integration (route, mocked repo):** `GET /api/items/[id]` shape; `DELETE` 404 vs 204; `PATCH` validates `readState`; auth middleware (open when unset; 401 vs same-origin vs bearer when set).
- **Build + manual:** the web app still works end-to-end after the client migration (library, add, detail, retry, delete, ask); a `curl` with/without bearer when `API_AUTH_TOKEN` is set.
- Full suite + build + lint at the 11-error baseline.

## Scope
**In (SP2a):** read-later column + DTO + PATCH; `GET`/`DELETE` `/api/items/[id]`; `/api/library/search` DTO; client migration off `/api/episodes*`; delete legacy episodes routes; `SourceDTO` + emit from answer/conversation/library-search; env-gated auth middleware; SSRF-on-feed; drop `x-sources`.
**Out:** the `episode→item` symbol/file/URL rename (SP2b); the `podcastName` column rename (stays; exposed as `source`); user accounts; offline sync.
