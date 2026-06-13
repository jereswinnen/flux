# API Consolidation & iOS-Ready Surface (SP2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/api/items` the single canonical API, add read-later state, a unified (additive) `SourceDTO`, env-gated auth, and clean up SSRF + the `x-sources` hack — a clean, typed, authenticated surface for the iOS app.

**Architecture:** New `/api/items/[id]` GET/DELETE/PATCH; `/api/library/search` returns DTOs; web clients move off `/api/episodes*`, which are then deleted; `SourceDTO` adds a `kind` discriminator at iOS-facing serialization points (additive, no web churn); `middleware.ts` env-gates auth; SSRF guard on feed fetch; `x-sources` header removed.

**Tech Stack:** Next.js 16 (route handlers + middleware), Drizzle/Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-api-consolidation-design.md`

**Note:** the `episode→item` symbol/file/URL rename is SP2b (separate). Here, `EpisodeView` and the `/episodes/[id]` page stay as-is; we only touch the API + client fetches.

## File Structure
- **Create:** `lib/db/migrations/0012_item_read_state.sql`, `app/api/items/[id]/route.ts`, `lib/api/source-dto.ts` (+ `test/api/source-dto.test.ts`), `middleware.ts`, `test/api/items-id-route.test.ts`.
- **Modify:** `lib/db/migrations/meta/_journal.json`, `lib/db/schema.ts`, `lib/api/dto.ts`, `lib/db/items.ts`, `app/api/library/search/route.ts`, `app/api/answer/route.ts`, `app/api/conversations/[id]/route.ts`, `app/api/itunes/episodes/route.ts`, `app/api/chat/route.ts`, `components/use-conversation.ts`, `components/add-command.tsx`, `components/app-sidebar.tsx`, `components/library.tsx`, `components/ask-view.tsx`, `components/episode-actions.tsx`, `components/episode-view.tsx`.
- **Delete:** `app/api/episodes/route.ts`, `app/api/episodes/[id]/route.ts`, `app/api/episodes/[id]/retry/route.ts`.

---

## Task 1: Read-later state

**Files:** `lib/db/migrations/0012_item_read_state.sql` (create), `meta/_journal.json`, `lib/db/schema.ts`, `lib/api/dto.ts`, `lib/db/items.ts`; Test `test/api/dto.test.ts` (or wherever `itemToDTO` is tested).

- [ ] **Step 1: Migration `0012_item_read_state.sql`**
```sql
ALTER TABLE "items" ADD COLUMN "read_state" text DEFAULT 'unread' NOT NULL;
```
- [ ] **Step 2: Journal entry** idx 12, `when: 1781900000000`, tag `0012_item_read_state`, breakpoints true.
- [ ] **Step 3: `schema.ts`** — add the type + column:
```ts
export type ItemReadState = "unread" | "read" | "archived"
```
In the `items` table, after `errorMessage`:
```ts
    readState: text("read_state").$type<ItemReadState>().notNull().default("unread"),
```
- [ ] **Step 4: `lib/api/dto.ts`** — add to `ItemDTO`: `readState: ItemReadState` (import the type), and in `itemToDTO` map `readState: row.readState`.
- [ ] **Step 5: `lib/db/items.ts`** — add to the repo:
```ts
    async setReadState(id: string, readState: ItemReadState) {
      await db.update(items).set({ readState }).where(eq(items.id, id))
    },
```
(import `ItemReadState` from `./schema`.)
- [ ] **Step 6: Test** — add a case to the `itemToDTO` test asserting `readState` passes through (default `"unread"`). Apply migration: `npm run db:migrate`. Run the test. `npm run typecheck` clean.
- [ ] **Step 7: Commit** `feat(db): item readState (read-later) column + DTO + repo`

---

## Task 2: `GET` / `DELETE` / `PATCH /api/items/[id]`

**Files:** Create `app/api/items/[id]/route.ts`, `test/api/items-id-route.test.ts`.

- [ ] **Step 1: Write `test/api/items-id-route.test.ts`** (mock the repos; validation/shape focus)
```ts
import { afterEach, expect, test, vi } from "vitest"

const item = { id: "i1", type: "podcast", title: "Ep", podcastName: "Show", audioUrl: "a", sourceUrl: null, artworkUrl: null, durationSec: null, publishedAt: null, status: "ready", readState: "unread", sourceMetadata: null }
vi.mock("@/lib/db/items", () => ({
  itemRepo: {
    getById: vi.fn(async (id: string) => (id === "i1" ? item : null)),
    remove: vi.fn(async () => {}),
    setReadState: vi.fn(async () => {}),
  },
}))
vi.mock("@/lib/db/highlights", () => ({ highlightRepo: { list: vi.fn(async () => []) } }))
vi.mock("@/lib/db/entities", () => ({ entitiesForItem: vi.fn(async () => []) }))
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) } }))

