# Canonical Entities with Verified Enrichment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat `{ name, type }` entity mentions with a canonical, deduplicated `entities` table enriched from Wikipedia / Google Books / iTunes (LLM-verified), surfaced via entity pages, a richer Mentioned section, search results, and Ask (RAG).

**Architecture:** A resolver runs after insights in the transcript pipeline: it matches extracted entities to existing rows by normalized name + type, enriches *new* entities by fetching top candidates from external APIs and having `gpt-5.4-mini` pick or reject, then links episodes via `episode_entities` and writes per-mention "entity chunks" into the existing `chunks` table so Ask retrieves them. UI reads only from the new tables; `insights.entities` JSONB keeps being written as raw extraction output.

**Tech Stack:** Next.js 16 App Router, Drizzle + Postgres/pgvector, Vercel AI SDK (`generateObject`, `embedMany`), shadcn/radix (`radix-ui` unified package), vitest (db tests against `TEST_DATABASE_URL`, sequential files).

**Spec:** `docs/superpowers/specs/2026-06-10-entity-enrichment-design.md`

**Conventions used throughout:**
- DB tests follow the existing pattern (`test/db/search.test.ts`): dotenv `.env.local`, `postgres(process.env.TEST_DATABASE_URL!, { max: 1 })`, `migrate()` in `beforeAll`, `db.delete(schema.episodes)` in `beforeEach`, `client.end()` in `afterAll`.
- LLM tests use `MockLanguageModelV3` from `ai/test` (see `test/ai/insights.test.ts` for the exact `doGenerate` result shape — copy it verbatim when mocking).
- Run a single test file with `npx vitest run test/path/file.test.ts`.
- Commit after every task.

---

### Task 1: Schema — `entities`, `episode_entities`, `chunks.entity_id`

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/db/migrations/0003_*.sql` (generated)
- Test: `test/db/entities.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/db/entities.test.ts`:

```ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeEpisodeRepo } from "@/lib/db/episodes"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const repo = makeEpisodeRepo(db)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
beforeEach(async () => {
  await db.delete(schema.episodes)
  await db.delete(schema.entities)
})
afterAll(async () => {
  await client.end()
})

test("entities + episode_entities round-trip, and chunks accept an entityId", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })

  const [entity] = await db
    .insert(schema.entities)
    .values({
      name: "Steve Jobs",
      slug: "steve-jobs",
      type: "person",
      description: "Co-founder of Apple",
      enrichmentStatus: "enriched",
    })
    .returning()
  expect(entity.slug).toBe("steve-jobs")

  await db.insert(schema.episodeEntities).values({
    episodeId: ep.id,
    entityId: entity.id,
    context: "discussed re: product design",
    approxTimestampSec: 120,
  })
  const links = await db
    .select()
    .from(schema.episodeEntities)
    .where(eq(schema.episodeEntities.entityId, entity.id))
  expect(links).toHaveLength(1)
  expect(links[0].context).toBe("discussed re: product design")

  await db.insert(schema.chunks).values({
    episodeId: ep.id,
    entityId: entity.id,
    content: "Steve Jobs (person): Co-founder of Apple",
    startSec: 120,
    endSec: 120,
    embedding: Array(1536).fill(0.1),
  })
  const [chunk] = await db
    .select()
    .from(schema.chunks)
    .where(eq(schema.chunks.entityId, entity.id))
  expect(chunk.content).toContain("Steve Jobs")

  // Cascade: deleting the entity removes links and entity chunks.
  await db.delete(schema.entities).where(eq(schema.entities.id, entity.id))
  const after = await db
    .select()
    .from(schema.episodeEntities)
    .where(eq(schema.episodeEntities.entityId, entity.id))
  expect(after).toHaveLength(0)
}, 30_000)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/db/entities.test.ts`
Expected: FAIL — `schema.entities` does not exist (TypeScript/property error).

- [ ] **Step 3: Add the tables to `lib/db/schema.ts`**

Add `primaryKey` to the `drizzle-orm/pg-core` import, then add **above** the `chunks` table (it references `entities`):

```ts
export type EntityType = "person" | "company" | "book" | "product" | "place" | "other"
export type EnrichmentStatus = "pending" | "enriched" | "unmatched" | "failed"

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    type: text("type").$type<EntityType>().notNull(),
    description: text("description"),
    summary: text("summary"),
    imageUrl: text("image_url"),
    wikipediaUrl: text("wikipedia_url"),
    wikidataId: text("wikidata_id"),
    externalIds: jsonb("external_ids").$type<{
      itunesId?: number
      isbn?: string
      googleBooksId?: string
    }>(),
    metadata: jsonb("metadata").$type<{ author?: string; publishedYear?: number }>(),
    enrichmentStatus: text("enrichment_status")
      .$type<EnrichmentStatus>()
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("entities_name_idx").on(t.name)],
)

export const episodeEntities = pgTable(
  "episode_entities",
  {
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    context: text("context"),
    approxTimestampSec: integer("approx_timestamp_sec"),
  },
  (t) => [
    primaryKey({ columns: [t.episodeId, t.entityId] }),
    index("episode_entities_entity_idx").on(t.entityId),
  ],
)
```

In the `chunks` table, add after `episodeId`:

```ts
    // Entity-derived chunks (one per episode_entities link) carry the entity id;
    // transcript chunks leave it null.
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "cascade" }),
```

Also widen the raw extraction type on `insights` (Task 2 adds the fields):

```ts
  entities: jsonb("entities").$type<
    { name: string; type: string; context?: string; approxTimestampSec?: number }[]
  >(),
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new `lib/db/migrations/0003_*.sql` containing `CREATE TABLE "entities"`, `CREATE TABLE "episode_entities"`, and `ALTER TABLE "chunks" ADD COLUMN "entity_id"`. Inspect it before proceeding.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/db/entities.test.ts`
Expected: PASS (the test's `migrate()` applies 0003 to the test DB).

- [ ] **Step 6: Apply to the dev database and commit**

```bash
npm run db:migrate
git add lib/db/schema.ts lib/db/migrations test/db/entities.test.ts
git commit -m "feat: add entities, episode_entities tables and chunks.entity_id"
```

---

### Task 2: Extraction — per-entity `context` and `approxTimestampSec`

**Files:**
- Modify: `lib/ai/insights.ts`
- Test: `test/ai/insights.test.ts`

- [ ] **Step 1: Update the existing test to expect the new fields**

In `test/ai/insights.test.ts`, change the `entities` line of the mock `value` to:

```ts
    entities: [
      {
        name: "Jane",
        type: "person",
        context: "guest, talked about compilers",
        approxTimestampSec: 30,
      },
    ],
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ai/insights.test.ts`
Expected: FAIL — Zod strips/rejects the unknown `context` key, so `insightsSchema.parse(out)` no longer equals `value`.

- [ ] **Step 3: Update schema and prompt in `lib/ai/insights.ts`**

Replace the `entities` entry in `insightsSchema` with:

```ts
  entities: z
    .array(
      z.object({
        name: z.string(),
        // Categorize so the UI can group: people, companies, books, etc.
        type: z.enum(["person", "company", "book", "product", "place", "other"]),
        context: z
          .string()
          .describe("short phrase: how/why it was mentioned, e.g. 'author of Sapiens, discussed re: AI'"),
        approxTimestampSec: z
          .number()
          .describe("approximate second of the first/main mention, from the nearest [m:ss] marker"),
      }),
    )
    .describe("people, companies, books, products, and places mentioned"),
