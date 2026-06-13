# Highlights in /ask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved highlights semantically searchable in `/ask` (conversation library-wide + attached-item, and the search page) and surface matches as distinct "Highlight" sources, with existing highlights backfilled so it works immediately.

**Architecture:** Add an embedding to each highlight (embed on create + backfill), add `searchHighlights` (pgvector, mirrors `searchChunks`), and a shared `assembleAskSources` helper that merges chunk hits (grouped) with highlight hits into one numbered source list + LLM context. Both ask routes use it; the chat + search UIs render `isHighlight` sources as badged cards.

**Tech Stack:** Next.js 16, Drizzle (postgres-js) + pgvector, OpenAI embeddings (`text-embedding-3-small`, 1536d), Vitest, tsx, React 19.

**Spec:** `docs/superpowers/specs/2026-06-13-highlights-in-ask-design.md`

## File Structure

- **Create:** `lib/ai/ask-sources.ts` (+ `test/ai/ask-sources.test.ts`), `lib/db/migrations/0008_highlight_embedding.sql`, `scripts/backfill-highlight-embeddings.ts`.
- **Modify:** `lib/db/schema.ts` (highlights `embedding`), `lib/db/migrations/meta/_journal.json`; `lib/db/highlights.ts` (`create` accepts `embedding`); `app/api/highlights/route.ts` (embed on create); `lib/db/search.ts` (`searchHighlights` + `HighlightHit`); `app/api/chat/route.ts` + `app/api/answer/route.ts` (wire highlights); `components/chat-message.tsx` + `components/search-view.tsx` (`isHighlight` rendering). Tests: `test/db/highlights.test.ts`, `test/api/highlights-route.test.ts`.

---

## Task 1: Schema + migration — `highlights.embedding`

**Files:** Modify `lib/db/schema.ts`, `lib/db/migrations/meta/_journal.json`; Create `lib/db/migrations/0008_highlight_embedding.sql`.