afterEach(() => vi.clearAllMocks())

test("GET returns the item bundle", async () => {
  const { GET } = await import("@/app/api/items/[id]/route")
  const res = await GET(new Request("http://t/api/items/i1"), { params: Promise.resolve({ id: "i1" }) })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.item).toMatchObject({ id: "i1", source: "Show", readState: "unread" })
})
test("GET 404 for missing", async () => {
  const { GET } = await import("@/app/api/items/[id]/route")
  const res = await GET(new Request("http://t/api/items/x"), { params: Promise.resolve({ id: "x" }) })
  expect(res.status).toBe(404)
})
test("DELETE 204 for existing, 404 for missing", async () => {
  const { DELETE } = await import("@/app/api/items/[id]/route")
  expect((await DELETE(new Request("http://t"), { params: Promise.resolve({ id: "i1" }) })).status).toBe(204)
  expect((await DELETE(new Request("http://t"), { params: Promise.resolve({ id: "x" }) })).status).toBe(404)
})
test("PATCH rejects an invalid readState", async () => {
  const { PATCH } = await import("@/app/api/items/[id]/route")
  const res = await PATCH(new Request("http://t", { method: "PATCH", body: JSON.stringify({ readState: "bogus" }) }), { params: Promise.resolve({ id: "i1" }) })
  expect(res.status).toBe(400)
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `app/api/items/[id]/route.ts`**
```ts
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { itemRepo } from "@/lib/db/items"
import { highlightRepo } from "@/lib/db/highlights"
import { entitiesForItem } from "@/lib/db/entities"
import { insights as insightsTable, transcripts as transcriptsTable } from "@/lib/db/schema"
import { itemToDTO } from "@/lib/api/dto"
import { highlightToDTO } from "@/lib/api/highlight-dto"

const READ_STATES = ["unread", "read", "archived"] as const

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await itemRepo.getById(id)
  if (!item) return Response.json({ error: "not found" }, { status: 404 })
  const [transcript] = await db.select().from(transcriptsTable).where(eq(transcriptsTable.itemId, id)).limit(1)
  const [insight] = await db.select().from(insightsTable).where(eq(insightsTable.itemId, id)).limit(1)
  const [entities, highlights] = await Promise.all([
    entitiesForItem(db, id),
    highlightRepo.list({ itemId: id }),
  ])
  return Response.json({
    item: itemToDTO(item),
    transcript: transcript ? { fullText: transcript.fullText, segments: transcript.segments ?? [], contentHtml: transcript.contentHtml ?? null } : null,
    insights: insight ?? null,
    entities,
    highlights: highlights.map(highlightToDTO),
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await itemRepo.getById(id)
  if (!item) return Response.json({ error: "not found" }, { status: 404 })
  await itemRepo.remove(id)
  return new Response(null, { status: 204 })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const readState = body?.readState
  if (!READ_STATES.includes(readState)) {
    return Response.json({ error: "invalid readState" }, { status: 400 })
  }
  const item = await itemRepo.getById(id)
  if (!item) return Response.json({ error: "not found" }, { status: 404 })
  await itemRepo.setReadState(id, readState)
  return Response.json({ item: itemToDTO({ ...item, readState }) })
}
```
NOTE: this references `entitiesForItem` — that function is currently named `entitiesForEpisode` (`lib/db/entities.ts:25`). It will be renamed in SP2b. For SP2a, **import it under its current name** `entitiesForEpisode` and alias: `import { entitiesForEpisode as entitiesForItem } from "@/lib/db/entities"` — so this route doesn't depend on the SP2b rename. (Adjust the test's mock key to `entitiesForEpisode` accordingly.)

- [ ] **Step 4: Run — expect PASS;** `npm run typecheck` clean. Commit `feat(api): GET/DELETE/PATCH /api/items/[id]`.

---

## Task 3: `/api/library/search` → DTO

**Files:** Modify `app/api/library/search/route.ts`.

- [ ] **Step 1:** Return DTO items under an `items` key (keep `moments` as the raw hits the ⌘K palette consumes). Add `import { itemToDTO } from "@/lib/api/dto"`. Replace the response:
```ts
  if (query.length < 2) return Response.json({ items: [], moments: [] })
  // …existing parallel fetch…
  return Response.json({ items: episodes.map(itemToDTO), moments })
```
(`episodes` is the `itemRepo.search` result — full rows, so `itemToDTO` applies cleanly. Drop the hand-built object map.)
- [ ] **Step 2:** `npm run typecheck` clean. Commit `feat(api): /api/library/search returns ItemDTO under items key`.

---

## Task 4: `SourceDTO` (additive) at iOS-facing endpoints

**Files:** Create `lib/api/source-dto.ts`, `test/api/source-dto.test.ts`; Modify `app/api/answer/route.ts`, `app/api/conversations/[id]/route.ts`.

- [ ] **Step 1: Write `test/api/source-dto.test.ts`**
```ts
import { describe, expect, it } from "vitest"
import { toSourceDTO } from "@/lib/api/source-dto"

describe("toSourceDTO", () => {
  it("derives kind from flags and aliases podcastName→source", () => {
    expect(toSourceDTO({ itemId: "i", itemTitle: "T", startSec: 5, podcastName: "Show", isHighlight: true }))
      .toMatchObject({ kind: "highlight", source: "Show", itemTitle: "T", startSec: 5 })
    expect(toSourceDTO({ itemId: "", itemTitle: "Page", startSec: 0, url: "https://x", isWeb: true }))
      .toMatchObject({ kind: "web", url: "https://x" })
    expect(toSourceDTO({ itemId: "i", itemTitle: "T", startSec: 0 }).kind).toBe("item")
  })
})
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Create `lib/api/source-dto.ts`**
```ts
export type SourceKind = "item" | "highlight" | "web"

/** Loose input covering the stored ChatSource and the answer/search source shapes. */
export interface SourceInput {
  itemId: string
  itemTitle: string
  startSec: number
  podcastName?: string | null
  artworkUrl?: string | null
  audioUrl?: string | null
  videoId?: string | null
  url?: string | null
  snippet?: string | null
  content?: string | null
  isHighlight?: boolean
  isWeb?: boolean
}

export interface SourceDTO extends SourceInput {
  kind: SourceKind
  source: string | null
}

/** Additive: keeps every input field, adds a `kind` discriminator + `source` alias.
 *  Existing web consumers keep reading the original fields; iOS reads `kind`/`source`. */
export function toSourceDTO(s: SourceInput): SourceDTO {
  const kind: SourceKind = s.isWeb ? "web" : s.isHighlight ? "highlight" : "item"
  return { ...s, kind, source: s.podcastName ?? null }
}
```
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Emit at iOS-facing endpoints (additive, web-safe):**
  - `app/api/answer/route.ts`: wrap the returned sources — `sources: sources.map(toSourceDTO)` (the existing source objects gain `kind`/`source`; their other fields are unchanged, so `search-view` still works).
  - `app/api/conversations/[id]/route.ts`: when returning messages, map each message's `sources` (stored `ChatSource[]`) through `toSourceDTO` so iOS reading conversation history gets `kind`. (Map `message.sources?.map(toSourceDTO) ?? null`.)
- [ ] **Step 6:** `npm run typecheck` clean; web app `npm run build` succeeds. Commit `feat(api): SourceDTO kind discriminator at answer + conversation endpoints`.

---

## Task 5: Migrate web clients off `/api/episodes*`; delete legacy routes

**Files:** Modify `components/add-command.tsx`, `app-sidebar.tsx`, `library.tsx`, `ask-view.tsx`, `episode-actions.tsx`, `episode-view.tsx`; Delete the three `app/api/episodes/*` route files.

- [ ] **Step 1: Repoint GET-list fetches** `/api/episodes` → `/api/items`, read `d.items`. In each, the list items are now `ItemDTO`, so **`podcastName` becomes `source`** and `videoId` is top-level (not `sourceMetadata.videoId`). Update field reads:
  - `app-sidebar.tsx` (×2 fetches): `d.items`, fields `.id/.title/.artworkUrl/.status`.
  - `library.tsx`: `d.items`, fields incl. `.source` (was `.podcastName`), `.publishedAt`, `.createdAt` — NOTE `ItemDTO` has no `createdAt`; if `library.tsx` uses `createdAt` for grouping/sort, switch to `publishedAt` or have it sort by the array order (list is already `createdAt DESC` server-side). Confirm and adjust minimally.
  - `ask-view.tsx`: `d.items`, fields `.id/.title/.source/.artworkUrl/.audioUrl/.videoId` (videoId now top-level on the DTO — simpler than `sourceMetadata.videoId`).
  - `add-command.tsx` recents: `d.items`, `.source`.
- [ ] **Step 2: Podcast ingest** — `add-command.tsx` `ingest()`: POST to `/api/items` with the same body but `type: "podcast"` added; read `{ item }`; navigate `/episodes/${item.id}` (URL unchanged in SP2a). Update the toast text if it says "episode" (optional).
- [ ] **Step 3: library/search keys** — `add-command.tsx`: read `d.items` (was `d.episodes`) and `.source`; `moments` unchanged.
- [ ] **Step 4: Mutations** — `episode-actions.tsx`: retry → `POST /api/items/${id}/retry`; delete → `DELETE /api/items/${id}` (now 204 — adjust any `.json()` read to not assume a body). `episode-view.tsx` failed-state retry → `POST /api/items/${id}/retry`.
- [ ] **Step 5: Delete legacy routes** — `git rm app/api/episodes/route.ts app/api/episodes/[id]/route.ts app/api/episodes/[id]/retry/route.ts`. Then grep `'/api/episodes'` across `app/ components/` — expect **zero** remaining references.
- [ ] **Step 6: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors. Commit `refactor(api): migrate clients to /api/items; delete legacy /api/episodes routes`.

---

## Task 6: Env-gated auth middleware

**Files:** Create `middleware.ts` (repo root).

- [ ] **Step 1: Create `middleware.ts`**
```ts
import { NextResponse, type NextRequest } from "next/server"

export function middleware(req: NextRequest) {
  const token = process.env.API_AUTH_TOKEN
  if (!token) return NextResponse.next() // open by default
  const origin = req.headers.get("origin") ?? req.headers.get("referer") ?? ""
  const appUrl = process.env.APP_URL ?? ""
  const sameOrigin = appUrl !== "" && origin.startsWith(appUrl)
  const bearer = req.headers.get("authorization") === `Bearer ${token}`
  if (sameOrigin || bearer) return NextResponse.next()
  return new NextResponse("Unauthorized", { status: 401 })
}

export const config = {
  // All API routes except the Modal webhook (which has its own HMAC secret).
  matcher: ["/api/((?!modal/callback).*)"],
}
```
- [ ] **Step 2: Verify** — `npm run build` succeeds (middleware compiles). With `API_AUTH_TOKEN` unset, manual: the app works (open). Document in the spec/README that setting `API_AUTH_TOKEN` (and `APP_URL`) enables the gate. Commit `feat(api): env-gated bearer/same-origin auth middleware`.

---

## Task 7: SSRF guard on feed + drop `x-sources`

**Files:** Modify `app/api/itunes/episodes/route.ts`, `app/api/chat/route.ts`, `components/use-conversation.ts`.

- [ ] **Step 1: SSRF** — in `app/api/itunes/episodes/route.ts`, before calling the feed fetch, `import { assertFetchableUrl } from "@/lib/article/extract"` and call `assertFetchableUrl(feedUrl)` (wrap in try/catch → 400 on rejection).
- [ ] **Step 2: Drop the header (server)** — `app/api/chat/route.ts`: change the return to `return result.toUIMessageStreamResponse()` (remove the `headers: { "x-sources": … }`). Library sources are still persisted in `onFinish` (unchanged), so they survive on the conversation.
- [ ] **Step 3: Drop the header (client)** — `components/use-conversation.ts`: remove the `x-sources` header read + the `sources` variable seeded from it. During streaming, accumulate web sources from the `source-*` parts (unchanged); rely on `syncAfterStream()` (which refetches the persisted message via `GET /api/conversations/[id]`) to populate the full library+web sources after the stream. (If library sources must show *during* streaming, that's acceptable to defer to the post-stream sync — confirm the synced message includes them; it does, from `onFinish`.) Adjust the `mergedSources()` to just the streamed web sources during the live phase.
- [ ] **Step 4: Verify** — `npm run typecheck`; `npm test -- test/api` ; `npm run build`; manual: ask a question, confirm sources appear (after stream) on web. Commit `refactor(ask): drop x-sources header (sources come from the persisted conversation); SSRF-guard feed fetch`.

---

## Task 8: Final verification

- [ ] `npm run typecheck` clean; `npm test` (ONE run) all pass; `npm run build` succeeds; `npm run lint` baseline 11.
- [ ] Grep confirms no `/api/episodes` references remain in `app/` or `components/`.
- [ ] Manual smoke: library loads, add a podcast + an article, open detail, retry, delete, ask (sources show), `/api/items/[id]` returns the bundle, `PATCH` readState works.

---

## Self-Review (plan author)
- **Spec coverage:** read-later (T1); items/[id] GET/DELETE/PATCH (T2); library/search DTO (T3); SourceDTO additive at answer+conversation (T4); client migration + delete legacy (T5); auth middleware (T6); SSRF + x-sources (T7). The `entitiesForItem` alias note keeps T2 independent of the SP2b rename.
- **Placeholder scan:** none — full code/edits per step; the `library.tsx createdAt` and DELETE-204 body notes are concrete adjustments to confirm against the file, not placeholders.
- **Type consistency:** `ItemReadState` (schema) → `ItemDTO.readState` → `itemRepo.setReadState` → PATCH validation list; `SourceDTO`/`toSourceDTO` additive (keeps input fields); new `/api/items/[id]` matches the deleted `/api/episodes/[id]` semantics; clients read `source`/top-level `videoId` post-DTO.