```

Replace the entities prompt line with:

```ts
      "- entities: notable people, companies, books, products, and places mentioned, each typed, " +
      "with a short context phrase describing how it came up and the approxTimestampSec of its " +
      "first/main mention taken from the nearest preceding [m:ss] marker.\n\n" +
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/ai/insights.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ai/insights.ts test/ai/insights.test.ts
git commit -m "feat: extract per-entity context and timestamp in insights"
```

---

### Task 3: External candidate sources (Wikipedia, Google Books, iTunes)

**Files:**
- Create: `lib/entities/sources.ts`
- Test: `test/entities/sources.test.ts`

All endpoints are keyless. Wikipedia requires a descriptive `User-Agent`. Per-source failures degrade to `[]` — enrichment must never throw because an API is down.

- [ ] **Step 1: Write the failing tests**

Create `test/entities/sources.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest"
import { searchCandidates } from "@/lib/entities/sources"

afterEach(() => vi.restoreAllMocks())

const wikiSearchBody = {
  pages: [
    {
      id: 1,
      key: "Steve_Jobs",
      title: "Steve Jobs",
      description: "American businessman (1955–2011)",
      thumbnail: { url: "//upload.wikimedia.org/jobs.jpg" },
    },
  ],
}
const wikiSummaryBody = {
  title: "Steve Jobs",
  description: "American businessman (1955–2011)",
  extract: "Steven Paul Jobs was an American businessman...",
  thumbnail: { source: "https://upload.wikimedia.org/jobs.jpg" },
  content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Steve_Jobs" } },
  wikibase_item: "Q19837",
}

test("person → Wikipedia search + summary candidates", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/v1/search/title")) return new Response(JSON.stringify(wikiSearchBody))
    if (url.includes("/page/summary/")) return new Response(JSON.stringify(wikiSummaryBody))
    throw new Error(`unexpected url ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)

  const out = await searchCandidates("Steve Jobs", "person")
  expect(out).toHaveLength(1)
  expect(out[0]).toMatchObject({
    source: "wikipedia",
    title: "Steve Jobs",
    description: "American businessman (1955–2011)",
    url: "https://en.wikipedia.org/wiki/Steve_Jobs",
    wikidataId: "Q19837",
    imageUrl: "https://upload.wikimedia.org/jobs.jpg",
  })
  // Wikipedia policy: identify the client.
  const init = fetchMock.mock.calls[0][1] as RequestInit | undefined
  expect((init?.headers as Record<string, string>)["User-Agent"]).toContain("flux")
})

test("book → Google Books candidates with ISBN and author", async () => {
  const body = {
    items: [
      {
        id: "abc123",
        volumeInfo: {
          title: "Sapiens",
          authors: ["Yuval Noah Harari"],
          publishedDate: "2011-06-04",
          description: "A brief history of humankind.",
          imageLinks: { thumbnail: "http://books.google.com/sapiens.jpg" },
          industryIdentifiers: [{ type: "ISBN_13", identifier: "9780062316097" }],
          canonicalVolumeLink: "https://books.google.com/books?id=abc123",
        },
      },
    ],
  }
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body))))

  const out = await searchCandidates("Sapiens", "book")
  expect(out[0]).toMatchObject({
    source: "googleBooks",
    title: "Sapiens",
    externalIds: { isbn: "9780062316097", googleBooksId: "abc123" },
    metadata: { author: "Yuval Noah Harari", publishedYear: 2011 },
  })
})

test("source failure degrades to empty array, not a throw", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })))
  await expect(searchCandidates("Anything", "person")).resolves.toEqual([])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/entities/sources.test.ts`
Expected: FAIL — cannot resolve `@/lib/entities/sources`.

- [ ] **Step 3: Implement `lib/entities/sources.ts`**

```ts
import type { EntityType } from "@/lib/db/schema"

export interface Candidate {
  source: "wikipedia" | "googleBooks" | "itunes"
  title: string
  description?: string
  summary?: string
  imageUrl?: string
  url?: string
  wikidataId?: string
  externalIds?: { itunesId?: number; isbn?: string; googleBooksId?: string }
  metadata?: { author?: string; publishedYear?: number }
}

// Wikimedia asks API clients to identify themselves.
const HEADERS = { "User-Agent": "flux-podcast-kb/0.1 (hey@jeremys.be)" }

// Light in-memory TTL cache (same pattern as lib/itunes/client.ts). Entity
// lookups repeat across episodes within a process lifetime.
const cache = new Map<string, { at: number; data: unknown }>()
const TTL_MS = 60 * 60_000

async function getJson(url: string): Promise<any> {
  const hit = cache.get(url)
  const now = Date.now()
  if (hit && now - hit.at < TTL_MS) return hit.data
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`entity source request failed: ${res.status} ${url}`)
  const data = await res.json()
  cache.set(url, { at: now, data })
  return data
}

async function wikipediaCandidates(name: string): Promise<Candidate[]> {
  const search = await getJson(
    `https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(name)}&limit=3`,
  )
  const pages: { key: string }[] = search.pages ?? []
  const out: Candidate[] = []
  for (const page of pages) {
    const s = await getJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.key)}`,
    )
    out.push({
      source: "wikipedia",
      title: s.title,
      description: s.description ?? undefined,
      summary: s.extract ?? undefined,
      imageUrl: s.thumbnail?.source ?? undefined,
      url: s.content_urls?.desktop?.page ?? undefined,
      wikidataId: s.wikibase_item ?? undefined,
    })
  }
  return out
}

async function googleBooksCandidates(name: string): Promise<Candidate[]> {
  const data = await getJson(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(name)}&maxResults=3&printType=books`,
  )
  const items: any[] = data.items ?? []
  return items.map((item) => {
    const v = item.volumeInfo ?? {}
    const isbn = (v.industryIdentifiers ?? []).find(
      (i: { type: string }) => i.type === "ISBN_13" || i.type === "ISBN_10",
    )?.identifier
    const year = v.publishedDate ? Number(String(v.publishedDate).slice(0, 4)) : undefined
    return {
      source: "googleBooks" as const,
      title: v.title ?? name,
      description: v.authors?.length ? `Book by ${v.authors.join(", ")}` : "Book",
      summary: v.description ?? undefined,
      imageUrl: v.imageLinks?.thumbnail?.replace(/^http:/, "https:") ?? undefined,
      url: v.canonicalVolumeLink ?? v.infoLink ?? undefined,
      externalIds: { isbn, googleBooksId: item.id },
      metadata: {
        author: v.authors?.[0],
        publishedYear: Number.isFinite(year) ? year : undefined,
      },
    }
  })
}

async function itunesProductCandidates(name: string): Promise<Candidate[]> {
  const data = await getJson(
    `https://itunes.apple.com/search?media=software&limit=2&term=${encodeURIComponent(name)}`,
  )
  const results: any[] = data.results ?? []
  return results.map((r) => ({
    source: "itunes" as const,
    title: r.trackName ?? name,
    description: r.sellerName ? `App by ${r.sellerName}` : "App",
    summary: typeof r.description === "string" ? r.description.slice(0, 400) : undefined,
    imageUrl: r.artworkUrl100 ?? undefined,
    url: r.trackViewUrl ?? undefined,
    externalIds: { itunesId: r.trackId },
  }))
}

const safe = (p: Promise<Candidate[]>) => p.catch(() => [] as Candidate[])

