# YouTube Phase 1 — Polymorphic Data Model + DTO Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the podcast-only `episodes` model into a polymorphic, multi-source `items` model (podcast / youtube / article) with a clean DTO layer, while keeping the existing podcast flow fully working.

**Architecture:** Rename the `episodes` table → `items` and the `episodeId` foreign-key concept → `itemId` everywhere (DB + TypeScript). Add a `type` discriminator and a `sourceMetadata` JSONB column for source-specific identifiers. Introduce a `lib/api/` DTO layer so web and a future iOS client see one stable shape. No data migration (existing rows are dropped — data loss approved).

**Tech Stack:** Next.js 16, Drizzle ORM (postgres-js), Postgres + pgvector, Vitest, TypeScript.

---

## Naming & Modeling Decisions (locked for this plan)

These resolve gaps/refinements vs. the design spec. **Flagged deviations** are called out so they can be vetoed at plan-review time.

- **Rename (DB + TS):**
  - table `episodes` → `items`
  - table `episode_entities` → `item_entities`
  - column `episode_id` → `item_id` and TS field `episodeId` → `itemId` (all tables/consumers)
  - `EpisodeStatus` → `ItemStatus`
  - `lib/db/episodes.ts` → `lib/db/items.ts`; `makeEpisodeRepo` → `makeItemRepo`; `episodeRepo` → `itemRepo`; `NewEpisode` → `NewItem`
  - `lib/pipeline/process-transcript.ts` → `lib/pipeline/process-content.ts`; `processTranscript` → `processContent`; `TranscriptResult.episodeId` → `itemId`
  - `SearchHit.episodeId` → `itemId`; `ChatSource.episodeId` → `itemId`, `ChatSource.episodeTitle` → `itemTitle`
- **Add columns to `items`:** `type` (`ItemType`, NOT NULL, default `'podcast'`); `sourceMetadata` (JSONB, nullable).
- **Modify:** `items.audioUrl` becomes **nullable** (podcasts set it; YouTube leaves it null and plays via `sourceMetadata.videoId`).
- **Move into `sourceMetadata` (drop the columns):** `episodeGuid` → `sourceMetadata.guid`; `itunesCollectionId`/`itunesTrackId` → `sourceMetadata.itunesCollectionId`/`itunesTrackId`.
- **FLAGGED DEVIATION 1 — kept as columns (not moved to JSONB):** `podcastName`, `audioUrl`. The spec put podcast fields in `sourceMetadata`, but these two are read in ~20 UI/search/chat sites and are the playback/subtitle fields; keeping them as nullable shared columns avoids a large, risky ripple and keeps player/chat code clean. `podcastName` now holds the generic source/show/channel name.
- **FLAGGED DEVIATION 2 — kept the name `artworkUrl`/`artwork_url`** instead of the spec's `thumbnailUrl`. "Artwork" is source-neutral enough (covers video thumbnails), and renaming it ripples into ~20 view files for zero functional gain. Easy to revisit later.
- **Not in this phase:** `SourceAdapter`, YouTube ingestion, new `/api/items` endpoints, Modal/WARP, frontend player. Those are Phases 2–4. Phase 1 keeps the existing `/api/episodes/*` routes and `episode`-named React components as-is except for the internal `episodeId`→`itemId` rename.

## File Structure

- **Modify (designed, full code below):** `lib/db/schema.ts`, `lib/db/search.ts`, `lib/pipeline/process-transcript.ts` (→ rename), `app/api/episodes/route.ts`, `app/api/modal/callback/route.ts`, `app/api/episodes/[id]/retry/route.ts`, `lib/modal/client.ts`
- **Rename + modify:** `lib/db/episodes.ts` → `lib/db/items.ts`
- **Create:** `lib/api/dto.ts`, `test/api/dto.test.ts`
- **Mechanical sweep (compiler-gated, Task 9):** `lib/db/entities.ts`, `lib/db/topics.ts`, `lib/db/conversations.ts`, `lib/ai/insights.ts` (only if it references `episodeId`), `lib/entities/resolve.ts`, `scripts/backfill-entities.ts`, `app/api/chat/route.ts`, `app/api/conversations/route.ts`, `app/api/answer/route.ts`, `app/api/library/search/route.ts`, `app/api/episodes/[id]/route.ts`, `app/page.tsx`, `app/topics/[slug]/page.tsx`, `app/entities/[slug]/page.tsx`, `app/episodes/[id]/page.tsx`, and all `components/*` plus `test/*` that reference `episodeId`/`episodeTitle`.