- [ ] **Step 1: Add the column** to the `highlights` table in `lib/db/schema.ts` (after `locator`; `vector` is already imported — it's used by `chunks`):

```ts
    locator: jsonb("locator").$type<HighlightLocator>(),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
```

- [ ] **Step 2: Create `lib/db/migrations/0008_highlight_embedding.sql`** (verbatim)

```sql
ALTER TABLE "highlights" ADD COLUMN "embedding" vector(1536);
```

- [ ] **Step 3: Append to `lib/db/migrations/meta/_journal.json`** entries array (after the `idx: 7` entry — add a comma after its closing brace):

```json
    {
      "idx": 8,
      "version": "7",
      "when": 1781500000000,
      "tag": "0008_highlight_embedding",
      "breakpoints": true
    }
```

- [ ] **Step 4: Apply** — `npm run db:migrate` (expect `migrations applied`); `npm run typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations/0008_highlight_embedding.sql lib/db/migrations/meta/_journal.json
git commit -m "feat(db): highlights.embedding column + migration"
```

---

## Task 2: Repo accepts embedding + embed on create

**Files:** Modify `lib/db/highlights.ts`, `app/api/highlights/route.ts`; Test `test/api/highlights-route.test.ts`.

- [ ] **Step 1: Repo `create` accepts an embedding.** In `lib/db/highlights.ts`, add `embedding` to `NewHighlight` and write it. Change the `NewHighlight` interface:

```ts
export interface NewHighlight {
  itemId: string
  kind: HighlightKind
  text: string
  note?: string
  locator?: HighlightLocator
  embedding?: number[]
}
```

In `create`, add `embedding` to the inserted values:

```ts
        .values({
          itemId: input.itemId,
          kind: input.kind,
          text: input.text,
          note: input.note ?? null,
          locator: input.locator,
          embedding: input.embedding,
        })
```

- [ ] **Step 2: Write the failing test** — append to `test/api/highlights-route.test.ts`. This mocks the embeddings module so POST embeds the text and passes it to `create`. Add the mock near the top alongside the existing `vi.mock("@/lib/db/highlights", ...)`:

```ts
vi.mock("@/lib/ai/embeddings", () => ({
  embedQuery: vi.fn(async () => Array(1536).fill(0.1)),
}))
```

And the test:

```ts
test("POST embeds the highlight text and stores the vector", async () => {
  const { POST } = await import("@/app/api/highlights/route")
  await POST(
    new Request("http://t/api/highlights", {
      method: "POST",
      body: JSON.stringify({ itemId: "i1", kind: "transcript", text: "hello", locator: { sec: 5 } }),
    }),
  )
  expect(created[0].embedding).toHaveLength(1536)
})
```

(`created` is the array the existing `highlightRepo.create` mock pushes to. If the existing mock spreads `...v` into the stored row, `embedding` will be captured. Confirm the mock does `created.push({ ...v, ... })`; if not, adjust the mock to retain `embedding`.)

- [ ] **Step 3: Run — expect FAIL** (`npm test -- test/api/highlights-route.test.ts`).

- [ ] **Step 4: Embed on create** in `app/api/highlights/route.ts` `POST`. Add the import:

```ts
import { embedQuery } from "@/lib/ai/embeddings"
```

After validation passes and before/at `highlightRepo.create(...)`, compute the embedding (failure must not block saving):

```ts
  let embedding: number[] | undefined
  try {
    embedding = await embedQuery(text)
  } catch (e) {
    console.error("highlight embedding failed", e)
  }
  const row = await highlightRepo.create({
    itemId: body.itemId,
    kind: body.kind,
    text,
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined,
    locator: body.locator ?? undefined,
    embedding,
  })
```

(Keep the rest of `POST` — the validation block and the `Response.json({ highlight: row }, { status: 201 })` — unchanged.)

- [ ] **Step 5: Run — expect PASS**; `npm run typecheck` clean. Commit:

```bash
git add lib/db/highlights.ts app/api/highlights/route.ts test/api/highlights-route.test.ts
git commit -m "feat(highlights): embed highlight text on create"
```

---

## Task 3: `searchHighlights`

**Files:** Modify `lib/db/search.ts`; Test `test/db/highlights.test.ts`.

- [ ] **Step 1: Write the failing test** — append to `test/db/highlights.test.ts`. It seeds highlights with distinguishable unit vectors and searches. (The file already imports `schema`, `db`, `items`, `repo`; add the `searchHighlights` import at the top.)

```ts
import { searchHighlights } from "@/lib/db/search"

function unit(i: number): number[] {
  const v = Array(1536).fill(0)
  v[i] = 1
  return v
}

test("searchHighlights ranks by similarity, filters weak + by item", async () => {
  const a = await items.create({ type: "podcast", title: "A", audioUrl: "https://a/a.mp3" })
  const b = await items.create({ type: "podcast", title: "B", audioUrl: "https://a/b.mp3" })
  await repo.create({ itemId: a.id, kind: "transcript", text: "alpha", locator: { sec: 12 }, embedding: unit(0) })
  await repo.create({ itemId: b.id, kind: "transcript", text: "beta", embedding: unit(1) })
  // Query aligned with `alpha` (unit 0): alpha similarity 1, beta 0 (dropped by minSimilarity).
  const hits = await searchHighlights(db, unit(0), {})
  expect(hits.map((h) => h.text)).toEqual(["alpha"])
  expect(hits[0].startSec).toBe(12)
  // itemId filter returns only that item's (b has unit 1; query unit 1).
  const onlyB = await searchHighlights(db, unit(1), { itemId: b.id })
  expect(onlyB.map((h) => h.text)).toEqual(["beta"])
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Add `searchHighlights` + `HighlightHit`** to `lib/db/search.ts`. Update the imports at the top to include what's needed and the `highlights` table:

```ts
import { and, cosineDistance, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { chunks, highlights, items, transcripts } from "./schema"
import * as schema from "./schema"
```

(Add `cosineDistance`/`isNotNull` if missing, and `highlights` to the table import. Keep existing imports like `eq`, `sql`, `desc`.)

Add at the end of the file:

```ts
export interface HighlightHit {
  highlightId: string
  itemId: string
  itemTitle: string
  podcastName: string | null
  artworkUrl: string | null
  audioUrl: string | null
  videoId: string | null
  text: string
  startSec: number
  similarity: number
}

export async function searchHighlights(
  db: PostgresJsDatabase<typeof schema>,
  queryEmbedding: number[],
  opts: { limit?: number; minSimilarity?: number; itemId?: string } = {},
): Promise<HighlightHit[]> {
  const similarity = sql<number>`(1 - (${cosineDistance(highlights.embedding, queryEmbedding)}))::float8`
  const conds = [isNotNull(highlights.embedding)]
  if (opts.itemId) conds.push(eq(highlights.itemId, opts.itemId))
  const rows = await db
    .select({
      highlightId: highlights.id,
      itemId: items.id,
      itemTitle: items.title,
      podcastName: items.podcastName,
      artworkUrl: items.artworkUrl,
      audioUrl: items.audioUrl,
      videoId: sql<string | null>`${items.sourceMetadata}->>'videoId'`,
      text: highlights.text,
      locator: highlights.locator,
      similarity,
    })
    .from(highlights)
    .innerJoin(items, eq(highlights.itemId, items.id))
    .where(and(...conds))
    .orderBy(desc(similarity))
    .limit(opts.limit ?? 3)
  const min = opts.minSimilarity ?? 0.35
  return rows
    .filter((r) => r.similarity >= min)
    .map((r) => ({
      highlightId: r.highlightId,
      itemId: r.itemId,
      itemTitle: r.itemTitle,
      podcastName: r.podcastName,
      artworkUrl: r.artworkUrl,
      audioUrl: r.audioUrl,
      videoId: r.videoId,
      text: r.text,
      startSec: r.locator?.sec && r.locator.sec > 0 ? Math.floor(r.locator.sec) : 0,
      similarity: r.similarity,
    }))
}
```

(If `inArray` was already imported and is now unused after editing the import line, leave the existing usages intact — only add `cosineDistance`/`isNotNull`/`highlights` if they weren't present.)

- [ ] **Step 4: Run — expect PASS** (`npm test -- test/db/highlights.test.ts`); `npm run typecheck` clean. Commit:

```bash
git add lib/db/search.ts test/db/highlights.test.ts
git commit -m "feat(search): searchHighlights (semantic highlight retrieval)"
```

---

## Task 4: `assembleAskSources` helper (pure, TDD)

**Files:** Create `lib/ai/ask-sources.ts`, `test/ai/ask-sources.test.ts`.

- [ ] **Step 1: Write `test/ai/ask-sources.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { assembleAskSources } from "@/lib/ai/ask-sources"
import type { SearchHit } from "@/lib/db/search"
import type { HighlightHit } from "@/lib/db/search"

const chunk = (over: Partial<SearchHit>): SearchHit => ({
  chunkId: "c", itemId: "i", itemTitle: "Ep", podcastName: null, artworkUrl: null,
  audioUrl: null, videoId: null, content: "body", startSec: 0, endSec: 0, similarity: 1, ...over,
})
const hl = (over: Partial<HighlightHit>): HighlightHit => ({
  highlightId: "h", itemId: "i", itemTitle: "Ep", podcastName: null, artworkUrl: null,
  audioUrl: null, videoId: null, text: "snippet", startSec: 0, similarity: 1, ...over,
})

describe("assembleAskSources", () => {
  it("numbers chunk sources first, then highlights; flags entries", () => {
    const { entries, context } = assembleAskSources(
      [chunk({ chunkId: "c1", itemId: "a", itemTitle: "A", startSec: 10, content: "alpha" })],
      [hl({ highlightId: "h1", itemId: "b", itemTitle: "B", text: "gamma" })],
    )
    expect(entries.map((e) => [e.kind, e.n])).toEqual([
      ["chunk", 1],
      ["highlight", 2],
    ])
    expect(context).toContain("[1] (A — 0:10) alpha")
    expect(context).toContain("[2] (Highlight — B) gamma")
  })
  it("keeps every chunk excerpt but dedupes sources by item+second", () => {
    const { entries, context } = assembleAskSources(
      [
        chunk({ chunkId: "c1", itemId: "a", startSec: 0, content: "one" }),
        chunk({ chunkId: "c2", itemId: "a", startSec: 0, content: "two" }),
      ],
      [],
    )
    expect(entries).toHaveLength(1) // one grouped source
    expect(context).toContain("[1] (Ep — 0:00) one")
    expect(context).toContain("[1] (Ep — 0:00) two") // both excerpts share number 1
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `lib/ai/ask-sources.ts`**

```ts
import { formatTimestamp } from "@/lib/format"
import { groupHitsIntoSources } from "@/lib/ai/group-sources"
import type { HighlightHit, SearchHit } from "@/lib/db/search"

export type AskSourceEntry =
  | { kind: "chunk"; n: number; hit: SearchHit }
  | { kind: "highlight"; n: number; hit: HighlightHit }

/** Merge chunk hits (deduped by item+moment) and highlight hits into one numbered
 *  source list + the LLM context string. Chunk excerpts keep all their text but
 *  share their group's number; highlights are numbered after the last chunk group
 *  and labeled so the model knows their provenance. */
export function assembleAskSources(
  chunkHits: SearchHit[],
  highlightHits: HighlightHit[],
): { entries: AskSourceEntry[]; context: string } {
  const { sources: chunkSources, numberFor } = groupHitsIntoSources(chunkHits)
  const base = chunkSources.length

  const chunkCtx = chunkHits.map(
    (h) => `[${numberFor(h)}] (${h.itemTitle} — ${formatTimestamp(h.startSec)}) ${h.content}`,
  )
  const hlCtx = highlightHits.map(
    (h, i) => `[${base + 1 + i}] (Highlight — ${h.itemTitle}) ${h.text}`,
  )
  const context = [...chunkCtx, ...hlCtx].join("\n\n")

  const entries: AskSourceEntry[] = [
    ...chunkSources.map((hit, i) => ({ kind: "chunk" as const, n: i + 1, hit })),
    ...highlightHits.map((hit, i) => ({ kind: "highlight" as const, n: base + 1 + i, hit })),
  ]
  return { entries, context }
}
```

- [ ] **Step 4: Run — expect PASS.** Commit:

```bash
git add lib/ai/ask-sources.ts test/ai/ask-sources.test.ts
git commit -m "feat(ask): assembleAskSources — unified chunk + highlight sources"
```

---

## Task 5: Wire the conversation `/ask` (chat route) + chat UI

**Files:** Modify `lib/db/schema.ts` (ChatSource fields), `app/api/chat/route.ts`, `components/chat-message.tsx`.

- [ ] **Step 1: Extend `ChatSource`** in `lib/db/schema.ts`:

```ts
export type ChatSource = {
  itemId: string
  itemTitle: string
  startSec: number
  podcastName?: string | null
  artworkUrl?: string | null
  audioUrl?: string | null
  videoId?: string | null
  isHighlight?: boolean
  snippet?: string | null
}
```

- [ ] **Step 2: Wire the chat route.** In `app/api/chat/route.ts`, add imports:

```ts
import { hybridSearch, refineHitTimestamps, searchChunks, searchHighlights } from "@/lib/db/search"
import { assembleAskSources, type AskSourceEntry } from "@/lib/ai/ask-sources"
```

(Merge with the existing `@/lib/db/search` import line — add `searchHighlights`; keep `searchChunks`/`hybridSearch`/`refineHitTimestamps`.)

Add a mapper near the top of the file (module scope):

```ts
function entryToChatSource(e: AskSourceEntry): ChatSource {
  const h = e.hit
  const base = {
    itemId: h.itemId,
    itemTitle: h.itemTitle,
    startSec: h.startSec,
    podcastName: h.podcastName,
    artworkUrl: h.artworkUrl,
    audioUrl: h.audioUrl,
    videoId: h.videoId,
  }
  return e.kind === "highlight" ? { ...base, isHighlight: true, snippet: h.text } : base
}
```

(`ChatSource` is already imported in this file.)

**Library-wide branch** (the `else` block): replace its body with a unified retrieval:

```ts
  } else {
    const searchQuery = await condenseQuery(priorTurns, content)
    const qe = await embedQuery(searchQuery)
    const [rawHits, hlHits] = await Promise.all([
      hybridSearch(db, qe, searchQuery, { limit: 8 }),
      searchHighlights(db, qe, {}),
    ])
    const chunkHits = await refineHitTimestamps(db, rawHits, searchQuery)
    const assembled = assembleAskSources(chunkHits, hlHits)
    context = assembled.context
    sources = assembled.entries.map(entryToChatSource)
  }
```

**Attached-item branch** (`if (itemId) { ... }`): after the existing `context`/`sources` are built (both the full-transcript and the chunk-search sub-branches), append the item's matching highlights. Add, just before the `if (itemId)` block closes:

```ts
    const hlHits = await searchHighlights(db, await embedQuery(content), { itemId, limit: 3 })
    if (hlHits.length) {
      context += "\n\nHighlights you saved on this item:\n" + hlHits.map((h) => `- ${h.text}`).join("\n")
      sources = [...sources, ...hlHits.map((h) => entryToChatSource({ kind: "highlight", n: 0, hit: h }))]
    }
```

(`embedQuery` is already imported in this file.)

- [ ] **Step 3: Render highlight sources in `components/chat-message.tsx`.** Extend `ChatSourceRef`:

```ts
export type ChatSourceRef = {
  itemId: string
  itemTitle: string
  startSec: number
  podcastName?: string | null
  artworkUrl?: string | null
  audioUrl?: string | null
  videoId?: string | null
  isHighlight?: boolean
  snippet?: string | null
}
```

Split highlight sources out of the cited-chunk grouping. Where `shownSources` and `sourceGroups` are computed, change them so chunks group as before and highlights are collected separately and shown unconditionally:

```ts
  const shownSources = sources
    .map((s, i) => ({ s, n: i + 1 }))
    .filter(({ s }) => !s.isHighlight)
    .filter(({ n }) => citedNums.size === 0 || citedNums.has(n))
  const highlightSources = sources.filter((s) => s.isHighlight)
```

(The `sourceGroups` computation that maps over `shownSources` stays as-is.)

Render the highlight cards after the existing episode-grouped grid (inside the `{shownSources.length > 0 ...}` Sources block — change its guard to also show when there are highlights, and append a highlight list). Replace the Sources-section guard and add the highlight cards:

```tsx
          {(shownSources.length > 0 || highlightSources.length > 0) && (
            <div className="space-y-2">
              <p className="font-sans text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sources
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {/* ...existing sourceGroups.map(...) cards unchanged... */}
              </div>
              {highlightSources.length > 0 && (
                <div className="space-y-2">
                  {highlightSources.map((s, i) => (
                    <button
                      key={`hl-${i}`}
                      type="button"
                      onClick={() => openSource(s)}
                      className="group flex w-full items-start gap-3 rounded-xl border p-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
                    >
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wide text-primary">
                        Highlight
                      </span>
                      <span className="min-w-0 flex-1 font-serif text-sm italic leading-snug">
                        &ldquo;{s.snippet ?? s.itemTitle}&rdquo;
                        <span className="mt-1 block font-sans text-xs not-italic text-muted-foreground">
                          {s.itemTitle}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
```

(Keep the existing `sourceGroups` grid markup inside the `<div className="grid ...">`. Only the outer guard changed and the highlight block was appended. The inline `[n]` chip handler — `sources[n - 1]` — is unchanged and still resolves highlight citations in library-wide answers.)

- [ ] **Step 4: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors (baseline 11).

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts app/api/chat/route.ts components/chat-message.tsx
git commit -m "feat(ask): highlights in conversation /ask (library-wide + attached) with Highlight source cards"
```

---

## Task 6: Wire the search page (`/api/answer`) + search UI

**Files:** Modify `app/api/answer/route.ts`, `components/search-view.tsx`.

- [ ] **Step 1: Wire the answer route.** In `app/api/answer/route.ts`, add imports:

```ts
import { hybridSearch, refineHitTimestamps, searchHighlights } from "@/lib/db/search"
import { assembleAskSources, type AskSourceEntry } from "@/lib/ai/ask-sources"
import { embedQuery } from "@/lib/ai/embeddings"
```

(Merge with existing imports; `embedQuery` may already be imported — keep one.)

Add a mapper (module scope) producing the search-view `Source` shape:

```ts
function entryToSource(e: AskSourceEntry) {
  const h = e.hit
  if (e.kind === "highlight") {
    return {
      chunkId: h.highlightId,
      itemId: h.itemId,
      itemTitle: h.itemTitle,
      podcastName: h.podcastName,
      artworkUrl: h.artworkUrl,
      content: h.text,
      startSec: h.startSec,
      endSec: h.startSec,
      isHighlight: true,
      snippet: h.text,
    }
  }
  return {
    chunkId: h.chunkId,
    itemId: h.itemId,
    itemTitle: h.itemTitle,
    podcastName: h.podcastName,
    artworkUrl: h.artworkUrl,
    content: h.content,
    startSec: h.startSec,
    endSec: h.endSec,
  }
}
```

Replace the retrieval + numbering. The current body computes `rawSources`, `allHits`, `{ sources, numberFor }`, `numbered`. Replace with:

```ts
  const qe = await embedQuery(query)
  const [rawSources, hlHits, entities] = await Promise.all([
    hybridSearch(db, qe, query, { limit: 10 }),
    searchHighlights(db, qe, {}),
    searchEntities(db, query, 5).catch(() => []),
  ])
  if (rawSources.length === 0 && hlHits.length === 0) {
    return Response.json({ answer: null, sources: [], entities })
  }
  const chunkHits = await refineHitTimestamps(db, rawSources, query)
  const { entries, context } = assembleAskSources(chunkHits, hlHits)
  const sources = entries.map(entryToSource)
```

Use `context` as the prompt sources block (replace the old `numbered`):

```ts
    prompt: `Question: ${query}\n\nSources:\n${context}`,
```

(Keep the `generateText` system prompt and `return Response.json({ answer: text, sources, entities })`. Remove the now-unused old `rawSources`-only early return / `numbered` / `numberFor` lines you replaced. The existing top-of-function `searchEntities`/`hybridSearch` calls that you replaced should be removed so they don't run twice.)

- [ ] **Step 2: Render highlight sources in `components/search-view.tsx`.** Extend the `Source` type:

```ts
type Source = {
  chunkId: string
  itemId: string
  itemTitle: string
  podcastName: string | null
  artworkUrl: string | null
  content: string
  startSec: number
  endSec: number
  isHighlight?: boolean
  snippet?: string | null
}
```

Exclude highlights from the episode grouping and render them as distinct badged rows. Where `const groups = groupSources(sources)` is computed, change to split:

```ts
  const highlightSources = sources.filter((s) => s.isHighlight)
  const groups = groupSources(sources.filter((s) => !s.isHighlight))
```

In the Sources `<section>`, after the existing `groups.map(...)` rendering, add a highlight list (use the existing `episodeHref` + `formatTimestamp` imports):

```tsx
                {highlightSources.map((s, i) => (
                  <Link
                    key={`hl-${i}`}
                    href={episodeHref(s.itemId, s.startSec)}
                    className="flex items-start gap-2 rounded-lg border p-2.5 transition-colors hover:bg-muted"
                  >
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                      Highlight
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 font-serif text-sm italic">
                        &ldquo;{s.snippet ?? s.content}&rdquo;
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{s.itemTitle}</span>
                    </span>
                  </Link>
                ))}
```

(Place it inside the same container that wraps the `groups.map(...)` output so it sits in the Sources section. The inline `[n]` citation chips resolve via `sources[n - 1]` unchanged.)

- [ ] **Step 3: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors (baseline 11).

- [ ] **Step 4: Commit**

```bash
git add app/api/answer/route.ts components/search-view.tsx
git commit -m "feat(ask): highlights in the search-page answer + Highlight source rows"
```

---

## Task 7: Backfill script + run + final verification

**Files:** Create `scripts/backfill-highlight-embeddings.ts`.

- [ ] **Step 1: Create `scripts/backfill-highlight-embeddings.ts`** (mirrors `lib/db/migrate.ts`'s dotenv + postgres-js style)

```ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { eq, isNull } from "drizzle-orm"
import postgres from "postgres"
import * as schema from "@/lib/db/schema"
import { embedTexts } from "@/lib/ai/embeddings"

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  const client = postgres(url, { max: 1 })
  const db = drizzle(client, { schema })

  const rows = await db
    .select({ id: schema.highlights.id, text: schema.highlights.text })
    .from(schema.highlights)
    .where(isNull(schema.highlights.embedding))

  console.log(`backfilling ${rows.length} highlight(s)`)
  const BATCH = 50
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const vectors = await embedTexts(batch.map((r) => r.text))
    for (let j = 0; j < batch.length; j++) {
      await db
        .update(schema.highlights)
        .set({ embedding: vectors[j] })
        .where(eq(schema.highlights.id, batch[j].id))
    }
    console.log(`  embedded ${Math.min(i + BATCH, rows.length)}/${rows.length}`)
  }

  await client.end()
  console.log("backfill complete")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Resolve the `@/` alias for tsx.** The path alias works in Next/Vitest; for the standalone `tsx` run, `lib/db/migrate.ts` uses relative imports. To be safe, change the two `@/` imports in the script to relative paths (`../lib/db/schema`, `../lib/ai/embeddings`) if running `npx tsx` fails to resolve `@/`. (Verify by running Step 3; if it errors on `@/`, switch to relative.)

- [ ] **Step 3: Run the backfill** against the app DB (the migration from Task 1 must already be applied — it is, via `npm run db:migrate`):

Run: `npx tsx scripts/backfill-highlight-embeddings.ts`
Expected: `backfilling N highlight(s)` … `backfill complete`, no error.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-highlight-embeddings.ts
git commit -m "chore(highlights): backfill script for existing highlight embeddings"
```

- [ ] **Step 5: Final verification.** `npm run typecheck` (clean); `npm test` (all pass — run ONCE; concurrent vitest runs corrupt the shared test DB); `npm run build` (succeeds); `npm run lint` (no new errors vs the pre-existing 11).

---

## Self-Review (plan author)

- **Spec coverage:** embedding column + migration (Task 1); embed-on-create + repo support (Task 2); `searchHighlights` (Task 3); `assembleAskSources` (Task 4); chat route library-wide + attached + UI (Task 5); answer route + search UI (Task 6); backfill script + run (Task 7). Distinct "Highlight" sources rendered in both UIs ✅; semantic retrieval ✅; error handling (NULL-embedding skip in `searchHighlights`, try/catch embed-on-create) ✅.
- **Placeholder scan:** none — full code per step. The one conditional note (Task 7 Step 2 `@/` vs relative for `tsx`) is a concrete fallback, not a placeholder; the `searchHighlights` import-merge note points at existing imports reproduced for reference.
- **Type consistency:** `HighlightHit` (Task 3) consumed by `assembleAskSources` (Task 4) and both route mappers (Tasks 5–6); `AskSourceEntry` discriminated union with `n`/`hit` used identically in `entryToChatSource`/`entryToSource`; `ChatSource`/`ChatSourceRef`/`Source` all gain `isHighlight?`/`snippet?` consistently; `searchHighlights(db, queryEmbedding, { limit?, minSimilarity?, itemId? })` signature identical across call sites; `groupHitsIntoSources` reused unchanged.