// Top external candidates for an extracted entity, routed by type. Per-source
// failures degrade to [] so enrichment never blocks the pipeline.
export async function searchCandidates(name: string, type: EntityType): Promise<Candidate[]> {
  if (type === "book") return safe(googleBooksCandidates(name))
  if (type === "product") {
    const [wiki, itunes] = await Promise.all([
      safe(wikipediaCandidates(name)),
      safe(itunesProductCandidates(name)),
    ])
    return [...wiki, ...itunes]
  }
  return safe(wikipediaCandidates(name))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/entities/sources.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/entities/sources.ts test/entities/sources.test.ts
git commit -m "feat: Wikipedia/Google Books/iTunes candidate sources for entities"
```

---

### Task 4: LLM match verifier

**Files:**
- Create: `lib/entities/verify.ts`
- Test: `test/entities/verify.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/entities/verify.test.ts` (the `doGenerate` result shape is copied from `test/ai/insights.test.ts` — keep it identical apart from the text):

```ts
import { expect, test } from "vitest"
import { MockLanguageModelV3 } from "ai/test"
import { verifyCandidate } from "@/lib/entities/verify"
import type { Candidate } from "@/lib/entities/sources"

const candidates: Candidate[] = [
  { source: "wikipedia", title: "Mercury (planet)", description: "planet" },
  { source: "wikipedia", title: "Mercury (element)", description: "chemical element" },
]

function modelReturning(value: unknown) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: {
          total: 1,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 1, text: undefined, reasoning: undefined },
      },
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      warnings: [],
    }),
  })
}

test("returns the model's chosen candidate index", async () => {
  const idx = await verifyCandidate(
    { name: "Mercury", type: "other", context: "discussed planetary orbits" },
    candidates,
    { model: modelReturning({ candidateIndex: 0 }) },
  )
  expect(idx).toBe(0)
})

test("returns -1 when the model rejects all candidates", async () => {
  const idx = await verifyCandidate(
    { name: "Mercury", type: "other" },
    candidates,
    { model: modelReturning({ candidateIndex: -1 }) },
  )
  expect(idx).toBe(-1)
})

test("clamps an out-of-range index to -1 and short-circuits on empty candidates", async () => {
  const idx = await verifyCandidate(
    { name: "Mercury", type: "other" },
    candidates,
    { model: modelReturning({ candidateIndex: 7 }) },
  )
  expect(idx).toBe(-1)
  // Empty candidates never call the model.
  expect(await verifyCandidate({ name: "X", type: "other" }, [])).toBe(-1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/entities/verify.test.ts`
Expected: FAIL — cannot resolve `@/lib/entities/verify`.

- [ ] **Step 3: Implement `lib/entities/verify.ts`**

```ts
import { openai } from "@ai-sdk/openai"
import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"
import type { Candidate } from "@/lib/entities/sources"
import type { EntityType } from "@/lib/db/schema"

const verdictSchema = z.object({
  candidateIndex: z
    .number()
    .describe("0-based index of the candidate that is the same real-world thing, or -1 if none clearly match"),
})

export interface MentionToVerify {
  name: string
  type: EntityType | string
  context?: string
}

// One cheap structured call per *new* entity: given the mention (with its
// transcript context) and external candidates, pick the right one or reject
// all. Precision over recall — a wrong match on an entity page is worse than
// an unenriched entity.
export async function verifyCandidate(
  mention: MentionToVerify,
  candidates: Candidate[],
  opts: { model?: LanguageModel; episodeTitle?: string } = {},
): Promise<number> {
  if (candidates.length === 0) return -1

  const list = candidates
    .map(
      (c, i) =>
        `${i}. [${c.source}] ${c.title}${c.description ? ` — ${c.description}` : ""}` +
        (c.summary ? `\n   ${c.summary.slice(0, 300)}` : ""),
    )
    .join("\n")

  const { object } = await generateObject({
    model: opts.model ?? openai("gpt-5.4-mini-2026-03-17"),
    schema: verdictSchema,
    prompt:
      "You match podcast mentions to knowledge-base records.\n\n" +
      `Mention: "${mention.name}" (type: ${mention.type})\n` +
      (mention.context ? `How it came up: ${mention.context}\n` : "") +
      (opts.episodeTitle ? `Episode: ${opts.episodeTitle}\n` : "") +
      `\nCandidates:\n${list}\n\n` +
      "Return the candidateIndex of the record that refers to the same real-world thing as the " +
      "mention, or -1 if none clearly do. Prefer -1 over guessing.",
  })

  const idx = Math.trunc(object.candidateIndex)
  return idx >= 0 && idx < candidates.length ? idx : -1
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/entities/verify.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/entities/verify.ts test/entities/verify.test.ts
git commit -m "feat: LLM verifier picks or rejects entity candidates"
```

---

### Task 5: Resolver — match, enrich, link, write entity chunks

**Files:**
- Create: `lib/entities/resolve.ts`
- Test: `test/entities/resolve.test.ts`

The resolver is the heart of the feature. Per extracted entity: find existing by normalized name + type (no API/LLM cost) → otherwise enrich via candidates + verifier → insert entity → link via `episode_entities` → queue an entity chunk; chunks are embedded in one batch at the end. Per-entity errors create a `failed` entity (still linked) and never propagate.

- [ ] **Step 1: Write the failing tests**

Create `test/entities/resolve.test.ts`:

```ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeEpisodeRepo } from "@/lib/db/episodes"
import { resolveEpisodeEntities } from "@/lib/entities/resolve"
import type { Candidate } from "@/lib/entities/sources"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const repo = makeEpisodeRepo(db)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
beforeEach(async () => {
  await db.delete(schema.episodes)
  await db.delete(schema.entities)
})
afterAll(async () => {
  await client.end()
})

const jobsCandidate: Candidate = {
  source: "wikipedia",
  title: "Steve Jobs",
  description: "American businessman (1955–2011)",
  summary: "Steven Paul Jobs was...",
  imageUrl: "https://upload.wikimedia.org/jobs.jpg",
  url: "https://en.wikipedia.org/wiki/Steve_Jobs",
  wikidataId: "Q19837",
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    db,
    searchCandidates: vi.fn(async () => [jobsCandidate]),
    verifyCandidate: vi.fn(async () => 0),
    embedTexts: vi.fn(async (texts: string[]) => texts.map(() => Array(1536).fill(0.1))),
    ...overrides,
  }
}

test("new entity is enriched, linked, and gets an entity chunk", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  const d = deps()

  await resolveEpisodeEntities(
    ep.id,
    [{ name: "Steve Jobs", type: "person", context: "discussed re: design", approxTimestampSec: 90 }],
    d,
  )

  const [entity] = await db.select().from(schema.entities)
  expect(entity).toMatchObject({
    name: "Steve Jobs",
    slug: "steve-jobs",
    type: "person",
    description: "American businessman (1955–2011)",
    wikidataId: "Q19837",
    enrichmentStatus: "enriched",
  })

  const [link] = await db.select().from(schema.episodeEntities)
  expect(link).toMatchObject({
    episodeId: ep.id,
    entityId: entity.id,
    context: "discussed re: design",
    approxTimestampSec: 90,
  })

  const [chunk] = await db
    .select()
    .from(schema.chunks)
    .where(eq(schema.chunks.entityId, entity.id))
  expect(chunk.content).toContain("Steve Jobs (person)")
  expect(chunk.content).toContain("discussed re: design")
  expect(chunk.startSec).toBe(90)
}, 30_000)

test("existing entity is reused: no candidate search, no verify, just a link", async () => {
  const ep1 = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  const ep2 = await repo.create({ title: "E2", audioUrl: "https://a/2.mp3" })
  const d1 = deps()
  await resolveEpisodeEntities(ep1.id, [{ name: "Steve Jobs", type: "person" }], d1)

  const d2 = deps()
  // Different casing must still match.
  await resolveEpisodeEntities(ep2.id, [{ name: "steve jobs", type: "person" }], d2)

  expect(d2.searchCandidates).not.toHaveBeenCalled()
  expect(d2.verifyCandidate).not.toHaveBeenCalled()
  expect(await db.select().from(schema.entities)).toHaveLength(1)
  expect(await db.select().from(schema.episodeEntities)).toHaveLength(2)
}, 30_000)

test("verifier rejection stores an unmatched entity that is still linked", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  const d = deps({ verifyCandidate: vi.fn(async () => -1) })

  await resolveEpisodeEntities(ep.id, [{ name: "Obscure Startup", type: "company" }], d)

  const [entity] = await db.select().from(schema.entities)
  expect(entity.enrichmentStatus).toBe("unmatched")
  expect(entity.description).toBeNull()
  expect(await db.select().from(schema.episodeEntities)).toHaveLength(1)
}, 30_000)