---

## Task 1: Schema — rename to `items`, add `type` + `sourceMetadata`

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Rewrite the `episodes` table block and the status type**

Replace lines 15–37 (the `EpisodeStatus` type and `episodes` table) with:

```ts
export type ItemStatus =
  | "processing"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "failed"

export type ItemType = "podcast" | "youtube" | "article"

export type SourceMetadata = {
  // podcast
  guid?: string
  itunesCollectionId?: number
  itunesTrackId?: number
  // youtube
  videoId?: string
  channelId?: string
  channelName?: string
}

export const items = pgTable("items", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type").$type<ItemType>().notNull().default("podcast"),
  title: text("title").notNull(),
  podcastName: text("podcast_name"),
  audioUrl: text("audio_url"),
  sourceUrl: text("source_url"),
  artworkUrl: text("artwork_url"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  durationSec: integer("duration_sec"),
  status: text("status").$type<ItemStatus>().notNull().default("processing"),
  errorMessage: text("error_message"),
  sourceMetadata: jsonb("source_metadata").$type<SourceMetadata>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
```

Note `bigint` is no longer used by this table; leave the import — it may be used elsewhere; if `npm run typecheck` later flags it as unused, remove it from the import on line 3–13.

- [ ] **Step 2: Rename `episodeId`→`itemId` and the `episodes` reference in `transcripts`, `insights`, `chunks`, `conversations`**

In each of these tables replace the foreign-key column definition. For `transcripts` (lines 39–46):

```ts
export const transcripts = pgTable("transcripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  fullText: text("full_text").notNull(),
  segments: jsonb("segments").$type<{ start: number; end: number; text: string }[]>(),
})
```

For `insights` (lines 48–61), change only the FK:

```ts
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
```

For `chunks` (lines 112–118), change the FK:

```ts
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
```

For `conversations` (line 140) and its index (line 145):

```ts
    itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
```
```ts
  (t) => [index("conversations_item_updated_idx").on(t.itemId, t.updatedAt)],
```

- [ ] **Step 3: Rename `episodeEntities` table → `itemEntities`**

Replace lines 94–110:

```ts
export const itemEntities = pgTable(
  "item_entities",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    context: text("context"),
    approxTimestampSec: integer("approx_timestamp_sec"),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.entityId] }),
    index("item_entities_entity_idx").on(t.entityId),
  ],
)
```

- [ ] **Step 4: Update `ChatSource` type (lines 149–156)**

```ts
export type ChatSource = {
  itemId: string
  itemTitle: string
  startSec: number
  podcastName?: string | null
  artworkUrl?: string | null
  audioUrl?: string | null
}
```

- [ ] **Step 5: Verify the schema file type-checks in isolation**