test("a throwing source still produces a linked 'failed' entity and other entities proceed", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  const search = vi
    .fn()
    .mockRejectedValueOnce(new Error("boom"))
    .mockResolvedValueOnce([jobsCandidate])
  const d = deps({ searchCandidates: search })

  await resolveEpisodeEntities(
    ep.id,
    [
      { name: "Broken One", type: "company" },
      { name: "Steve Jobs", type: "person" },
    ],
    d,
  )

  const rows = await db.select().from(schema.entities).orderBy(schema.entities.name)
  expect(rows).toHaveLength(2)
  expect(rows.find((r) => r.name === "Broken One")?.enrichmentStatus).toBe("failed")
  expect(rows.find((r) => r.name === "Steve Jobs")?.enrichmentStatus).toBe("enriched")
  expect(await db.select().from(schema.episodeEntities)).toHaveLength(2)
}, 30_000)

test("duplicate mentions in one episode create a single link", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  await resolveEpisodeEntities(
    ep.id,
    [
      { name: "Steve Jobs", type: "person" },
      { name: "Steve Jobs", type: "person" },
    ],
    deps(),
  )
  expect(await db.select().from(schema.entities)).toHaveLength(1)
  expect(await db.select().from(schema.episodeEntities)).toHaveLength(1)
}, 30_000)

test("slug collisions get a numeric suffix", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  await db.insert(schema.entities).values({
    name: "Mercury (planet)",
    slug: "mercury",
    type: "other",
    enrichmentStatus: "unmatched",
  })
  const d = deps({ verifyCandidate: vi.fn(async () => -1) })
  await resolveEpisodeEntities(ep.id, [{ name: "Mercury", type: "company" }], d)

  const rows = await db.select().from(schema.entities)
  expect(rows.map((r) => r.slug).sort()).toEqual(["mercury", "mercury-2"])
}, 30_000)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/entities/resolve.test.ts`
Expected: FAIL — cannot resolve `@/lib/entities/resolve`.

- [ ] **Step 3: Implement `lib/entities/resolve.ts`**

```ts
import { and, eq, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { embedTexts as defaultEmbedTexts } from "@/lib/ai/embeddings"
import * as schema from "@/lib/db/schema"
import { searchCandidates as defaultSearchCandidates, type Candidate } from "@/lib/entities/sources"
import { verifyCandidate as defaultVerifyCandidate } from "@/lib/entities/verify"

type DB = PostgresJsDatabase<typeof schema>

export interface ExtractedEntity {
  name: string
  type: string
  context?: string
  approxTimestampSec?: number
}

export interface ResolveDeps {
  db: DB
  searchCandidates?: typeof defaultSearchCandidates
  verifyCandidate?: typeof defaultVerifyCandidate
  embedTexts?: (texts: string[]) => Promise<number[][]>
}

const ENTITY_TYPES: schema.EntityType[] = ["person", "company", "book", "product", "place", "other"]

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

async function uniqueSlug(db: DB, name: string): Promise<string> {
  const root = slugify(name) || "entity"
  let candidate = root
  for (let n = 2; ; n++) {
    const [hit] = await db
      .select({ id: schema.entities.id })
      .from(schema.entities)
      .where(eq(schema.entities.slug, candidate))
      .limit(1)
    if (!hit) return candidate
    candidate = `${root}-${n}`
  }
}

function entityValues(
  name: string,
  type: schema.EntityType,
  picked: Candidate | null,
): Omit<typeof schema.entities.$inferInsert, "slug"> {
  if (!picked) return { name, type, enrichmentStatus: "unmatched" }
  return {
    name,
    type,
    description: picked.description ?? null,
    summary: picked.summary ?? null,
    imageUrl: picked.imageUrl ?? null,
    wikipediaUrl: picked.source === "wikipedia" ? picked.url ?? null : null,
    wikidataId: picked.wikidataId ?? null,
    externalIds: picked.externalIds ?? null,
    metadata: picked.metadata ?? null,
    enrichmentStatus: "enriched",
  }
}

// The text embedded for Ask: entity identity + this episode's mention context.
function entityChunkText(
  entity: { name: string; type: string; description: string | null },
  context: string | undefined,
): string {
  const base = `${entity.name} (${entity.type}): ${entity.description ?? "mentioned in a podcast episode"}`
  return context ? `${base}. Mentioned in this episode: ${context}` : base
}

// Resolve one episode's extracted entities: reuse existing rows by normalized
// name + type, enrich new ones (candidates + LLM verification), link them via
// episode_entities, and write one entity chunk per link for RAG retrieval.
// Enrichment cost is once per *unique* entity across the library.
export async function resolveEpisodeEntities(
  episodeId: string,
  extracted: ExtractedEntity[],
  deps: ResolveDeps,
  opts: { episodeTitle?: string } = {},
): Promise<void> {
  const { db } = deps
  const search = deps.searchCandidates ?? defaultSearchCandidates
  const verify = deps.verifyCandidate ?? defaultVerifyCandidate
  const embed = deps.embedTexts ?? defaultEmbedTexts

  const chunkQueue: { entityId: string; content: string; startSec: number }[] = []

  for (const mention of extracted) {
    const name = mention.name.trim()
    if (!name) continue
    const type = (ENTITY_TYPES as string[]).includes(mention.type)
      ? (mention.type as schema.EntityType)
      : "other"

    // 1. Reuse an existing canonical entity (no API or LLM cost).
    let [entity] = await db
      .select()
      .from(schema.entities)
      .where(
        and(
          sql`lower(${schema.entities.name}) = ${name.toLowerCase()}`,
          eq(schema.entities.type, type),
        ),
      )
      .limit(1)

    // 2. New entity: enrich, degrading to unmatched/failed instead of throwing.
    if (!entity) {
      let values: Omit<typeof schema.entities.$inferInsert, "slug">
      try {
        const candidates = await search(name, type)
        const idx =
          candidates.length > 0
            ? await verify({ name, type, context: mention.context }, candidates, {
                episodeTitle: opts.episodeTitle,
              })
            : -1
        values = entityValues(name, type, idx >= 0 ? candidates[idx] : null)
      } catch {
        values = { name, type, enrichmentStatus: "failed" }
      }
      ;[entity] = await db
        .insert(schema.entities)
        .values({ ...values, slug: await uniqueSlug(db, name) })
        .returning()
    }

    // 3. Link (duplicate mentions in one episode collapse onto the PK).
    const inserted = await db
      .insert(schema.episodeEntities)
      .values({
        episodeId,
        entityId: entity.id,
        context: mention.context ?? null,
        approxTimestampSec:
          mention.approxTimestampSec != null ? Math.floor(mention.approxTimestampSec) : null,
      })
      .onConflictDoNothing()
      .returning()

    // 4. One entity chunk per link, embedded in a single batch below.
    if (inserted.length > 0) {
      chunkQueue.push({
        entityId: entity.id,
        content: entityChunkText(entity, mention.context),
        startSec: Math.floor(mention.approxTimestampSec ?? 0),
      })
    }
  }

  if (chunkQueue.length > 0) {
    const vectors = await embed(chunkQueue.map((c) => c.content))
    await db.insert(schema.chunks).values(
      chunkQueue.map((c, i) => ({
        episodeId,
        entityId: c.entityId,
        content: c.content,
        startSec: c.startSec,
        endSec: c.startSec,
        embedding: vectors[i],
      })),
    )
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/entities/resolve.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/entities/resolve.ts test/entities/resolve.test.ts
git commit -m "feat: entity resolver — match, enrich, link, embed entity chunks"
```

---

### Task 6: Pipeline integration

**Files:**
- Modify: `lib/pipeline/process-transcript.ts`
- Test: `test/pipeline/process-transcript.test.ts` (append a new test; leave existing tests untouched)

- [ ] **Step 1: Write the failing test**

Append to `test/pipeline/process-transcript.test.ts` (it already has `db`, `repo`, `schema` set up at the top):

```ts
test("processTranscript resolves entities after insights, and a resolver failure does not fail the episode", async () => {
  const ep = await repo.create({ title: "Entity EP", audioUrl: "https://a/ent.mp3" })
  const insightsValue = {
    summary: "s",
    takeaways: [],
    topics: [],
    chapters: [],
    quotes: [],
    entities: [
      { name: "Steve Jobs", type: "person", context: "design talk", approxTimestampSec: 10 },
    ],
  }
  const resolveEntities = vi.fn(async () => {})

  await processTranscript(
    { episodeId: ep.id, transcript: "hello world", segments: [{ start: 0, end: 5, text: "hello world" }] },
    {
      db,
      generateInsights: async () => insightsValue,
      embedTexts: async (texts: string[]) => texts.map(() => Array(1536).fill(0.1)),
      resolveEntities,
    },
  )

  expect(resolveEntities).toHaveBeenCalledWith(
    ep.id,
    insightsValue.entities,
    expect.objectContaining({ episodeTitle: "Entity EP" }),
  )
  expect((await repo.getById(ep.id))?.status).toBe("ready")

  // A resolver crash is logged, not fatal: episode still reaches "ready".
  const ep2 = await repo.create({ title: "Entity EP 2", audioUrl: "https://a/ent2.mp3" })
  await processTranscript(
    { episodeId: ep2.id, transcript: "hi", segments: [{ start: 0, end: 2, text: "hi" }] },
    {
      db,
      generateInsights: async () => insightsValue,
      embedTexts: async (texts: string[]) => texts.map(() => Array(1536).fill(0.1)),
      resolveEntities: async () => {
        throw new Error("resolver down")
      },
    },
  )
  expect((await repo.getById(ep2.id))?.status).toBe("ready")
}, 60_000)
```

Add `vi` to the vitest import at the top of the file if it isn't already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/pipeline/process-transcript.test.ts`
Expected: FAIL — `resolveEntities` is not a known property of `PipelineDeps` (type error) / never called.

- [ ] **Step 3: Wire the resolver into `lib/pipeline/process-transcript.ts`**

Add imports:

```ts
import { resolveEpisodeEntities, type ExtractedEntity } from "@/lib/entities/resolve"
```

Extend `PipelineDeps`:

```ts
export interface PipelineDeps {
  db: PostgresJsDatabase<typeof schema>
  generateInsights?: (transcript: string, segments: Segment[]) => Promise<Insights>
  embedTexts?: (texts: string[]) => Promise<number[][]>
  resolveEntities?: (
    episodeId: string,
    extracted: ExtractedEntity[],
    opts: { episodeTitle?: string },
  ) => Promise<void>
}
```

Inside `processTranscript`, next to the other dep defaults:

```ts
  const resolveEntities =
    deps.resolveEntities ??
    ((episodeId: string, extracted: ExtractedEntity[], opts: { episodeTitle?: string }) =>
      resolveEpisodeEntities(episodeId, extracted, { db, embedTexts: embed }, opts))
```

In step 0 (idempotency), add the link-table delete (entity chunks are already covered by the `chunks` delete; canonical `entities` rows persist on purpose):

```ts
    await db
      .delete(schema.episodeEntities)
      .where(eq(schema.episodeEntities.episodeId, result.episodeId))
```

After step 3 (chunk + embed), before step 4:

```ts
    // 3.5. Canonical entities — best-effort: enrichment failures must not
    // block the episode from reaching "ready".
    try {
      const episode = await repo.getById(result.episodeId)
      await resolveEntities(result.episodeId, insights.entities ?? [], {
        episodeTitle: episode?.title,
      })
    } catch (e) {
      console.error(`entity resolution failed for episode ${result.episodeId}`, e)
    }
```

- [ ] **Step 4: Run the pipeline tests**

Run: `npx vitest run test/pipeline/process-transcript.test.ts`
Expected: PASS (existing tests too — they don't pass `resolveEntities`, and the default resolver receives `entities: []` or the mocked insights' entities; if an existing test's mocked insights include entities, it would hit real APIs — in that case pass `resolveEntities: async () => {}` into that test's deps).

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/process-transcript.ts test/pipeline/process-transcript.test.ts
git commit -m "feat: resolve canonical entities in the transcript pipeline"
```

---

### Task 7: Backfill script

**Files:**
- Create: `scripts/backfill-entities.ts`

No automated test — it is a thin sequential wrapper over the already-tested resolver. Verification is the manual run in Task 12.

- [ ] **Step 1: Write `scripts/backfill-entities.ts`**

```ts
// One-off backfill: run every existing episode's extracted entities through the
// resolver. Idempotent — episodes that already have entity links are skipped,
// so it can be re-run safely after a partial failure.
//
// Usage: npx tsx scripts/backfill-entities.ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "@/lib/db/schema"
import { resolveEpisodeEntities } from "@/lib/entities/resolve"

async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 })
  const db = drizzle(client, { schema })

  const rows = await db
    .select({
      episodeId: schema.insights.episodeId,
      entities: schema.insights.entities,
      title: schema.episodes.title,
    })
    .from(schema.insights)
    .innerJoin(schema.episodes, eq(schema.episodes.id, schema.insights.episodeId))

  let done = 0
  for (const row of rows) {
    const extracted = row.entities ?? []
    const [existing] = await db
      .select({ episodeId: schema.episodeEntities.episodeId })
      .from(schema.episodeEntities)
      .where(eq(schema.episodeEntities.episodeId, row.episodeId))
      .limit(1)
    if (existing || extracted.length === 0) {
      console.log(`skip  ${row.title}`)
      continue
    }
    // Old insights rows predate per-entity context; the verifier falls back to
    // the episode title.
    await resolveEpisodeEntities(row.episodeId, extracted, { db }, { episodeTitle: row.title })
    done++
    console.log(`done  ${row.title} (${extracted.length} entities)`)
  }

  console.log(`backfilled ${done}/${rows.length} episodes`)
  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-entities.ts
git commit -m "feat: backfill script linking existing episodes to canonical entities"
```

---

### Task 8: UI data queries

**Files:**
- Create: `lib/db/entities.ts`
- Test: `test/db/entities.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/db/entities.test.ts`:

```ts
import {
  coMentionedEntities,
  entitiesForEpisode,
  episodesMentioningEntity,
  getEntityBySlug,
  searchEntities,
} from "@/lib/db/entities"

async function seedKnowledgeBase() {
  const ep1 = await repo.create({ title: "EP One", audioUrl: "https://a/kb1.mp3" })
  const ep2 = await repo.create({ title: "EP Two", audioUrl: "https://a/kb2.mp3" })
  const [jobs] = await db
    .insert(schema.entities)
    .values({
      name: "Steve Jobs",
      slug: "steve-jobs",
      type: "person",
      description: "American businessman",
      enrichmentStatus: "enriched",
    })
    .returning()
  const [apple] = await db
    .insert(schema.entities)
    .values({
      name: "Apple",
      slug: "apple",
      type: "company",
      description: "Consumer electronics company",
      enrichmentStatus: "enriched",
    })
    .returning()
  await db.insert(schema.episodeEntities).values([
    { episodeId: ep1.id, entityId: jobs.id, context: "design philosophy", approxTimestampSec: 60 },
    { episodeId: ep1.id, entityId: apple.id, context: "the Mac story" },
    { episodeId: ep2.id, entityId: jobs.id, context: "hiring" },
  ])
  return { ep1, ep2, jobs, apple }
}

test("getEntityBySlug and entitiesForEpisode return enriched rows with mention counts", async () => {
  const { ep1, jobs } = await seedKnowledgeBase()

  expect((await getEntityBySlug(db, "steve-jobs"))?.id).toBe(jobs.id)
  expect(await getEntityBySlug(db, "nope")).toBeNull()

  const forEp = await entitiesForEpisode(db, ep1.id)
  expect(forEp).toHaveLength(2)
  const jobsRow = forEp.find((e) => e.slug === "steve-jobs")!
  expect(jobsRow.context).toBe("design philosophy")
  expect(jobsRow.approxTimestampSec).toBe(60)
  expect(Number(jobsRow.mentionCount)).toBe(2)
}, 30_000)

test("episodesMentioningEntity returns episodes with per-episode context", async () => {
  const { jobs } = await seedKnowledgeBase()
  const eps = await episodesMentioningEntity(db, jobs.id)
  expect(eps).toHaveLength(2)
  expect(eps.map((e) => e.title).sort()).toEqual(["EP One", "EP Two"])
  expect(eps.find((e) => e.title === "EP One")?.context).toBe("design philosophy")
}, 30_000)

test("coMentionedEntities surfaces entities sharing episodes", async () => {
  const { jobs, apple } = await seedKnowledgeBase()
  const co = await coMentionedEntities(db, jobs.id, 5)
  expect(co).toHaveLength(1)
  expect(co[0].id).toBe(apple.id)
  expect(Number(co[0].sharedEpisodes)).toBe(1)
}, 30_000)

test("searchEntities matches name or description, case-insensitively", async () => {
  await seedKnowledgeBase()
  const byName = await searchEntities(db, "steve", 5)
  expect(byName.map((e) => e.slug)).toContain("steve-jobs")
  const byDescription = await searchEntities(db, "electronics", 5)
  expect(byDescription.map((e) => e.slug)).toContain("apple")
}, 30_000)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/db/entities.test.ts`
Expected: FAIL — cannot resolve `@/lib/db/entities`.

- [ ] **Step 3: Implement `lib/db/entities.ts`**

```ts
import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { entities, episodeEntities, episodes } from "./schema"
import * as schema from "./schema"

type DB = PostgresJsDatabase<typeof schema>

const mentionCount = sql<number>`(
  select count(*) from ${episodeEntities} ee where ee.entity_id = ${entities.id}
)`.as("mention_count")

export async function getEntityBySlug(db: DB, slug: string) {
  const rows = await db.select().from(entities).where(eq(entities.slug, slug)).limit(1)
  return rows[0] ?? null
}

// Entities mentioned in one episode, with this episode's mention context and
// the library-wide mention count (for the hover card).
export async function entitiesForEpisode(db: DB, episodeId: string) {
  return db
    .select({
      id: entities.id,
      name: entities.name,
      slug: entities.slug,
      type: entities.type,
      description: entities.description,
      imageUrl: entities.imageUrl,
      metadata: entities.metadata,
      context: episodeEntities.context,
      approxTimestampSec: episodeEntities.approxTimestampSec,
      mentionCount,
    })
    .from(episodeEntities)
    .innerJoin(entities, eq(entities.id, episodeEntities.entityId))
    .where(eq(episodeEntities.episodeId, episodeId))
    .orderBy(entities.name)
}

// Episodes mentioning an entity, each with its own context line and timestamp.
export async function episodesMentioningEntity(db: DB, entityId: string) {
  return db
    .select({
      id: episodes.id,
      title: episodes.title,
      podcastName: episodes.podcastName,
      artworkUrl: episodes.artworkUrl,
      publishedAt: episodes.publishedAt,
      createdAt: episodes.createdAt,
      context: episodeEntities.context,
      approxTimestampSec: episodeEntities.approxTimestampSec,
    })
    .from(episodeEntities)
    .innerJoin(episodes, eq(episodes.id, episodeEntities.episodeId))
    .where(eq(episodeEntities.entityId, entityId))
    .orderBy(desc(episodes.createdAt))
}

// "Often mentioned with": entities sharing episodes with this one, by count.
export async function coMentionedEntities(db: DB, entityId: string, limit = 8) {
  const ee1 = sql`${episodeEntities}`
  const sharedEpisodes = sql<number>`count(*)`.as("shared_episodes")
  return db
    .select({
      id: entities.id,
      name: entities.name,
      slug: entities.slug,
      type: entities.type,
      imageUrl: entities.imageUrl,
      sharedEpisodes,
    })
    .from(episodeEntities)
    .innerJoin(
      sql`${episodeEntities} as co`,
      sql`co.episode_id = ${episodeEntities.episodeId} and co.entity_id <> ${episodeEntities.entityId}`,
    )
    .innerJoin(entities, sql`${entities.id} = co.entity_id`)
    .where(eq(episodeEntities.entityId, entityId))
    .groupBy(entities.id)
    .orderBy(desc(sql`count(*)`))
    .limit(limit)
}

// Entity cards for /search: simple ILIKE on name/description, most-mentioned first.
export async function searchEntities(db: DB, query: string, limit = 5) {
  const term = `%${query}%`
  return db
    .select({
      id: entities.id,
      name: entities.name,
      slug: entities.slug,
      type: entities.type,
      description: entities.description,
      imageUrl: entities.imageUrl,
      mentionCount,
    })
    .from(entities)
    .where(or(ilike(entities.name, term), ilike(entities.description, term)))
    .orderBy(desc(sql`mention_count`))
    .limit(limit)
}
```

Note on `coMentionedEntities`: the raw-SQL self-join alias is the one query Drizzle's builder can't express cleanly. If the `sql`-fragment join gives the query builder trouble at runtime, fall back to a fully raw query via `db.execute(sql\`...\`)`:

```ts
export async function coMentionedEntities(db: DB, entityId: string, limit = 8) {
  const result = await db.execute(sql`
    select e.id, e.name, e.slug, e.type, e.image_url as "imageUrl",
           count(*) as "sharedEpisodes"
    from episode_entities ee
    join episode_entities co on co.episode_id = ee.episode_id and co.entity_id <> ee.entity_id
    join entities e on e.id = co.entity_id
    where ee.entity_id = ${entityId}
    group by e.id
    order by count(*) desc
    limit ${limit}
  `)
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  return rows as { id: string; name: string; slug: string; type: string; imageUrl: string | null; sharedEpisodes: number }[]
}
```

(The `Array.isArray` normalization copies `hybridSearch` in `lib/db/search.ts`.) Prefer whichever version passes the test; the raw version is known-good.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/db/entities.test.ts`
Expected: PASS (5 tests including Task 1's)

- [ ] **Step 5: Commit**

```bash
git add lib/db/entities.ts test/db/entities.test.ts
git commit -m "feat: entity queries for pages, hover cards, and search"
```

---

### Task 9: Entity page — `/entities/[slug]`

**Files:**
- Create: `app/entities/[slug]/page.tsx`

Server component; follows `app/topics/[slug]/page.tsx` conventions (`AppHeader`, `force-dynamic`). No automated test — verified by typecheck and the manual pass in Task 12.

- [ ] **Step 1: Create `app/entities/[slug]/page.tsx`**

```tsx
import Link from "next/link"
import { notFound } from "next/navigation"
import { ExternalLink } from "lucide-react"
import { db } from "@/lib/db"
import {
  coMentionedEntities,
  episodesMentioningEntity,
  getEntityBySlug,
} from "@/lib/db/entities"
import { AppHeader } from "@/components/app-header"
import { Badge } from "@/components/ui/badge"
import { hiResArtwork } from "@/lib/artwork"
import { formatTimestamp } from "@/lib/format"

export const dynamic = "force-dynamic"

const TYPE_LABELS: Record<string, string> = {
  person: "Person",
  company: "Company",
  book: "Book",
  product: "Product",
  place: "Place",
  other: "Mention",
}

export default async function EntityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entity = await getEntityBySlug(db, slug)
  if (!entity) notFound()

  const [mentions, related] = await Promise.all([
    episodesMentioningEntity(db, entity.id),
    coMentionedEntities(db, entity.id),
  ])

  const externalUrl =
    entity.wikipediaUrl ??
    (entity.externalIds?.googleBooksId
      ? `https://books.google.com/books?id=${entity.externalIds.googleBooksId}`
      : null)
  const bookMeta = [entity.metadata?.author, entity.metadata?.publishedYear]
    .filter(Boolean)
    .join(" · ")

  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Library", href: "/" }, { label: entity.name }]} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 md:p-6">
        <div className="mx-auto w-full max-w-3xl space-y-8">
          <header className="flex items-start gap-4">
            {entity.imageUrl && (
              <div
                className={`shrink-0 overflow-hidden bg-muted ${
                  entity.type === "book" ? "h-28 w-20 rounded-md" : "size-20 rounded-full"
                }`}
              >
                <img src={entity.imageUrl} alt="" className="size-full object-cover" />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold">{entity.name}</h1>
                <Badge variant="secondary">{TYPE_LABELS[entity.type] ?? entity.type}</Badge>
              </div>
              {entity.type === "book" && bookMeta && (
                <p className="text-sm text-muted-foreground">{bookMeta}</p>
              )}
              {entity.description && (
                <p className="text-sm text-muted-foreground">{entity.description}</p>
              )}
              {externalUrl && (
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  {entity.wikipediaUrl ? "Wikipedia" : "Google Books"}
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </header>

          {entity.summary && (
            <p className="font-serif text-lg leading-relaxed">{entity.summary}</p>
          )}

          <section className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Mentioned in {mentions.length} episode{mentions.length === 1 ? "" : "s"}
            </h2>
            <div className="overflow-hidden rounded-lg border">
              {mentions.map((m) => (
                <Link
                  key={m.id}
                  href={
                    m.approxTimestampSec != null
                      ? `/episodes/${m.id}?t=${m.approxTimestampSec}`
                      : `/episodes/${m.id}`
                  }
                  className="flex items-start gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-muted"
                >
                  <div className="size-10 shrink-0 overflow-hidden rounded bg-muted">
                    {m.artworkUrl ? (
                      <img src={hiResArtwork(m.artworkUrl, 120)} alt="" className="size-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    {m.context && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{m.context}</p>
                    )}
                  </div>
                  {m.approxTimestampSec != null && (
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatTimestamp(m.approxTimestampSec)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </section>

          {related.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Often mentioned with
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {related.map((r) => (
                  <Link key={r.id} href={`/entities/${r.slug}`}>
                    <Badge variant="outline" className="hover:bg-muted">
                      {r.name}
                    </Badge>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean. (If `lucide-react`'s `ExternalLink` name differs in the installed version, check with `grep -r "ExternalLink" node_modules/lucide-react/dist/lucide-react.d.ts | head -1`.)

- [ ] **Step 3: Commit**

```bash
git add app/entities
git commit -m "feat: entity detail page with mentions, contexts, and related entities"
```

---

### Task 10: Mentioned section — hover cards, book covers, entity links

**Files:**
- Create: `components/ui/hover-card.tsx`
- Modify: `components/episode-insights.tsx`
- Modify: `components/episode-view.tsx`
- Modify: `app/episodes/[id]/page.tsx`

Episodes processed before the backfill (or if the resolver failed) have no `episode_entities` rows; the section falls back to the legacy badge rendering from `insights.entities` so nothing regresses.

- [ ] **Step 1: Add the hover-card primitive**

Create `components/ui/hover-card.tsx` following the existing `components/ui/popover.tsx` pattern (unified `radix-ui` package import — do NOT add an `@radix-ui/react-hover-card` dependency):

```tsx
"use client"

import * as React from "react"
import { HoverCard as HoverCardPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function HoverCard({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" openDelay={200} closeDelay={100} {...props} />
}

function HoverCardTrigger({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
}

function HoverCardContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
```

(Match the exact `className` animation/utility strings used in `components/ui/popover.tsx`'s `PopoverContent` — copy them from that file rather than from this snippet if they differ.)

- [ ] **Step 2: Fetch entities on the episode page**

In `app/episodes/[id]/page.tsx`, add the import and query:

```ts
import { entitiesForEpisode } from "@/lib/db/entities"
```

```ts
  const entities = await entitiesForEpisode(db, id)
```

and pass it to the view:

```tsx
      <EpisodeView
        episode={{ /* unchanged */ }}
        transcript={transcript ? { fullText: transcript.fullText, segments: transcript.segments ?? [] } : null}
        insights={insight ?? null}
        entities={entities.map((e) => ({
          ...e,
          mentionCount: Number(e.mentionCount),
        }))}
      />
```

- [ ] **Step 3: Thread the prop through `components/episode-view.tsx`**

Add to the types and signature:

```ts
import type { MentionedEntity } from "@/components/episode-insights"
```

```ts
export type EpisodeViewProps = {
  // ...existing fields unchanged
  entities?: MentionedEntity[]
}
```

```ts
export function EpisodeView({ episode, transcript, insights, entities = [] }: EpisodeViewProps) {
```

Update the sections computation and the insights render:

```ts
  const sections = insightSections(insights, entities.length > 0)
```

```tsx
              <TabsContent value="insights" className="pb-10 pt-2">
                <EpisodeInsights insights={insights} entities={entities} onSeek={seek} />
              </TabsContent>
```

- [ ] **Step 4: Rework the Mentioned section in `components/episode-insights.tsx`**

Add imports:

```tsx
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { formatTimestamp } from "@/lib/format" // already imported
```

Add the exported type:

```ts
export type MentionedEntity = {
  id: string
  name: string
  slug: string
  type: string
  description: string | null
  imageUrl: string | null
  metadata: { author?: string; publishedYear?: number } | null
  context: string | null
  approxTimestampSec: number | null
  mentionCount: number
}
```

Update `insightSections` to account for canonical entities:

```ts
export function insightSections(insights: InsightsData, hasEntities?: boolean): InsightSection[] {
  if (!insights && !hasEntities) return []
  const out: InsightSection[] = []
  if (insights?.summary) out.push({ id: "summary", label: "Overview" })
  if (insights?.chapters?.length) out.push({ id: "chapters", label: "Chapters" })
  if (insights?.takeaways?.length) out.push({ id: "takeaways", label: "Key takeaways" })
  if (insights?.quotes?.length) out.push({ id: "quotes", label: "Notable quotes" })
  if (insights?.topics?.length) out.push({ id: "topics", label: "Topics" })
  if (hasEntities || insights?.entities?.length) out.push({ id: "mentioned", label: "Mentioned" })
  return out
}
```

Update the component signature:

```tsx
export function EpisodeInsights({
  insights,
  entities = [],
  onSeek,
}: {
  insights: InsightsData
  entities?: MentionedEntity[]
  onSeek: (sec: number) => void
}) {
```

Change the early return so canonical entities render even without insights:

```tsx
  if (!insights && entities.length === 0)
    return <p className="text-sm text-muted-foreground">No insights yet.</p>
```

(Keep the existing local consts but read from `insights?.` optionals, e.g. `const chapters = insights?.chapters ?? []`.)

Replace the entire `{entities.length > 0 && (...Mentioned section...)}` block — note the old block read the *legacy* `entities` const from `insights.entities`; rename that const to `legacyEntities` — with:

```tsx
      {entities.length > 0 ? (
        <Section id="mentioned" icon={<Users className="size-3.5" />} title="Mentioned">
          <div className="space-y-5">
            {ENTITY_GROUPS.map(({ type, label }) => {
              const items = entities.filter((e) => (e.type ?? "other") === type)
              if (items.length === 0) return null
              if (type === "book") {
                return (
                  <div key={type} className="space-y-2">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <div className="flex flex-wrap gap-3">
                      {items.map((e) => (
                        <Link
                          key={e.id}
                          href={`/entities/${e.slug}`}
                          className="group w-24 space-y-1.5"
                        >
                          <div className="aspect-2/3 w-24 overflow-hidden rounded-md border bg-muted shadow-sm transition-shadow group-hover:shadow-md">
                            {e.imageUrl ? (
                              <img src={e.imageUrl} alt="" className="size-full object-cover" />
                            ) : (
                              <div className="flex size-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                                {e.name}
                              </div>
                            )}
                          </div>
                          <p className="line-clamp-2 text-xs font-medium leading-snug">{e.name}</p>
                          {e.metadata?.author && (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {e.metadata.author}
                            </p>
                          )}
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              }
              return (
                <div key={type} className="space-y-2">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((e) => (
                      <HoverCard key={e.id}>
                        <HoverCardTrigger asChild>
                          <Link href={`/entities/${e.slug}`}>
                            <Badge variant="outline" className="hover:bg-muted">
                              {e.name}
                            </Badge>
                          </Link>
                        </HoverCardTrigger>
                        <HoverCardContent>
                          <div className="flex gap-3">
                            {e.imageUrl && (
                              <div className="size-12 shrink-0 overflow-hidden rounded-full bg-muted">
                                <img src={e.imageUrl} alt="" className="size-full object-cover" />
                              </div>
                            )}
                            <div className="min-w-0 space-y-1">
                              <p className="text-sm font-medium">{e.name}</p>
                              {e.description && (
                                <p className="line-clamp-3 text-xs text-muted-foreground">
                                  {e.description}
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground">
                                Mentioned in {e.mentionCount} episode{e.mentionCount === 1 ? "" : "s"}
                                {e.approxTimestampSec != null && (
                                  <>
                                    {" · "}
                                    <button
                                      type="button"
                                      onClick={() => onSeek(e.approxTimestampSec!)}
                                      className="tabular-nums hover:text-foreground hover:underline"
                                    >
                                      {formatTimestamp(e.approxTimestampSec)}
                                    </button>
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      ) : legacyEntities.length > 0 ? (
        <Section id="mentioned" icon={<Users className="size-3.5" />} title="Mentioned">
          {/* Legacy fallback: episodes not yet backfilled render the old badges. */}
          <div className="space-y-4">
            {ENTITY_GROUPS.map(({ type, label }) => {
              const items = legacyEntities.filter((e) => (e.type ?? "other") === type)
              if (items.length === 0) return null
              return (
                <div key={type} className="space-y-2">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((e, i) => (
                      <Link key={i} href={`/topics/${encodeURIComponent(e.name)}`}>
                        <Badge variant="outline" className="hover:bg-muted">
                          {e.name}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      ) : null}
```

- [ ] **Step 5: Typecheck, lint, and run the full suite**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: clean — the only consumer of `insightSections` is `episode-view.tsx`, updated above.

- [ ] **Step 6: Commit**

```bash
git add components/ui/hover-card.tsx components/episode-insights.tsx components/episode-view.tsx app/episodes
git commit -m "feat: Mentioned section — entity hover cards, book covers, entity links"
```

---

### Task 11: Search integration — entity cards in `/search`

**Files:**
- Modify: `app/api/answer/route.ts`
- Modify: `components/search-view.tsx`

(The Ask side needs no code: entity chunks already live in `chunks` and flow through `hybridSearch`/`searchChunks` retrieval.)

- [ ] **Step 1: Return entities from `app/api/answer/route.ts`**

Add the import:

```ts
import { searchEntities } from "@/lib/db/entities"
```

Replace the two-line retrieval block with a parallel fetch and include entities in both responses:

```ts
  const [rawSources, entities] = await Promise.all([
    hybridSearch(db, await embedQuery(query), query, { limit: 10 }),
    searchEntities(db, query, 5).catch(() => []),
  ])
  if (rawSources.length === 0) return Response.json({ answer: null, sources: [], entities })
  const sources = await refineHitTimestamps(db, rawSources, query)
```

and at the end:

```ts
  return Response.json({ answer: text, sources, entities })
```

- [ ] **Step 2: Render entity cards in `components/search-view.tsx`**

Add the type next to `Source`:

```ts
type EntityHit = {
  id: string
  name: string
  slug: string
  type: string
  description: string | null
  imageUrl: string | null
  mentionCount: number
}
```

Add state and wire it in the fetch handler:

```ts
  const [entities, setEntities] = useState<EntityHit[]>([])
```

```ts
        setAnswer(d.answer ?? null)
        setSources(d.sources ?? [])
        setEntities(d.entities ?? [])
```

(Also reset it alongside the others when the query is too short: `setEntities([])`.)

Render the cards inside the `{!loading && query.trim().length >= 2 && (` block, **above** the answer section:

```tsx
          {entities.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                In your knowledge base
              </h2>
              <div className="flex flex-wrap gap-2">
                {entities.map((e) => (
                  <Link
                    key={e.id}
                    href={`/entities/${e.slug}`}
                    className="flex min-w-0 max-w-xs items-center gap-2.5 rounded-lg border p-2.5 pr-4 transition-colors hover:bg-muted"
                  >
                    <div className="size-9 shrink-0 overflow-hidden rounded-full bg-muted">
                      {e.imageUrl ? (
                        <img src={e.imageUrl} alt="" className="size-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{e.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {e.description ??
                          `Mentioned in ${e.mentionCount} episode${Number(e.mentionCount) === 1 ? "" : "s"}`}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/answer/route.ts components/search-view.tsx
git commit -m "feat: entity cards in search results"
```

---

### Task 12: Final verification — full suite, build, backfill, manual pass

- [ ] **Step 1: Full automated verification**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all clean/passing.

- [ ] **Step 2: Run the backfill against the dev database**

Run: `npx tsx scripts/backfill-entities.ts`
Expected: per-episode `done`/`skip` lines, no crash. This makes real Wikipedia/Google Books/iTunes calls and one `gpt-5.4-mini` call per unique entity — requires `DATABASE_URL` and `OPENAI_API_KEY` in `.env.local`. Re-running prints `skip` for every episode (idempotent).

- [ ] **Step 3: Manual end-to-end check (dev server)**

Run: `npm run dev`, then verify:
1. An episode detail page: Mentioned section shows hover cards (image, description, mention count) and a book-cover row; badges link to `/entities/[slug]`.
2. An entity page: header with image/description/Wikipedia link, episode list with context lines and timestamp jumps, "Often mentioned with" badges.
3. `/search?q=<an entity name>`: "In your knowledge base" cards appear above the answer.
4. `/ask`: a question like "which books were mentioned?" retrieves entity-context chunks (citations land on the right episodes).
5. Spot-check 3–5 enriched entities for wrong Wikipedia matches; check `select name, enrichment_status from entities where enrichment_status <> 'enriched'` for the unmatched/failed tail.

- [ ] **Step 4: Commit any fixes, then wrap up**

Use the superpowers:finishing-a-development-branch skill to decide merge/PR/cleanup.