Run: `npm run typecheck`
Expected: errors ONLY in downstream files that still reference `episodes`/`episodeId`/`episodeEntities`/`EpisodeStatus` (those are fixed in later tasks). `lib/db/schema.ts` itself must report no errors. If `bigint` is flagged unused, remove it from the import.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts
git commit -m "refactor(schema): episodes -> polymorphic items with type + sourceMetadata"
```

---

## Task 2: Generate and apply the migration

**Files:**
- Create: a new file under `lib/db/migrations/` (generated)

Data loss is approved, so a drop/recreate migration is acceptable.

- [ ] **Step 1: Generate the migration**

Run: `npm run db:generate`
Expected: drizzle-kit prints a new migration file path under `lib/db/migrations/`. When prompted about renamed tables/columns, choosing "create/drop" (rather than rename) is fine given data loss.

- [ ] **Step 2: Eyeball the generated SQL**

Open the new `lib/db/migrations/NNNN_*.sql`. Confirm it creates `items`, `item_entities`, and the renamed `item_id` columns, and references are intact. No manual edits expected.

- [ ] **Step 3: Apply to the database**

Run: `npm run db:migrate`
Expected: completes without error. (If the local DB has old `episodes` data that blocks a drop, dropping those tables is acceptable — data loss approved.)

- [ ] **Step 4: Commit**

```bash
git add lib/db/migrations
git commit -m "chore(db): migration for items model rename"
```

---

## Task 3: Repo — `lib/db/episodes.ts` → `lib/db/items.ts`

**Files:**
- Create: `lib/db/items.ts`
- Delete: `lib/db/episodes.ts`
- Test: `test/db/items.test.ts` (rename of `test/db/episodes.test.ts`)

- [ ] **Step 1: Write the failing test for `sourceMetadata`-based dedup**

Rename `test/db/episodes.test.ts` → `test/db/items.test.ts` and update it to the new API. Add this dedup test (uses the project's existing in-test DB harness — mirror the harness already used by the other `test/db/*.test.ts` files):

```ts
import { describe, expect, it } from "vitest"
import { makeItemRepo } from "@/lib/db/items"
import { testDb } from "../helpers/db" // use the SAME helper the other db tests import

describe("itemRepo.create dedup", () => {
  it("dedupes podcasts by sourceMetadata.guid", async () => {
    const repo = makeItemRepo(testDb)
    const a = await repo.create({
      type: "podcast",
      title: "Ep 1",
      audioUrl: "https://x/1.mp3",
      sourceMetadata: { guid: "guid-1" },
    })
    const b = await repo.create({
      type: "podcast",
      title: "Ep 1 (dupe)",
      audioUrl: "https://x/1-other.mp3",
      sourceMetadata: { guid: "guid-1" },
    })
    expect(b.id).toBe(a.id)
  })
})
```

(If `test/helpers/db` doesn't exist, copy the DB-setup pattern from the existing `test/db/episodes.test.ts` before deleting it.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- test/db/items.test.ts`
Expected: FAIL — `makeItemRepo` / `lib/db/items` not found.

- [ ] **Step 3: Create `lib/db/items.ts`**

```ts
import { desc, eq, ilike, or, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { items, type ItemStatus, type ItemType, type SourceMetadata } from "./schema"
import * as schema from "./schema"

export interface NewItem {
  type: ItemType
  title: string
  audioUrl?: string
  podcastName?: string
  sourceUrl?: string
  artworkUrl?: string
  publishedAt?: Date
  durationSec?: number
  sourceMetadata?: SourceMetadata
}

type DB = PostgresJsDatabase<typeof schema>

export function makeItemRepo(db: DB) {
  return {
    async create(input: NewItem) {
      // Dedupe: prefer sourceMetadata.guid, fall back to audioUrl (podcasts),
      // then sourceUrl (everything else).
      const guid = input.sourceMetadata?.guid
      const existing = guid
        ? await db
            .select()
            .from(items)
            .where(sql`${items.sourceMetadata}->>'guid' = ${guid}`)
            .limit(1)
        : input.audioUrl
          ? await db.select().from(items).where(eq(items.audioUrl, input.audioUrl)).limit(1)
          : input.sourceUrl
            ? await db.select().from(items).where(eq(items.sourceUrl, input.sourceUrl)).limit(1)
            : []
      if (existing[0]) return existing[0]

      const [row] = await db.insert(items).values(input).returning()
      return row
    },

    async getById(id: string) {
      const rows = await db.select().from(items).where(eq(items.id, id)).limit(1)
      return rows[0] ?? null
    },

    async list() {
      return db.select().from(items).orderBy(desc(items.createdAt))
    },

    // Local title/show search for the global ⌘K palette.
    async search(query: string, limit = 6) {
      const term = `%${query}%`
      return db
        .select()
        .from(items)
        .where(or(ilike(items.title, term), ilike(items.podcastName, term)))
        .orderBy(desc(items.createdAt))
        .limit(limit)
    },

    async updateStatus(id: string, status: ItemStatus, errorMessage?: string) {
      await db
        .update(items)
        .set({ status, errorMessage: errorMessage ?? null })
        .where(eq(items.id, id))
    },

    async remove(id: string) {
      await db.delete(items).where(eq(items.id, id))
    },
  }
}

import { db } from "./index"
export const itemRepo = makeItemRepo(db)
```

- [ ] **Step 4: Delete the old repo**

```bash
git rm lib/db/episodes.ts
```

- [ ] **Step 5: Run the test**

Run: `npm test -- test/db/items.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/items.ts test/db/items.test.ts
git commit -m "refactor(db): episodeRepo -> itemRepo with sourceMetadata dedup"
```

---

## Task 4: Pipeline — `process-transcript.ts` → `process-content.ts`

**Files:**
- Create: `lib/pipeline/process-content.ts`
- Delete: `lib/pipeline/process-transcript.ts`
- Test: rename `test/pipeline/process-transcript.test.ts` → `test/pipeline/process-content.test.ts`

- [ ] **Step 1: Create `lib/pipeline/process-content.ts`**

Same logic as today, with `episodeId`→`itemId`, `processTranscript`→`processContent`, repo import updated, and `episodeEntities`→`itemEntities`:

```ts
import { eq } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { chunkSegments, type Segment } from "@/lib/ai/chunk"
import { embedTexts as defaultEmbedTexts } from "@/lib/ai/embeddings"
import {
  generateInsights as defaultGenerateInsights,
  type Insights,
} from "@/lib/ai/insights"
import { makeItemRepo } from "@/lib/db/items"
import * as schema from "@/lib/db/schema"
import { resolveEpisodeEntities, type ExtractedEntity } from "@/lib/entities/resolve"

export interface TranscriptResult {
  itemId: string
  transcript: string
  segments: Segment[]
}

export interface PipelineDeps {
  db: PostgresJsDatabase<typeof schema>
  generateInsights?: (transcript: string, segments: Segment[]) => Promise<Insights>
  embedTexts?: (texts: string[]) => Promise<number[][]>
  resolveEntities?: (
    itemId: string,
    extracted: ExtractedEntity[],
    opts: { episodeTitle?: string },
  ) => Promise<void>
}

export async function processContent(result: TranscriptResult, deps: PipelineDeps) {
  const { db } = deps
  const repo = makeItemRepo(db)
  const genInsights =
    deps.generateInsights ?? ((t: string, s: Segment[]) => defaultGenerateInsights(t, { segments: s }))
  const embed = deps.embedTexts ?? ((t: string[]) => defaultEmbedTexts(t))
  const resolveEntities =
    deps.resolveEntities ??
    ((itemId: string, extracted: ExtractedEntity[], opts: { episodeTitle?: string }) =>
      resolveEpisodeEntities(itemId, extracted, { db, embedTexts: embed }, opts))

  try {
    // 0. Make re-processing idempotent (retry, or a duplicate Modal callback).
    await db.delete(schema.insights).where(eq(schema.insights.itemId, result.itemId))
    await db.delete(schema.chunks).where(eq(schema.chunks.itemId, result.itemId))
    await db.delete(schema.itemEntities).where(eq(schema.itemEntities.itemId, result.itemId))
    await db.delete(schema.transcripts).where(eq(schema.transcripts.itemId, result.itemId))

    // 1. Store transcript
    await db.insert(schema.transcripts).values({
      itemId: result.itemId,
      fullText: result.transcript,
      segments: result.segments,
    })

    // 2. Insights
    await repo.updateStatus(result.itemId, "analyzing")
    const insights = await genInsights(result.transcript, result.segments)
    await db.insert(schema.insights).values({
      itemId: result.itemId,
      summary: insights.summary,
      takeaways: insights.takeaways,
      topics: insights.topics,
      chapters: insights.chapters,
      quotes: insights.quotes,
      entities: insights.entities,
    })

    // 3. Chunk + embed
    const chunks = chunkSegments(result.segments, { targetTokens: 600, overlapSegments: 1 })
    if (chunks.length > 0) {
      const vectors = await embed(chunks.map((c) => c.content))
      await db.insert(schema.chunks).values(
        chunks.map((c, i) => ({
          itemId: result.itemId,
          content: c.content,
          startSec: c.startSec,
          endSec: c.endSec,
          embedding: vectors[i],
        })),
      )
    }

    // 3.5. Canonical entities — best-effort.
    try {
      const item = await repo.getById(result.itemId)
      await resolveEntities(result.itemId, insights.entities ?? [], {
        episodeTitle: item?.title,
      })
    } catch (e) {
      console.error(`entity resolution failed for item ${result.itemId}`, e)
    }

    // 4. Ready
    await repo.updateStatus(result.itemId, "ready")
  } catch (e) {
    await repo.updateStatus(
      result.itemId,
      "failed",
      e instanceof Error ? e.message : String(e),
    )
    throw e
  }
}
```

Note: `resolveEpisodeEntities`'s internal `episodeId` parameter rename is handled in Task 9 (it lives in `lib/entities/resolve.ts`). Here we pass `result.itemId` positionally, so this file compiles regardless of that param's name.

- [ ] **Step 2: Delete the old pipeline file**

```bash
git rm lib/pipeline/process-transcript.ts
```

- [ ] **Step 3: Update the renamed test**

Rename `test/pipeline/process-transcript.test.ts` → `test/pipeline/process-content.test.ts`; update imports to `processContent` from `@/lib/pipeline/process-content`, and every `episodeId:` key in `TranscriptResult` fixtures to `itemId:`.

- [ ] **Step 4: Run the pipeline test**

Run: `npm test -- test/pipeline/process-content.test.ts`
Expected: PASS (it may still fail to compile until Task 9 fixes `resolve.ts`; if so, note it and proceed — Task 9 Step "run full suite" is the real gate).

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/process-content.ts test/pipeline/process-content.test.ts
git commit -m "refactor(pipeline): processTranscript -> processContent on itemId"
```

---

## Task 5: `lib/db/search.ts` — itemId rename incl. raw SQL

**Files:**
- Modify: `lib/db/search.ts`

- [ ] **Step 1: Update imports, `SearchHit`, and the Drizzle query**

- Line 3: `import { chunks, episodes, transcripts } from "./schema"` → `import { chunks, items, transcripts } from "./schema"`
- `SearchHit` (lines 6–17): rename `episodeId` → `itemId`, `episodeTitle` → `itemTitle`.
- In `searchChunks` (lines 26–40): `episodeId: chunks.episodeId` → `itemId: chunks.itemId`; `episodeTitle: episodes.title` → `itemTitle: items.title`; `podcastName: episodes.podcastName` → `items.podcastName`; `artworkUrl: episodes.artworkUrl` → `items.artworkUrl`; `audioUrl: episodes.audioUrl` → `items.audioUrl`; `.innerJoin(episodes, eq(chunks.episodeId, episodes.id))` → `.innerJoin(items, eq(chunks.itemId, items.id))`; the `opts.episodeId` references → `opts.itemId` (also rename the option key in the signature on line 22: `episodeId?: string` → `itemId?: string`).

- [ ] **Step 2: Update the raw SQL in `hybridSearch` (lines 73–78)**

Replace the trailing `select ... from fused` block with:

```sql
    select c.id as "chunkId", c.item_id as "itemId", e.title as "itemTitle",
           e.podcast_name as "podcastName", e.artwork_url as "artworkUrl", e.audio_url as "audioUrl",
           c.content, c.start_sec as "startSec", c.end_sec as "endSec", f.score as "similarity"
    from fused f
    join chunks c on c.id = f.id
    join items e on e.id = c.item_id
    order by f.score desc
    limit ${limit}
```

- [ ] **Step 3: Update `refineHitTimestamps` (lines 105–113)**

- `const episodeIds = [...new Set(hits.map((h) => h.episodeId))]` → `const itemIds = [...new Set(hits.map((h) => h.itemId))]`
- select `episodeId: transcripts.episodeId` → `itemId: transcripts.itemId`
- `inArray(transcripts.episodeId, episodeIds)` → `inArray(transcripts.itemId, itemIds)`
- `segsByEpisode` map keyed by `r.itemId`; `segsByEpisode.get(h.itemId)`.

- [ ] **Step 4: Type-check this file's consumers compile**

Run: `npm run typecheck`
Expected: remaining errors only in not-yet-updated files (Task 6, 9). `lib/db/search.ts` reports none.

- [ ] **Step 5: Commit**

```bash
git add lib/db/search.ts
git commit -m "refactor(search): episodeId -> itemId in query + raw SQL"
```

---

## Task 6: Modal client, callback, episodes route, retry route

**Files:**
- Modify: `lib/modal/client.ts`, `app/api/modal/callback/route.ts`, `app/api/episodes/route.ts`, `app/api/episodes/[id]/retry/route.ts`

The Modal **wire protocol** (`episode_id`/`audio_url` JSON keys) stays as-is in Phase 1 — the deployed podcast Modal function still sends `episode_id`. We only rename internal TS identifiers and adapt the create payload to `sourceMetadata`.

- [ ] **Step 1: `lib/modal/client.ts`**

Rename the param and keep the wire key:

```ts
export async function triggerTranscription(itemId: string, audioUrl: string) {
  const endpoint = process.env.MODAL_TRANSCRIBE_URL
  const secret = process.env.MODAL_WEBHOOK_SECRET
  const appUrl = process.env.APP_URL
  if (!endpoint || !secret || !appUrl) {
    throw new Error("Modal env not configured (MODAL_TRANSCRIBE_URL/SECRET/APP_URL)")
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      episode_id: itemId, // wire key unchanged; deployed Modal fn echoes it back
      audio_url: audioUrl,
      callback_url: `${appUrl}/api/modal/callback`,
      secret,
    }),
  })
  if (!res.ok) throw new Error(`Modal trigger failed: ${res.status}`)
}
```

- [ ] **Step 2: `app/api/modal/callback/route.ts`**

Keep reading `body.episode_id` from the wire, but map it to `itemId` internally and call `processContent`:

- Line 3: `import { episodeRepo } from "@/lib/db/episodes"` → `import { itemRepo } from "@/lib/db/items"`
- Line 4: `import { processTranscript } from "@/lib/pipeline/process-transcript"` → `import { processContent } from "@/lib/pipeline/process-content"`
- Lines 22–25: `const itemId = body.episode_id` (keep validation; rename error string to `"missing episode_id"` is fine to keep, wire key unchanged).
- Line 29: `episodeRepo.updateStatus(itemId, ...)` → `itemRepo.updateStatus(itemId, ...)`
- Lines 34–36: 
```ts
  processContent(
    { itemId, transcript: body.transcript, segments: body.segments ?? [] },
    { db },
  ).catch(() => {})
```

- [ ] **Step 3: `app/api/episodes/route.ts`**

- Line 1: import `itemRepo` from `@/lib/db/items`.
- GET (lines 4–7): keep returning `{ episodes: list }` (response key unchanged so existing consumers don't break in Phase 1).
- POST: build a podcast `NewItem` with `sourceMetadata`:

```ts
  const item = await itemRepo.create({
    type: "podcast",
    title: body.title,
    audioUrl: body.audioUrl,
    podcastName: body.podcastName,
    sourceUrl: body.sourceUrl,
    artworkUrl: body.artworkUrl,
    publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined,
    durationSec: body.durationSec,
    sourceMetadata: {
      guid: body.episodeGuid,
      itunesCollectionId: body.itunesCollectionId,
      itunesTrackId: body.itunesTrackId,
    },
  })

  if (item.status === "processing" && item.audioUrl) {
    triggerTranscription(item.id, item.audioUrl)
      .then(() => itemRepo.updateStatus(item.id, "transcribing"))
      .catch((e) => itemRepo.updateStatus(item.id, "failed", String(e?.message ?? e)))
  }

  return Response.json({ episode: item }, { status: 201 })
```

Keep the `body.audioUrl` required-field check unchanged (podcasts still require it).

- [ ] **Step 4: `app/api/episodes/[id]/retry/route.ts`**

- Import `itemRepo` from `@/lib/db/items` (replace `episodeRepo`).
- Rename the local `episode` variable to `item`; `triggerTranscription(id, item.audioUrl)` — guard `if (item.audioUrl)` since it's now nullable.
- Any `episodeRepo.` → `itemRepo.`.

- [ ] **Step 5: Type-check**

Run: `npm run typecheck`
Expected: remaining errors only in Task 9 files.

- [ ] **Step 6: Commit**

```bash
git add lib/modal/client.ts app/api/modal/callback/route.ts app/api/episodes/route.ts app/api/episodes/[id]/retry/route.ts
git commit -m "refactor(api): itemRepo + processContent + sourceMetadata in podcast ingest"
```

---

## Task 7: DTO layer (`lib/api/dto.ts`)

**Files:**
- Create: `lib/api/dto.ts`
- Test: `test/api/dto.test.ts`

This is the stable shape web + a future iOS client consume. It flattens `sourceMetadata` into explicit fields and ISO-formats dates.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { itemToDTO } from "@/lib/api/dto"

describe("itemToDTO", () => {
  it("maps a podcast row to a stable DTO", () => {
    const dto = itemToDTO({
      id: "i1",
      type: "podcast",
      title: "Ep 1",
      podcastName: "My Show",
      audioUrl: "https://x/1.mp3",
      sourceUrl: "https://x/ep1",
      artworkUrl: "https://x/art.jpg",
      publishedAt: new Date("2026-01-02T03:04:05Z"),
      durationSec: 3600,
      status: "ready",
      errorMessage: null,
      sourceMetadata: { guid: "g1", itunesCollectionId: 99 },
      createdAt: new Date("2026-01-01T00:00:00Z"),
    })
    expect(dto).toMatchObject({
      id: "i1",
      type: "podcast",
      title: "Ep 1",
      source: "My Show",
      audioUrl: "https://x/1.mp3",
      artworkUrl: "https://x/art.jpg",
      durationSec: 3600,
      status: "ready",
      videoId: null,
      publishedAt: "2026-01-02T03:04:05.000Z",
    })
  })

  it("exposes youtube videoId from sourceMetadata", () => {
    const dto = itemToDTO({
      id: "i2",
      type: "youtube",
      title: "Vid",
      podcastName: "Some Channel",
      audioUrl: null,
      sourceUrl: "https://youtube.com/watch?v=abc",
      artworkUrl: "https://x/thumb.jpg",
      publishedAt: null,
      durationSec: null,
      status: "processing",
      errorMessage: null,
      sourceMetadata: { videoId: "abc", channelId: "c1" },
      createdAt: new Date("2026-01-01T00:00:00Z"),
    })
    expect(dto.videoId).toBe("abc")
    expect(dto.publishedAt).toBeNull()
    expect(dto.audioUrl).toBeNull()
  })
})
```

- [ ] **Step 2: Run it — confirm fail**

Run: `npm test -- test/api/dto.test.ts`
Expected: FAIL — `@/lib/api/dto` not found.

- [ ] **Step 3: Implement `lib/api/dto.ts`**

```ts
import type { InferSelectModel } from "drizzle-orm"
import type { items } from "@/lib/db/schema"
import type { ItemStatus, ItemType } from "@/lib/db/schema"

export type ItemRow = InferSelectModel<typeof items>

export interface ItemDTO {
  id: string
  type: ItemType
  title: string
  source: string | null // show / channel / author (podcastName today)
  audioUrl: string | null
  sourceUrl: string | null
  artworkUrl: string | null
  durationSec: number | null
  publishedAt: string | null // ISO 8601
  status: ItemStatus
  videoId: string | null // youtube only, from sourceMetadata
}

export function itemToDTO(row: ItemRow): ItemDTO {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    source: row.podcastName ?? null,
    audioUrl: row.audioUrl ?? null,
    sourceUrl: row.sourceUrl ?? null,
    artworkUrl: row.artworkUrl ?? null,
    durationSec: row.durationSec ?? null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    status: row.status,
    videoId: row.sourceMetadata?.videoId ?? null,
  }
}
```

- [ ] **Step 4: Run the test — confirm pass**

Run: `npm test -- test/api/dto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api/dto.ts test/api/dto.test.ts
git commit -m "feat(api): ItemDTO serialization layer (web + future iOS)"
```

---

## Task 8: Wire the DTO into the episode detail page (proof of use)

**Files:**
- Modify: `app/api/episodes/[id]/route.ts`

Give the existing single-item endpoint a DTO-shaped JSON response so the layer is exercised end-to-end. (Server components can keep reading the repo directly for now.)

- [ ] **Step 1: Return `itemToDTO` from the GET handler**

In `app/api/episodes/[id]/route.ts`, import `itemRepo` from `@/lib/db/items` and `itemToDTO` from `@/lib/api/dto`. In the GET handler, after fetching the row by id, return:

```ts
  const row = await itemRepo.getById(id)
  if (!row) return Response.json({ error: "not found" }, { status: 404 })
  return Response.json({ item: itemToDTO(row) })
```

(Preserve any DELETE handler in the same file; only the GET body and imports change. If the file currently nests other queries, keep them and only swap the repo import + the GET return shape.)

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: remaining errors only in Task 9 files.

- [ ] **Step 3: Commit**

```bash
git add app/api/episodes/[id]/route.ts
git commit -m "feat(api): serve ItemDTO from GET /api/episodes/[id]"
```

---

## Task 9: Mechanical sweep — rename all remaining `episodeId`/`episodeEntities` references

**Files (all remaining references):** `lib/db/entities.ts`, `lib/db/topics.ts`, `lib/db/conversations.ts`, `lib/entities/resolve.ts`, `scripts/backfill-entities.ts`, `app/api/chat/route.ts`, `app/api/conversations/route.ts`, `app/api/answer/route.ts`, `app/api/library/search/route.ts`, `app/topics/[slug]/page.tsx`, `app/entities/[slug]/page.tsx`, `app/episodes/[id]/page.tsx`, `app/page.tsx`, and every `components/*` + `test/*` file the grep below reports.

This is a compiler-gated mechanical rename. Apply the mapping table consistently; the type-checker and test suite are the safety nets.

**Exact symbol mapping (apply everywhere):**

| Old | New |
|---|---|
| `episodeEntities` (schema import/use) | `itemEntities` |
| `schema.episodeEntities` | `schema.itemEntities` |
| `.episodeId` (Drizzle column on transcripts/insights/chunks/conversations/itemEntities) | `.itemId` |
| `episode_id` (raw SQL) | `item_id` |
| `episodeId` (TS field in `SearchHit`/`ChatSource`/local query result types) | `itemId` |
| `episodeTitle` (in `ChatSource` + chat/search consumers) | `itemTitle` |
| `episodeRepo` / `makeEpisodeRepo` | `itemRepo` / `makeItemRepo` |
| `from "@/lib/db/episodes"` | `from "@/lib/db/items"` |
| `processTranscript` / `from "@/lib/pipeline/process-transcript"` | `processContent` / `from "@/lib/pipeline/process-content"` |
| `EpisodeStatus` | `ItemStatus` |
| `episodes` (Drizzle table import/use) | `items` |

**Do NOT rename** (kept per Flagged Deviations): `podcastName`, `audioUrl`, `artworkUrl`, the `/api/episodes/*` route paths, the `episode`-named React component files, and React props/local type fields literally named `podcastName`/`artworkUrl`/`audioUrl`.

**Special cases inside this sweep:**
- `lib/entities/resolve.ts`: the exported `resolveEpisodeEntities(episodeId, ...)` — rename the **parameter** `episodeId` → `itemId` and any `schema.episodeEntities` → `schema.itemEntities`, `.episodeId` → `.itemId`. Keep the function name `resolveEpisodeEntities` (renaming it is optional churn; leave for a later cleanup) OR rename to `resolveItemEntities` and update its two call sites (`process-content.ts`, `scripts/backfill-entities.ts`). Pick one and be consistent.
- `lib/db/entities.ts` (lines ~51–52 select `episodes.podcastName`/`episodes.artworkUrl` and joins on `episodeEntities`): swap table `episodes`→`items`, `episodeEntities`→`itemEntities`, `.episodeId`→`.itemId`. Column refs `items.podcastName`/`items.artworkUrl` keep their names.
- `lib/db/topics.ts`: same table/column swap; `episodes.podcastName`→`items.podcastName` etc.
- `app/api/chat/route.ts` + `components/chat-message.tsx` + `components/search-view.tsx` + `components/conversation-view.tsx` + `components/ask-view.tsx`: update `ChatSource`/source objects to `itemId`/`itemTitle`; leave `podcastName`/`artworkUrl`/`audioUrl` keys as-is.

- [ ] **Step 1: Enumerate everything still referencing the old names**

Run:
```bash
rg -n "episodeEntities|episode_id|\.episodeId|episodeTitle|episodeRepo|makeEpisodeRepo|from \"@/lib/db/episodes\"|processTranscript|process-transcript|EpisodeStatus|\bepisodes\b" lib app components scripts test --glob '!lib/db/migrations/**'
```
Expected: a finite list of files/lines. This is the worklist.

- [ ] **Step 2: Apply the mapping table file-by-file**

Edit each file from Step 1 per the mapping table and special cases. Work through the list top to bottom; re-run the Step 1 `rg` periodically to track remaining hits. Stop when it returns nothing (except intentional keeps like wire keys / route paths / kept column names).

- [ ] **Step 3: Type-check until clean**

Run: `npm run typecheck`
Expected: **zero** errors. Fix any reported reference until clean.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass. Update any remaining test files whose fixtures/imports still use old names (apply the same mapping table). Re-run until green.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no new errors. Remove any now-unused imports the sweep left behind (e.g. `bigint` in `schema.ts`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: complete episodeId -> itemId sweep across app"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full gate**

Run, in order, and confirm each passes:
```bash
npm run typecheck
npm test
npm run lint
npm run build
```
Expected: all succeed. `npm run build` confirms the Next.js app compiles with the renamed model.

- [ ] **Step 2: Smoke-test the podcast path still works (manual)**

With the dev server (`npm run dev`) and a real DB + Modal env, add a podcast via the ⌘K palette and confirm it reaches `ready` and renders. (Existing podcast functionality must be intact — this phase changes names, not behavior.)

- [ ] **Step 3: Final commit if anything changed**

```bash
git add -A
git commit -m "chore: phase 1 verification fixups" --allow-empty
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** polymorphic `items` model ✅ (Task 1); `type` + `sourceMetadata` ✅; nullable segments — already nullable in current schema, preserved ✅; DTO layer ✅ (Task 7–8); clean rename ✅ (Tasks 3–9). SourceAdapter / YouTube ingest / Modal / frontend are explicitly out of scope (Phases 2–4).
- **Placeholder scan:** none — every code step has full code or an exact mapping table + commands.
- **Type consistency:** `itemId`, `ItemStatus`, `ItemType`, `SourceMetadata`, `makeItemRepo`/`itemRepo`, `NewItem`, `processContent`/`TranscriptResult.itemId`, `itemToDTO`/`ItemDTO`, `SearchHit.itemId`/`itemTitle`, `ChatSource.itemId`/`itemTitle` used consistently across tasks.
- **Flagged deviations from spec:** (1) `podcastName`/`audioUrl` kept as columns not JSONB; (2) `artworkUrl` name kept instead of `thumbnailUrl`. Both reduce blast radius; vetoable at review.
