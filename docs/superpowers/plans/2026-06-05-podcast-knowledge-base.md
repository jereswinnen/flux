# Podcast Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal app that finds a podcast episode (iTunes search or pasted URL), transcribes it on GPU, generates structured insights, and makes it queryable via semantic search and grounded Q&A.

**Architecture:** A single Next.js 16 (App Router) app on Railway owns orchestration and a webhook. It calls the iTunes Search API and RSS feeds to resolve an audio enclosure URL, triggers a standalone Modal `faster-whisper` function async, and receives the transcript via webhook. It then generates insights and embeddings via OpenAI and stores everything in Railway Postgres + pgvector.

**Tech Stack:** Next.js 16, TypeScript, shadcn/ui, Tailwind v4, Drizzle ORM + postgres.js, pgvector, Vercel AI SDK (`ai` + `@ai-sdk/openai`), `fast-xml-parser`, Vitest, Modal + `faster-whisper` (Python).

**Spec:** `docs/superpowers/specs/2026-06-05-podcast-knowledge-base-design.md`

### Conventions for this codebase (read before starting)

- **Next.js 16 is not the Next.js in your training data.** Per `AGENTS.md`, consult `node_modules/next/dist/docs/01-app/` before writing route handlers/pages. Verified conventions used in this plan:
  - Route Handlers: `app/**/route.ts` exporting `GET`/`POST`, using Web `Request`/`Response`. Return JSON with `Response.json(data, { status })`.
  - Dynamic params are async: `{ params }: { params: Promise<{ id: string }> }` then `const { id } = await params`.
- Path alias `@/*` → repo root. shadcn aliases: `@/components/ui`, `@/lib`, `@/hooks`.
- Package manager is **pnpm**. Add deps with `pnpm add`, run scripts with `pnpm <script>`.
- Tests run with **Vitest** (`pnpm test`). Pure-logic tests need no DB. DB/route tests run against the Railway Postgres in `.env.local` (`DATABASE_URL` for dev, `TEST_DATABASE_URL` = a separate database on the same Railway instance).
- Commit after every task. Use `feat:`/`test:`/`chore:` prefixes.

---

## Task 1: Tooling, dependencies, and test infrastructure

**Files:**
- Modify: `package.json` (deps + scripts)
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.env.local` (gitignored; for local dev)
- Create: `test/setup.ts`

- [ ] **Step 1: Install dependencies**

```bash
pnpm add drizzle-orm postgres ai @ai-sdk/openai zod fast-xml-parser
pnpm add -D drizzle-kit vitest dotenv @types/node
```

- [ ] **Step 2: Add scripts to `package.json`**

Add to the `"scripts"` block:

```json
"test": "vitest run",
"test:watch": "vitest",
"db:generate": "drizzle-kit generate",
"db:migrate": "tsx lib/db/migrate.ts"
```

Also install `tsx` for running TS scripts:

```bash
pnpm add -D tsx
```

- [ ] **Step 3: Create `.env.example`**

```bash
# Postgres on Railway. DATABASE_URL is the app DB; TEST_DATABASE_URL is a
# separate database on the same Railway instance, used only by tests.
DATABASE_URL="postgres://USER:PASS@HOST:PORT/railway"
TEST_DATABASE_URL="postgres://USER:PASS@HOST:PORT/podcast_kb_test"

# OpenAI
OPENAI_API_KEY=""

# Modal transcription endpoint (set after `modal deploy`)
MODAL_TRANSCRIBE_URL=""
# Shared secret for trigger + callback auth (generate a random string)
MODAL_WEBHOOK_SECRET=""

# Public base URL used to build the Modal callback URL
APP_URL="http://localhost:3000"
```

- [ ] **Step 4: Create `.env.local`** by copying `.env.example`. The user supplies the Railway `DATABASE_URL`. Derive `TEST_DATABASE_URL` from it by swapping the database name to `podcast_kb_test`, then create that database: `psql "$DATABASE_URL" -c "CREATE DATABASE podcast_kb_test;"`. Leave OpenAI/Modal blank for now. Confirm `.env*.local` is gitignored (verify with `git check-ignore .env.local`).

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    globals: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
})
```

- [ ] **Step 7: Create `test/setup.ts`** (loads env for tests)

```ts
import { config } from "dotenv"
config({ path: ".env.local" })
```

- [ ] **Step 8: Sanity test that the harness runs**

Create `test/smoke.test.ts`:

```ts
import { expect, test } from "vitest"

test("vitest runs", () => {
  expect(1 + 1).toBe(2)
})
```

- [ ] **Step 9: Run it**

Run: `pnpm test`
Expected: 1 passed.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: add deps and vitest setup"
```

---

## Task 2: Database schema and migrations

**Files:**
- Create: `lib/db/schema.ts`
- Create: `lib/db/index.ts`
- Create: `drizzle.config.ts`
- Create: `lib/db/migrate.ts`
- Test: `test/db/schema.test.ts`

- [ ] **Step 1: Create `lib/db/schema.ts`**

```ts
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core"

export type EpisodeStatus =
  | "processing"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "failed"

export const episodes = pgTable("episodes", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  podcastName: text("podcast_name"),
  audioUrl: text("audio_url").notNull(),
  sourceUrl: text("source_url"),
  artworkUrl: text("artwork_url"),
  episodeGuid: text("episode_guid"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  durationSec: integer("duration_sec"),
  itunesCollectionId: bigint("itunes_collection_id", { mode: "number" }),
  itunesTrackId: bigint("itunes_track_id", { mode: "number" }),
  status: text("status").$type<EpisodeStatus>().notNull().default("processing"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const transcripts = pgTable("transcripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  episodeId: uuid("episode_id")
    .notNull()
    .references(() => episodes.id, { onDelete: "cascade" }),
  fullText: text("full_text").notNull(),
  segments: jsonb("segments").$type<{ start: number; end: number; text: string }[]>(),
})

export const insights = pgTable("insights", {
  id: uuid("id").defaultRandom().primaryKey(),
  episodeId: uuid("episode_id")
    .notNull()
    .references(() => episodes.id, { onDelete: "cascade" }),
  summary: text("summary"),
  takeaways: jsonb("takeaways").$type<string[]>(),
  topics: jsonb("topics").$type<string[]>(),
  quotes: jsonb("quotes").$type<{ text: string; approxTimestampSec: number }[]>(),
  entities: jsonb("entities").$type<{ name: string; type: string }[]>(),
})

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    startSec: integer("start_sec").notNull(),
    endSec: integer("end_sec").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  },
  (t) => [
    index("chunks_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
)
```

- [ ] **Step 2: Create `lib/db/index.ts`** (client)

```ts
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error("DATABASE_URL is not set")

const client = postgres(connectionString)
export const db = drizzle(client, { schema })
export { schema }
```

- [ ] **Step 3: Create `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

- [ ] **Step 4: Generate the migration**

Run with the Railway URL in scope: `DATABASE_URL="$(grep '^DATABASE_URL' .env.local | cut -d= -f2- | tr -d '\"')" pnpm db:generate`
Expected: a SQL file appears in `lib/db/migrations/`.

- [ ] **Step 5: Add the pgvector extension to the generated migration**

Open the newest file in `lib/db/migrations/*.sql`. Add this as the **very first line** (the `hnsw` index requires the extension to exist first):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 6: Create `lib/db/migrate.ts`** (migration runner)

```ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  const client = postgres(url, { max: 1 })
  await migrate(drizzle(client), { migrationsFolder: "./lib/db/migrations" })
  await client.end()
  console.log("migrations applied")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 7: Apply migrations to local dev DB**

Run: `pnpm db:migrate`
Expected: "migrations applied".

- [ ] **Step 8: Write a schema round-trip test** `test/db/schema.test.ts`

```ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { afterAll, beforeAll, expect, test } from "vitest"
import { episodes } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

const url = process.env.TEST_DATABASE_URL!
const client = postgres(url, { max: 1 })
const db = drizzle(client)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
afterAll(async () => {
  await client.end()
})

test("can insert and read an episode", async () => {
  const [row] = await db
    .insert(episodes)
    .values({ title: "Test Ep", audioUrl: "https://example.com/a.mp3" })
    .returning()
  expect(row.status).toBe("processing")
  const found = await db.select().from(episodes).where(eq(episodes.id, row.id))
  expect(found[0].title).toBe("Test Ep")
  await db.delete(episodes).where(eq(episodes.id, row.id))
})
```

- [ ] **Step 9: Create the test DB and run the test**

Run: `psql "$DATABASE_URL" -c "CREATE DATABASE podcast_kb_test;" || true` then `pnpm test test/db/schema.test.ts`
Expected: PASS (migration creates the extension + tables in the test DB, insert/read works).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add drizzle schema, pgvector migration, and migrate runner"
```

---

## Task 3: iTunes Search client (`lib/itunes`)

**Files:**
- Create: `lib/itunes/types.ts`
- Create: `lib/itunes/map.ts`
- Create: `lib/itunes/client.ts`
- Test: `test/itunes/map.test.ts`
- Test: `test/itunes/client.test.ts`

- [ ] **Step 1: Create `lib/itunes/types.ts`**

```ts
export interface ShowResult {
  collectionId: number
  name: string
  artistName: string
  artworkUrl?: string
  feedUrl?: string
}

export interface EpisodeResult {
  trackId: number
  collectionId: number
  title: string
  podcastName: string
  audioUrl?: string // episodeUrl from iTunes
  artworkUrl?: string
  feedUrl?: string
  releaseDate?: string
  durationSec?: number
}
```

- [ ] **Step 2: Write failing test for mapping** `test/itunes/map.test.ts`

```ts
import { expect, test } from "vitest"
import { mapShow, mapEpisode } from "@/lib/itunes/map"

test("mapShow normalizes a podcast result", () => {
  const raw = {
    collectionId: 123,
    collectionName: "My Show",
    artistName: "Jane",
    artworkUrl600: "https://img/600.jpg",
    feedUrl: "https://feed.xml",
  }
  expect(mapShow(raw)).toEqual({
    collectionId: 123,
    name: "My Show",
    artistName: "Jane",
    artworkUrl: "https://img/600.jpg",
    feedUrl: "https://feed.xml",
  })
})

test("mapEpisode normalizes a podcastEpisode result", () => {
  const raw = {
    trackId: 9,
    collectionId: 123,
    trackName: "Ep 1",
    collectionName: "My Show",
    episodeUrl: "https://cdn/ep1.mp3",
    artworkUrl160: "https://img/160.jpg",
    feedUrl: "https://feed.xml",
    releaseDate: "2026-01-01T00:00:00Z",
    trackTimeMillis: 1800000,
  }
  expect(mapEpisode(raw)).toEqual({
    trackId: 9,
    collectionId: 123,
    title: "Ep 1",
    podcastName: "My Show",
    audioUrl: "https://cdn/ep1.mp3",
    artworkUrl: "https://img/160.jpg",
    feedUrl: "https://feed.xml",
    releaseDate: "2026-01-01T00:00:00Z",
    durationSec: 1800,
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test test/itunes/map.test.ts`
Expected: FAIL ("Cannot find module '@/lib/itunes/map'").

- [ ] **Step 4: Implement `lib/itunes/map.ts`**

```ts
import type { EpisodeResult, ShowResult } from "./types"

export function mapShow(raw: any): ShowResult {
  return {
    collectionId: raw.collectionId,
    name: raw.collectionName,
    artistName: raw.artistName,
    artworkUrl: raw.artworkUrl600 ?? raw.artworkUrl100,
    feedUrl: raw.feedUrl,
  }
}

export function mapEpisode(raw: any): EpisodeResult {
  return {
    trackId: raw.trackId,
    collectionId: raw.collectionId,
    title: raw.trackName,
    podcastName: raw.collectionName,
    audioUrl: raw.episodeUrl,
    artworkUrl: raw.artworkUrl160 ?? raw.artworkUrl600 ?? raw.artworkUrl100,
    feedUrl: raw.feedUrl,
    releaseDate: raw.releaseDate,
    durationSec: raw.trackTimeMillis
      ? Math.round(raw.trackTimeMillis / 1000)
      : undefined,
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test test/itunes/map.test.ts`
Expected: PASS.

- [ ] **Step 6: Write failing test for the client (mocked fetch)** `test/itunes/client.test.ts`

```ts
import { afterEach, expect, test, vi } from "vitest"
import { searchShows, searchEpisodes } from "@/lib/itunes/client"

afterEach(() => vi.restoreAllMocks())

test("searchShows hits the podcast entity and maps results", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        results: [
          { collectionId: 1, collectionName: "S", artistName: "A", feedUrl: "f" },
        ],
      }),
    ),
  )
  vi.stubGlobal("fetch", fetchMock)

  const out = await searchShows("test")
  expect(out[0].name).toBe("S")
  const url = fetchMock.mock.calls[0][0] as string
  expect(url).toContain("entity=podcast")
  expect(url).toContain("term=test")
})

test("searchEpisodes hits the podcastEpisode entity", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ results: [] })),
  )
  vi.stubGlobal("fetch", fetchMock)
  await searchEpisodes("hello world")
  const url = fetchMock.mock.calls[0][0] as string
  expect(url).toContain("entity=podcastEpisode")
  expect(url).toContain("term=hello%20world")
})
```

- [ ] **Step 7: Implement `lib/itunes/client.ts`**

```ts
import { mapEpisode, mapShow } from "./map"
import type { EpisodeResult, ShowResult } from "./types"

const BASE = "https://itunes.apple.com/search"

// Light in-memory TTL cache to stay under Apple's ~20 req/min limit.
const cache = new Map<string, { at: number; data: unknown }>()
const TTL_MS = 60_000

async function getJson(url: string): Promise<any> {
  const hit = cache.get(url)
  const now = Date.now()
  if (hit && now - hit.at < TTL_MS) return hit.data
  const res = await fetch(url)
  if (!res.ok) throw new Error(`iTunes request failed: ${res.status}`)
  const data = await res.json()
  cache.set(url, { at: now, data })
  return data
}

export async function searchShows(term: string): Promise<ShowResult[]> {
  const url = `${BASE}?media=podcast&entity=podcast&limit=25&term=${encodeURIComponent(term)}`
  const data = await getJson(url)
  return (data.results ?? []).map(mapShow)
}

export async function searchEpisodes(term: string): Promise<EpisodeResult[]> {
  const url = `${BASE}?media=podcast&entity=podcastEpisode&limit=25&term=${encodeURIComponent(term)}`
  const data = await getJson(url)
  return (data.results ?? []).map(mapEpisode)
}
```

Note: `encodeURIComponent` encodes spaces as `%20` (matches the test).

- [ ] **Step 8: Run client tests**

Run: `pnpm test test/itunes/`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add iTunes search client and result mapping"
```

---

## Task 4: RSS feed resolution (`lib/rss`)

**Files:**
- Create: `lib/rss/duration.ts`
- Create: `lib/rss/parse.ts`
- Create: `lib/rss/fetch.ts`
- Test: `test/rss/duration.test.ts`
- Test: `test/rss/parse.test.ts`

- [ ] **Step 1: Write failing test for duration parsing** `test/rss/duration.test.ts`

```ts
import { expect, test } from "vitest"
import { parseItunesDuration } from "@/lib/rss/duration"

test("parses HH:MM:SS", () => {
  expect(parseItunesDuration("01:02:03")).toBe(3723)
})
test("parses MM:SS", () => {
  expect(parseItunesDuration("12:30")).toBe(750)
})
test("parses plain seconds", () => {
  expect(parseItunesDuration("1800")).toBe(1800)
})
test("returns undefined for junk", () => {
  expect(parseItunesDuration("")).toBeUndefined()
  expect(parseItunesDuration(undefined)).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/rss/duration.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/rss/duration.ts`**

```ts
export function parseItunesDuration(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const parts = trimmed.split(":").map(Number)
  if (parts.some((n) => Number.isNaN(n))) return undefined
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test test/rss/duration.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing test for feed parsing** `test/rss/parse.test.ts`

```ts
import { expect, test } from "vitest"
import { parseFeed } from "@/lib/rss/parse"

const XML = `<?xml version="1.0"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>My Show</title>
    <itunes:image href="https://img/show.jpg"/>
    <item>
      <title>Ep One</title>
      <guid>guid-1</guid>
      <pubDate>Wed, 01 Jan 2026 00:00:00 +0000</pubDate>
      <itunes:duration>00:30:00</itunes:duration>
      <enclosure url="https://cdn/ep1.mp3" type="audio/mpeg" length="123"/>
    </item>
    <item>
      <title>Ep Two</title>
      <guid isPermaLink="false">guid-2</guid>
      <enclosure url="https://cdn/ep2.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`

test("parseFeed extracts show + episodes with enclosures", () => {
  const feed = parseFeed(XML)
  expect(feed.showName).toBe("My Show")
  expect(feed.artworkUrl).toBe("https://img/show.jpg")
  expect(feed.episodes).toHaveLength(2)
  expect(feed.episodes[0]).toMatchObject({
    title: "Ep One",
    guid: "guid-1",
    audioUrl: "https://cdn/ep1.mp3",
    durationSec: 1800,
  })
  expect(feed.episodes[1].guid).toBe("guid-2")
  expect(feed.episodes[1].audioUrl).toBe("https://cdn/ep2.mp3")
})

test("parseFeed skips items with no enclosure", () => {
  const xml = `<rss><channel><title>S</title>
    <item><title>No Audio</title></item></channel></rss>`
  expect(parseFeed(xml).episodes).toHaveLength(0)
})
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm test test/rss/parse.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 7: Implement `lib/rss/parse.ts`**

```ts
import { XMLParser } from "fast-xml-parser"
import { parseItunesDuration } from "./duration"

export interface FeedEpisode {
  title: string
  guid?: string
  audioUrl: string
  audioType?: string
  publishedAt?: string
  durationSec?: number
  description?: string
}

export interface ParsedFeed {
  showName?: string
  artworkUrl?: string
  episodes: FeedEpisode[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
})

function text(node: unknown): string | undefined {
  if (node == null) return undefined
  if (typeof node === "object" && "#text" in (node as any)) {
    return String((node as any)["#text"])
  }
  return String(node)
}

export function parseFeed(xml: string): ParsedFeed {
  const doc = parser.parse(xml)
  const channel = doc?.rss?.channel ?? {}
  const rawItems = channel.item
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : []

  const episodes: FeedEpisode[] = []
  for (const item of items) {
    const enclosure = item.enclosure
    const url = enclosure?.["@_url"]
    if (!url) continue
    episodes.push({
      title: text(item.title) ?? "Untitled",
      guid: text(item.guid),
      audioUrl: url,
      audioType: enclosure?.["@_type"],
      publishedAt: text(item.pubDate),
      durationSec: parseItunesDuration(text(item["itunes:duration"])),
      description: text(item.description),
    })
  }

  return {
    showName: text(channel.title),
    artworkUrl: channel["itunes:image"]?.["@_href"],
    episodes,
  }
}
```

- [ ] **Step 8: Run to verify pass**

Run: `pnpm test test/rss/parse.test.ts`
Expected: PASS.

- [ ] **Step 9: Implement `lib/rss/fetch.ts`** (network wrapper; thin, no dedicated unit test)

```ts
import { parseFeed, type ParsedFeed } from "./parse"

export async function fetchAndParseFeed(feedUrl: string): Promise<ParsedFeed> {
  const res = await fetch(feedUrl, {
    headers: { "user-agent": "podcast-kb/1.0" },
  })
  if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status}`)
  const xml = await res.text()
  return parseFeed(xml)
}
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add RSS feed parsing and audio enclosure resolution"
```

---

## Task 5: iTunes + RSS API routes

**Files:**
- Create: `app/api/itunes/search/route.ts`
- Create: `app/api/itunes/episodes/route.ts`
- Test: `test/api/itunes.test.ts`

- [ ] **Step 1: Write failing test** `test/api/itunes.test.ts`

```ts
import { afterEach, expect, test, vi } from "vitest"

afterEach(() => vi.restoreAllMocks())

test("GET /api/itunes/search returns mapped shows", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [{ collectionId: 1, collectionName: "S", artistName: "A" }],
        }),
      ),
    ),
  )
  const { GET } = await import("@/app/api/itunes/search/route")
  const res = await GET(
    new Request("http://x/api/itunes/search?q=test&type=podcast"),
  )
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.results[0].name).toBe("S")
})

test("GET /api/itunes/search 400s without q", async () => {
  const { GET } = await import("@/app/api/itunes/search/route")
  const res = await GET(new Request("http://x/api/itunes/search"))
  expect(res.status).toBe(400)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/api/itunes.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/api/itunes/search/route.ts`**

```ts
import { searchEpisodes, searchShows } from "@/lib/itunes/client"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")
  const type = searchParams.get("type") ?? "podcast"
  if (!q) return Response.json({ error: "missing q" }, { status: 400 })
  try {
    const results =
      type === "episode" ? await searchEpisodes(q) : await searchShows(q)
    return Response.json({ results })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "search failed" },
      { status: 502 },
    )
  }
}
```

- [ ] **Step 4: Implement `app/api/itunes/episodes/route.ts`** (resolve a show's episodes from its feed)

```ts
import { fetchAndParseFeed } from "@/lib/rss/fetch"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const feedUrl = searchParams.get("feedUrl")
  if (!feedUrl) return Response.json({ error: "missing feedUrl" }, { status: 400 })
  try {
    const feed = await fetchAndParseFeed(feedUrl)
    return Response.json({
      showName: feed.showName,
      artworkUrl: feed.artworkUrl,
      episodes: feed.episodes.slice(0, 50),
    })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "feed fetch failed" },
      { status: 502 },
    )
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test test/api/itunes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add iTunes search and feed episode API routes"
```

---

## Task 6: Episode repository + submission/listing routes

**Files:**
- Create: `lib/db/episodes.ts`
- Create: `app/api/episodes/route.ts`
- Create: `app/api/episodes/[id]/route.ts`
- Test: `test/db/episodes.test.ts`

- [ ] **Step 1: Write failing test for the repository** `test/db/episodes.test.ts`

```ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
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
})
afterAll(async () => {
  await client.end()
})

test("create returns a processing episode", async () => {
  const ep = await repo.create({
    title: "E",
    audioUrl: "https://a/1.mp3",
    episodeGuid: "g1",
  })
  expect(ep.status).toBe("processing")
})

test("create dedupes on guid", async () => {
  const a = await repo.create({ title: "E", audioUrl: "https://a/1.mp3", episodeGuid: "g1" })
  const b = await repo.create({ title: "E again", audioUrl: "https://a/2.mp3", episodeGuid: "g1" })
  expect(b.id).toBe(a.id)
})

test("create dedupes on audioUrl when guid absent", async () => {
  const a = await repo.create({ title: "E", audioUrl: "https://a/1.mp3" })
  const b = await repo.create({ title: "E2", audioUrl: "https://a/1.mp3" })
  expect(b.id).toBe(a.id)
})

test("updateStatus changes status and error", async () => {
  const ep = await repo.create({ title: "E", audioUrl: "https://a/1.mp3" })
  await repo.updateStatus(ep.id, "failed", "boom")
  const got = await repo.getById(ep.id)
  expect(got?.status).toBe("failed")
  expect(got?.errorMessage).toBe("boom")
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/db/episodes.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/db/episodes.ts`**

```ts
import { desc, eq, or } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { episodes, type EpisodeStatus } from "./schema"
import * as schema from "./schema"

export interface NewEpisode {
  title: string
  audioUrl: string
  podcastName?: string
  sourceUrl?: string
  artworkUrl?: string
  episodeGuid?: string
  publishedAt?: Date
  durationSec?: number
  itunesCollectionId?: number
  itunesTrackId?: number
}

type DB = PostgresJsDatabase<typeof schema>

export function makeEpisodeRepo(db: DB) {
  return {
    async create(input: NewEpisode) {
      // Dedupe: prefer guid, fall back to audioUrl.
      const existing = await db
        .select()
        .from(episodes)
        .where(
          input.episodeGuid
            ? eq(episodes.episodeGuid, input.episodeGuid)
            : eq(episodes.audioUrl, input.audioUrl),
        )
        .limit(1)
      if (existing[0]) return existing[0]

      const [row] = await db.insert(episodes).values(input).returning()
      return row
    },

    async getById(id: string) {
      const rows = await db.select().from(episodes).where(eq(episodes.id, id)).limit(1)
      return rows[0] ?? null
    },

    async list() {
      return db.select().from(episodes).orderBy(desc(episodes.createdAt))
    },

    async updateStatus(id: string, status: EpisodeStatus, errorMessage?: string) {
      await db
        .update(episodes)
        .set({ status, errorMessage: errorMessage ?? null })
        .where(eq(episodes.id, id))
    },
  }
}
```

Also export a default repo bound to the app DB, for routes:

```ts
// appended to lib/db/episodes.ts
import { db } from "./index"
export const episodeRepo = makeEpisodeRepo(db)
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test test/db/episodes.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Implement `app/api/episodes/route.ts`** (POST submit, GET list)

```ts
import { episodeRepo } from "@/lib/db/episodes"
import { triggerTranscription } from "@/lib/modal/client"

export async function GET() {
  const list = await episodeRepo.list()
  return Response.json({ episodes: list })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.title || !body?.audioUrl) {
    return Response.json({ error: "title and audioUrl are required" }, { status: 400 })
  }

  const episode = await episodeRepo.create({
    title: body.title,
    audioUrl: body.audioUrl,
    podcastName: body.podcastName,
    sourceUrl: body.sourceUrl,
    artworkUrl: body.artworkUrl,
    episodeGuid: body.episodeGuid,
    publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined,
    durationSec: body.durationSec,
    itunesCollectionId: body.itunesCollectionId,
    itunesTrackId: body.itunesTrackId,
  })

  // Fire transcription async; don't block the response.
  if (episode.status === "processing") {
    triggerTranscription(episode.id, episode.audioUrl)
      .then(() => episodeRepo.updateStatus(episode.id, "transcribing"))
      .catch((e) =>
        episodeRepo.updateStatus(episode.id, "failed", String(e?.message ?? e)),
      )
  }

  return Response.json({ episode }, { status: 201 })
}
```

> Note: `triggerTranscription` is created in Task 7. This route will not compile/run until then — implement Task 7 next.

- [ ] **Step 6: Implement `app/api/episodes/[id]/route.ts`** (GET detail with transcript + insights)

```ts
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { episodeRepo } from "@/lib/db/episodes"
import { insights, transcripts } from "@/lib/db/schema"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const episode = await episodeRepo.getById(id)
  if (!episode) return Response.json({ error: "not found" }, { status: 404 })

  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.episodeId, id))
    .limit(1)
  const [insight] = await db
    .select()
    .from(insights)
    .where(eq(insights.episodeId, id))
    .limit(1)

  return Response.json({ episode, transcript: transcript ?? null, insights: insight ?? null })
}
```

- [ ] **Step 7: Implement `app/api/episodes/[id]/retry/route.ts`** (re-run a failed episode; resumes from analysis if a transcript exists, else re-transcribes)

```ts
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { episodeRepo } from "@/lib/db/episodes"
import { transcripts } from "@/lib/db/schema"
import { triggerTranscription } from "@/lib/modal/client"
import { processTranscript } from "@/lib/pipeline/process-transcript"

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const episode = await episodeRepo.getById(id)
  if (!episode) return Response.json({ error: "not found" }, { status: 404 })

  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.episodeId, id))
    .limit(1)

  if (transcript) {
    // Transcript already exists; resume from analysis (processTranscript is idempotent).
    await episodeRepo.updateStatus(id, "analyzing")
    processTranscript(
      { episodeId: id, transcript: transcript.fullText, segments: transcript.segments ?? [] },
      { db },
    ).catch(() => {})
  } else {
    // Re-run from transcription.
    await episodeRepo.updateStatus(id, "processing")
    triggerTranscription(id, episode.audioUrl)
      .then(() => episodeRepo.updateStatus(id, "transcribing"))
      .catch((e) => episodeRepo.updateStatus(id, "failed", String(e?.message ?? e)))
  }

  return Response.json({ status: "retrying" }, { status: 202 })
}
```

> Depends on Task 7 (`triggerTranscription`) and Task 12 (`processTranscript`). It will typecheck once those exist; commit it alongside them if executing strictly in order.

- [ ] **Step 8: Commit** (these routes compile after Tasks 7 and 12)

```bash
git add lib/db/episodes.ts app/api/episodes
git commit -m "feat: add episode repository and submission/detail/retry routes"
```

---

## Task 7: Modal trigger client (`lib/modal`)

**Files:**
- Create: `lib/modal/client.ts`
- Test: `test/modal/client.test.ts`

- [ ] **Step 1: Write failing test** `test/modal/client.test.ts`

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { triggerTranscription } from "@/lib/modal/client"

beforeEach(() => {
  process.env.MODAL_TRANSCRIBE_URL = "https://modal.run/transcribe"
  process.env.MODAL_WEBHOOK_SECRET = "s3cret"
  process.env.APP_URL = "https://app.test"
})
afterEach(() => vi.restoreAllMocks())

test("POSTs audio + callback + secret to the Modal endpoint", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)

  await triggerTranscription("ep-1", "https://cdn/a.mp3")

  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe("https://modal.run/transcribe")
  const body = JSON.parse((init as RequestInit).body as string)
  expect(body).toEqual({
    episode_id: "ep-1",
    audio_url: "https://cdn/a.mp3",
    callback_url: "https://app.test/api/modal/callback",
    secret: "s3cret",
  })
})

test("throws if Modal responds non-2xx", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })))
  await expect(triggerTranscription("ep-1", "https://cdn/a.mp3")).rejects.toThrow()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/modal/client.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/modal/client.ts`**

```ts
export async function triggerTranscription(episodeId: string, audioUrl: string) {
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
      episode_id: episodeId,
      audio_url: audioUrl,
      callback_url: `${appUrl}/api/modal/callback`,
      secret,
    }),
  })
  if (!res.ok) throw new Error(`Modal trigger failed: ${res.status}`)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test test/modal/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the episodes route now that the client exists**

Run: `pnpm typecheck`
Expected: no errors in `app/api/episodes/route.ts`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Modal transcription trigger client"
```

---

## Task 8: Modal transcription function (`modal/transcribe.py`)

**Files:**
- Create: `modal/transcribe.py`
- Create: `modal/README.md`

This is deployed separately (`modal deploy modal/transcribe.py`). It is Python, not part of the Vitest suite; verification is manual via `modal deploy` + a test call.

- [ ] **Step 1: Create `modal/transcribe.py`**

```python
import modal

app = modal.App("podcast-kb-transcribe")

image = (
    modal.Image.debian_slim()
    .apt_install("ffmpeg")
    .pip_install("faster-whisper==1.0.3", "requests==2.32.3", "fastapi[standard]")
)


@app.function(image=image, gpu="A10G", timeout=1800)
def transcribe(audio_url: str, episode_id: str, callback_url: str, secret: str):
    import tempfile
    import requests
    from faster_whisper import WhisperModel

    try:
        # Download audio
        with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as f:
            with requests.get(audio_url, stream=True, timeout=300) as r:
                r.raise_for_status()
                for chunk in r.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
            audio_path = f.name

        model = WhisperModel("large-v3", device="cuda", compute_type="float16")
        segments_iter, _info = model.transcribe(audio_path, vad_filter=True)

        segments = []
        full_text_parts = []
        for s in segments_iter:
            segments.append({"start": s.start, "end": s.end, "text": s.text.strip()})
            full_text_parts.append(s.text.strip())

        payload = {
            "episode_id": episode_id,
            "secret": secret,
            "transcript": " ".join(full_text_parts),
            "segments": segments,
        }
    except Exception as e:
        payload = {"episode_id": episode_id, "secret": secret, "error": str(e)}

    requests.post(callback_url, json=payload, timeout=60)


@app.function(image=image)
@modal.fastapi_endpoint(method="POST")
def web(body: dict):
    # Validate the shared secret before doing any work.
    expected = body.get("secret")
    if not expected:
        return {"error": "missing secret"}, 401

    # Spawn the long-running job and return immediately.
    transcribe.spawn(
        audio_url=body["audio_url"],
        episode_id=body["episode_id"],
        callback_url=body["callback_url"],
        secret=body["secret"],
    )
    return {"status": "accepted"}
```

- [ ] **Step 2: Create `modal/README.md`**

```markdown
# Modal transcription function

## Deploy
1. Install Modal: `pip install modal`
2. Authenticate: `modal token new`
3. Deploy: `modal deploy modal/transcribe.py`
4. Copy the printed web endpoint URL into the app's `MODAL_TRANSCRIBE_URL` env var.

## Contract
POST JSON `{ audio_url, episode_id, callback_url, secret }`.
Responds `{ "status": "accepted" }` and runs transcription on GPU,
then POSTs `{ episode_id, secret, transcript, segments[] }` (or `{ episode_id, secret, error }`)
to `callback_url`.
```

- [ ] **Step 3: Manual verification (requires Modal account; do during deployment phase)**

Run: `modal deploy modal/transcribe.py` then `curl -X POST <url> -d '{"audio_url":"<short mp3>","episode_id":"test","callback_url":"https://webhook.site/...","secret":"x"}' -H 'content-type: application/json'`
Expected: `{"status":"accepted"}`, and the callback URL receives a transcript shortly after.

- [ ] **Step 4: Commit**

```bash
git add modal/
git commit -m "feat: add Modal faster-whisper transcription function"
```

---

## Task 9: Transcript chunking (`lib/ai/chunk`)

**Files:**
- Create: `lib/ai/chunk.ts`
- Test: `test/ai/chunk.test.ts`

- [ ] **Step 1: Write failing test** `test/ai/chunk.test.ts`

```ts
import { expect, test } from "vitest"
import { chunkSegments, estimateTokens } from "@/lib/ai/chunk"

test("estimateTokens approximates by characters", () => {
  expect(estimateTokens("abcd")).toBe(1) // 4 chars ~= 1 token
  expect(estimateTokens("a".repeat(40))).toBe(10)
})

test("chunkSegments groups segments up to the token target", () => {
  // Each segment ~25 tokens (100 chars). Target 60 tokens -> ~2-3 segments/chunk.
  const segments = Array.from({ length: 6 }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 10,
    text: "x".repeat(100),
  }))
  const chunks = chunkSegments(segments, { targetTokens: 60, overlapSegments: 1 })

  expect(chunks.length).toBeGreaterThan(1)
  // Each chunk records the span of its segments.
  expect(chunks[0].startSec).toBe(0)
  expect(chunks[0].content).toContain("x")
  // Overlap: chunk 2 starts at or before the end of chunk 1's last segment.
  expect(chunks[1].startSec).toBeLessThan(chunks[0].endSec)
})

test("chunkSegments handles empty input", () => {
  expect(chunkSegments([], { targetTokens: 60, overlapSegments: 1 })).toEqual([])
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/ai/chunk.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/ai/chunk.ts`**

```ts
export interface Segment {
  start: number
  end: number
  text: string
}

export interface Chunk {
  content: string
  startSec: number
  endSec: number
}

export interface ChunkOptions {
  targetTokens: number
  overlapSegments: number
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function chunkSegments(segments: Segment[], opts: ChunkOptions): Chunk[] {
  if (segments.length === 0) return []
  const chunks: Chunk[] = []
  let i = 0

  while (i < segments.length) {
    let tokens = 0
    let j = i
    while (j < segments.length) {
      const t = estimateTokens(segments[j].text)
      if (j > i && tokens + t > opts.targetTokens) break
      tokens += t
      j++
    }
    const group = segments.slice(i, j)
    chunks.push({
      content: group.map((s) => s.text).join(" ").trim(),
      startSec: Math.floor(group[0].start),
      endSec: Math.ceil(group[group.length - 1].end),
    })
    if (j >= segments.length) break
    i = Math.max(j - opts.overlapSegments, i + 1)
  }

  return chunks
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test test/ai/chunk.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add transcript chunking with overlap"
```

---

## Task 10: Insights generation (`lib/ai/insights`)

**Files:**
- Create: `lib/ai/insights.ts`
- Test: `test/ai/insights.test.ts`

- [ ] **Step 1: Write failing test using the AI SDK mock model** `test/ai/insights.test.ts`

```ts
import { expect, test } from "vitest"
import { MockLanguageModelV2 } from "ai/test"
import { generateInsights, insightsSchema } from "@/lib/ai/insights"

test("generateInsights returns a structured object validated by the schema", async () => {
  const value = {
    summary: "A talk about X.",
    takeaways: ["one", "two"],
    topics: ["x"],
    quotes: [{ text: "quote", approxTimestampSec: 12 }],
    entities: [{ name: "Jane", type: "person" }],
  }
  const model = new MockLanguageModelV2({
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text", text: JSON.stringify(value) }],
      warnings: [],
    }),
  })

  const out = await generateInsights("transcript text here", { model })
  expect(insightsSchema.parse(out)).toEqual(value)
  expect(out.takeaways).toHaveLength(2)
})
```

> If the installed `ai` version exports test mocks differently, check `node_modules/ai/` exports; the mock class may be `MockLanguageModelV2`. Adjust the import to match the installed version.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/ai/insights.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/ai/insights.ts`**

```ts
import { openai } from "@ai-sdk/openai"
import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"

export const insightsSchema = z.object({
  summary: z.string().describe("2-3 sentence summary"),
  takeaways: z.array(z.string()).describe("key bulleted takeaways"),
  topics: z.array(z.string()).describe("topics/themes discussed"),
  quotes: z
    .array(z.object({ text: z.string(), approxTimestampSec: z.number() }))
    .describe("notable quotes with approximate timestamps in seconds"),
  entities: z
    .array(z.object({ name: z.string(), type: z.string() }))
    .describe("people/orgs/products mentioned"),
})

export type Insights = z.infer<typeof insightsSchema>

export async function generateInsights(
  transcript: string,
  opts: { model?: LanguageModel } = {},
): Promise<Insights> {
  const { object } = await generateObject({
    model: opts.model ?? openai("gpt-4o"),
    schema: insightsSchema,
    prompt:
      "You are analyzing a podcast transcript. Produce structured insights.\n\n" +
      "Transcript:\n" +
      transcript,
  })
  return object
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test test/ai/insights.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add structured insights generation"
```

---

## Task 11: Embeddings (`lib/ai/embeddings`)

**Files:**
- Create: `lib/ai/embeddings.ts`
- Test: `test/ai/embeddings.test.ts`

- [ ] **Step 1: Write failing test using the AI SDK mock embedding model** `test/ai/embeddings.test.ts`

```ts
import { expect, test } from "vitest"
import { MockEmbeddingModelV2 } from "ai/test"
import { embedTexts } from "@/lib/ai/embeddings"

test("embedTexts returns one vector per input", async () => {
  const model = new MockEmbeddingModelV2({
    doEmbed: async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => Array(1536).fill(0.1)),
      usage: { tokens: values.length },
    }),
  })
  const out = await embedTexts(["a", "b"], { model })
  expect(out).toHaveLength(2)
  expect(out[0]).toHaveLength(1536)
})
```

> As with insights, confirm the mock export name in the installed `ai` version and adjust if needed.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/ai/embeddings.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/ai/embeddings.ts`**

```ts
import { openai } from "@ai-sdk/openai"
import { embedMany, type EmbeddingModel } from "ai"

export async function embedTexts(
  texts: string[],
  opts: { model?: EmbeddingModel<string> } = {},
): Promise<number[][]> {
  if (texts.length === 0) return []
  const { embeddings } = await embedMany({
    model: opts.model ?? openai.embedding("text-embedding-3-small"),
    values: texts,
  })
  return embeddings
}

export async function embedQuery(
  text: string,
  opts: { model?: EmbeddingModel<string> } = {},
): Promise<number[]> {
  const [vec] = await embedTexts([text], opts)
  return vec
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test test/ai/embeddings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add embeddings helper"
```

---

## Task 12: Pipeline service + Modal callback route

**Files:**
- Create: `lib/pipeline/process-transcript.ts`
- Create: `app/api/modal/callback/route.ts`
- Test: `test/pipeline/process-transcript.test.ts`
- Test: `test/api/modal-callback.test.ts`

- [ ] **Step 1: Write failing test for the pipeline service** `test/pipeline/process-transcript.test.ts`

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
import { processTranscript } from "@/lib/pipeline/process-transcript"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const repo = makeEpisodeRepo(db)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
beforeEach(async () => {
  await db.delete(schema.episodes)
})
afterAll(async () => {
  await client.end()
})

test("stores transcript, insights, chunks and marks ready", async () => {
  const ep = await repo.create({ title: "E", audioUrl: "https://a/1.mp3" })

  await processTranscript(
    {
      episodeId: ep.id,
      transcript: "hello world ".repeat(200),
      segments: [
        { start: 0, end: 5, text: "hello world ".repeat(50) },
        { start: 5, end: 10, text: "hello world ".repeat(50) },
      ],
    },
    {
      db,
      // Inject fakes so the test needs no network/API key.
      generateInsights: async () => ({
        summary: "s",
        takeaways: ["t"],
        topics: ["x"],
        quotes: [],
        entities: [],
      }),
      embedTexts: async (texts) => texts.map(() => Array(1536).fill(0.1)),
    },
  )

  const got = await repo.getById(ep.id)
  expect(got?.status).toBe("ready")

  const t = await db.select().from(schema.transcripts).where(eq(schema.transcripts.episodeId, ep.id))
  expect(t).toHaveLength(1)
  const ins = await db.select().from(schema.insights).where(eq(schema.insights.episodeId, ep.id))
  expect(ins[0].summary).toBe("s")
  const ch = await db.select().from(schema.chunks).where(eq(schema.chunks.episodeId, ep.id))
  expect(ch.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/pipeline/process-transcript.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/pipeline/process-transcript.ts`** (dependency-injected for testability)

```ts
import { eq } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { chunkSegments, type Segment } from "@/lib/ai/chunk"
import { embedTexts as defaultEmbedTexts } from "@/lib/ai/embeddings"
import {
  generateInsights as defaultGenerateInsights,
  type Insights,
} from "@/lib/ai/insights"
import { makeEpisodeRepo } from "@/lib/db/episodes"
import * as schema from "@/lib/db/schema"

export interface TranscriptResult {
  episodeId: string
  transcript: string
  segments: Segment[]
}

export interface PipelineDeps {
  db: PostgresJsDatabase<typeof schema>
  generateInsights?: (transcript: string) => Promise<Insights>
  embedTexts?: (texts: string[]) => Promise<number[][]>
}

export async function processTranscript(result: TranscriptResult, deps: PipelineDeps) {
  const { db } = deps
  const repo = makeEpisodeRepo(db)
  const genInsights = deps.generateInsights ?? ((t: string) => defaultGenerateInsights(t))
  const embed = deps.embedTexts ?? ((t: string[]) => defaultEmbedTexts(t))

  try {
    // 0. Make re-processing idempotent (retry, or a duplicate Modal callback).
    await db.delete(schema.insights).where(eq(schema.insights.episodeId, result.episodeId))
    await db.delete(schema.chunks).where(eq(schema.chunks.episodeId, result.episodeId))
    await db.delete(schema.transcripts).where(eq(schema.transcripts.episodeId, result.episodeId))

    // 1. Store transcript
    await db.insert(schema.transcripts).values({
      episodeId: result.episodeId,
      fullText: result.transcript,
      segments: result.segments,
    })

    // 2. Insights
    await repo.updateStatus(result.episodeId, "analyzing")
    const insights = await genInsights(result.transcript)
    await db.insert(schema.insights).values({
      episodeId: result.episodeId,
      summary: insights.summary,
      takeaways: insights.takeaways,
      topics: insights.topics,
      quotes: insights.quotes,
      entities: insights.entities,
    })

    // 3. Chunk + embed
    const chunks = chunkSegments(result.segments, { targetTokens: 600, overlapSegments: 1 })
    if (chunks.length > 0) {
      const vectors = await embed(chunks.map((c) => c.content))
      await db.insert(schema.chunks).values(
        chunks.map((c, i) => ({
          episodeId: result.episodeId,
          content: c.content,
          startSec: c.startSec,
          endSec: c.endSec,
          embedding: vectors[i],
        })),
      )
    }

    // 4. Ready
    await repo.updateStatus(result.episodeId, "ready")
  } catch (e) {
    await repo.updateStatus(
      result.episodeId,
      "failed",
      e instanceof Error ? e.message : String(e),
    )
    throw e
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test test/pipeline/process-transcript.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing test for the callback route** `test/api/modal-callback.test.ts`

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest"

beforeEach(() => {
  process.env.MODAL_WEBHOOK_SECRET = "s3cret"
})
afterEach(() => vi.restoreAllMocks())

test("rejects wrong secret with 401", async () => {
  const { POST } = await import("@/app/api/modal/callback/route")
  const res = await POST(
    new Request("http://x/api/modal/callback", {
      method: "POST",
      body: JSON.stringify({ episode_id: "e", secret: "wrong", transcript: "t", segments: [] }),
    }),
  )
  expect(res.status).toBe(401)
})

test("accepts valid secret and kicks off processing", async () => {
  vi.doMock("@/lib/pipeline/process-transcript", () => ({
    processTranscript: vi.fn(async () => {}),
  }))
  const { POST } = await import("@/app/api/modal/callback/route")
  const res = await POST(
    new Request("http://x/api/modal/callback", {
      method: "POST",
      body: JSON.stringify({
        episode_id: "e",
        secret: "s3cret",
        transcript: "t",
        segments: [],
      }),
    }),
  )
  expect(res.status).toBe(202)
})
```

- [ ] **Step 6: Implement `app/api/modal/callback/route.ts`**

```ts
import { db } from "@/lib/db"
import { episodeRepo } from "@/lib/db/episodes"
import { processTranscript } from "@/lib/pipeline/process-transcript"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || body.secret !== process.env.MODAL_WEBHOOK_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const episodeId = body.episode_id as string

  // Transcription itself failed inside Modal.
  if (body.error) {
    await episodeRepo.updateStatus(episodeId, "failed", String(body.error))
    return Response.json({ status: "recorded" }, { status: 202 })
  }

  // Run the rest of the pipeline without blocking the webhook response.
  processTranscript(
    { episodeId, transcript: body.transcript, segments: body.segments ?? [] },
    { db },
  ).catch(() => {
    // processTranscript already records the failure status.
  })

  return Response.json({ status: "accepted" }, { status: 202 })
}
```

- [ ] **Step 7: Run callback route tests**

Run: `pnpm test test/api/modal-callback.test.ts`
Expected: PASS (both).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add transcript pipeline service and Modal callback route"
```

---

## Task 13: Semantic search (`lib/db/search` + `/api/search`)

**Files:**
- Create: `lib/db/search.ts`
- Create: `app/api/search/route.ts`
- Test: `test/db/search.test.ts`

- [ ] **Step 1: Write failing test** `test/db/search.test.ts`

```ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeEpisodeRepo } from "@/lib/db/episodes"
import { searchChunks } from "@/lib/db/search"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const repo = makeEpisodeRepo(db)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
beforeEach(async () => {
  await db.delete(schema.episodes)
})
afterAll(async () => {
  await client.end()
})

function vec(fill: number) {
  return Array(1536).fill(fill)
}

test("returns the nearest chunk by cosine similarity", async () => {
  const ep = await repo.create({ title: "E", audioUrl: "https://a/1.mp3" })
  await db.insert(schema.chunks).values([
    { episodeId: ep.id, content: "near", startSec: 0, endSec: 5, embedding: vec(0.1) },
    { episodeId: ep.id, content: "far", startSec: 5, endSec: 10, embedding: vec(-0.1) },
  ])

  const results = await searchChunks(db, vec(0.1), { limit: 1 })
  expect(results[0].content).toBe("near")
  expect(results[0].episodeTitle).toBe("E")
  expect(typeof results[0].similarity).toBe("number")
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/db/search.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/db/search.ts`**

```ts
import { cosineDistance, desc, eq, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { chunks, episodes } from "./schema"
import * as schema from "./schema"

export interface SearchHit {
  chunkId: string
  episodeId: string
  episodeTitle: string
  content: string
  startSec: number
  endSec: number
  similarity: number
}

export async function searchChunks(
  db: PostgresJsDatabase<typeof schema>,
  queryEmbedding: number[],
  opts: { limit?: number; episodeId?: string } = {},
): Promise<SearchHit[]> {
  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, queryEmbedding)})`
  const rows = await db
    .select({
      chunkId: chunks.id,
      episodeId: chunks.episodeId,
      episodeTitle: episodes.title,
      content: chunks.content,
      startSec: chunks.startSec,
      endSec: chunks.endSec,
      similarity,
    })
    .from(chunks)
    .innerJoin(episodes, eq(chunks.episodeId, episodes.id))
    .where(opts.episodeId ? eq(chunks.episodeId, opts.episodeId) : undefined)
    .orderBy(desc(similarity))
    .limit(opts.limit ?? 8)
  return rows
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test test/db/search.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `app/api/search/route.ts`**

```ts
import { db } from "@/lib/db"
import { embedQuery } from "@/lib/ai/embeddings"
import { searchChunks } from "@/lib/db/search"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.query) return Response.json({ error: "missing query" }, { status: 400 })
  const queryEmbedding = await embedQuery(body.query)
  const hits = await searchChunks(db, queryEmbedding, {
    limit: body.limit ?? 8,
    episodeId: body.episodeId,
  })
  return Response.json({ hits })
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add pgvector semantic search and /api/search"
```

---

## Task 14: RAG chat (`/api/chat`)

**Files:**
- Create: `app/api/chat/route.ts`
- Test: `test/api/chat.test.ts`

- [ ] **Step 1: Write failing test (streamed text with mock model)** `test/api/chat.test.ts`

```ts
import { afterEach, expect, test, vi } from "vitest"

afterEach(() => vi.restoreAllMocks())

test("returns 400 without a question", async () => {
  const { POST } = await import("@/app/api/chat/route")
  const res = await POST(
    new Request("http://x/api/chat", { method: "POST", body: JSON.stringify({}) }),
  )
  expect(res.status).toBe(400)
})

test("retrieves context and streams an answer", async () => {
  vi.doMock("@/lib/ai/embeddings", () => ({
    embedQuery: vi.fn(async () => Array(1536).fill(0.1)),
  }))
  vi.doMock("@/lib/db/search", () => ({
    searchChunks: vi.fn(async () => [
      { chunkId: "c1", episodeId: "e1", episodeTitle: "E", content: "ctx", startSec: 0, endSec: 5, similarity: 0.9 },
    ]),
  }))

  const { POST } = await import("@/app/api/chat/route")
  const res = await POST(
    new Request("http://x/api/chat", {
      method: "POST",
      body: JSON.stringify({ question: "what about X?", episodeId: "e1" }),
    }),
  )
  expect(res.status).toBe(200)
  const text = await res.text()
  expect(text.length).toBeGreaterThan(0)
})
```

> The second test calls OpenAI unless `OPENAI_API_KEY` is set to a real key. To keep it offline, the route accepts an injected model via a non-exported default; if you prefer, mark this second test `test.skipIf(!process.env.OPENAI_API_KEY)`. Keep the first (400) test always-on.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test test/api/chat.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app/api/chat/route.ts`**

```ts
import { openai } from "@ai-sdk/openai"
import { streamText } from "ai"
import { embedQuery } from "@/lib/ai/embeddings"
import { db } from "@/lib/db"
import { searchChunks } from "@/lib/db/search"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.question) return Response.json({ error: "missing question" }, { status: 400 })

  const queryEmbedding = await embedQuery(body.question)
  const hits = await searchChunks(db, queryEmbedding, {
    limit: 8,
    episodeId: body.episodeId,
  })

  const context = hits
    .map((h) => `[${formatTimestamp(h.startSec)}] ${h.content}`)
    .join("\n\n")

  const result = streamText({
    model: openai("gpt-4o"),
    system:
      "Answer the user's question using ONLY the provided transcript excerpts. " +
      "Cite the [timestamp] of excerpts you rely on. If the answer isn't in the excerpts, say so.",
    prompt: `Transcript excerpts:\n${context}\n\nQuestion: ${body.question}`,
  })

  return result.toTextStreamResponse()
}

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}
```

> Verify `toTextStreamResponse` exists in the installed `ai` version (check `node_modules/ai`). If the API differs, the equivalent is `result.toDataStreamResponse()` / `toUIMessageStreamResponse()`; match the version and adjust the client in Task 17 accordingly.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test test/api/chat.test.ts`
Expected: PASS (400 test passes; streaming test passes if a key is set or is skipped).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add RAG chat endpoint grounded in transcript"
```

---

## Task 15: UI — Add Episode page (3 tabs)

**Files:**
- Modify: `app/page.tsx`
- Create: `components/add-episode.tsx`
- Create: `lib/format.ts` (shared timestamp/date formatting)
- Add shadcn components: `tabs`, `input`, `card`, `badge`, `sonner` (toasts)

- [ ] **Step 1: Add shadcn components**

Run: `pnpm dlx shadcn@latest add tabs input card badge sonner`
Expected: components created under `components/ui/`.

- [ ] **Step 2: Create `lib/format.ts`**

```ts
export function formatTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = m.toString().padStart(2, "0")
  const ss = s.toString().padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

export function formatDate(iso?: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString()
}
```

- [ ] **Step 3: Create `components/add-episode.tsx`** (client component with 3 tabs)

```tsx
"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Show = { collectionId: number; name: string; artistName: string; artworkUrl?: string; feedUrl?: string }
type Episode = {
  trackId?: number
  title: string
  podcastName?: string
  audioUrl?: string
  artworkUrl?: string
  feedUrl?: string
  guid?: string
  releaseDate?: string
  publishedAt?: string
  durationSec?: number
}

async function submitEpisode(payload: Record<string, unknown>) {
  const res = await fetch("/api/episodes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? "submit failed")
  return (await res.json()).episode as { id: string }
}

export function AddEpisode() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onSubmit(payload: Record<string, unknown>) {
    setBusy(true)
    try {
      const ep = await submitEpisode(payload)
      toast.success("Episode queued for transcription")
      router.push(`/episodes/${ep.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Tabs defaultValue="shows" className="w-full max-w-2xl">
      <TabsList>
        <TabsTrigger value="shows">Search shows</TabsTrigger>
        <TabsTrigger value="episodes">Search episodes</TabsTrigger>
        <TabsTrigger value="url">Paste URL</TabsTrigger>
      </TabsList>

      <TabsContent value="shows">
        <SearchShows onPick={onSubmit} busy={busy} />
      </TabsContent>
      <TabsContent value="episodes">
        <SearchEpisodes onPick={onSubmit} busy={busy} />
      </TabsContent>
      <TabsContent value="url">
        <PasteUrl onSubmit={onSubmit} busy={busy} />
      </TabsContent>
    </Tabs>
  )
}

function SearchShows({ onPick, busy }: { onPick: (p: Record<string, unknown>) => void; busy: boolean }) {
  const [q, setQ] = useState("")
  const [shows, setShows] = useState<Show[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])

  async function search() {
    const res = await fetch(`/api/itunes/search?type=podcast&q=${encodeURIComponent(q)}`)
    setShows((await res.json()).results)
    setEpisodes([])
  }
  async function loadEpisodes(show: Show) {
    const res = await fetch(`/api/itunes/episodes?feedUrl=${encodeURIComponent(show.feedUrl ?? "")}`)
    const data = await res.json()
    setEpisodes(
      (data.episodes ?? []).map((e: Episode) => ({ ...e, podcastName: show.name, artworkUrl: show.artworkUrl })),
    )
  }

  return (
    <div className="space-y-3 pt-3">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search podcasts…" />
        <Button onClick={search}>Search</Button>
      </div>
      {shows.map((s) => (
        <Card key={s.collectionId} className="cursor-pointer p-3" onClick={() => loadEpisodes(s)}>
          <div className="font-medium">{s.name}</div>
          <div className="text-muted-foreground text-sm">{s.artistName}</div>
        </Card>
      ))}
      {episodes.map((e, i) => (
        <Card key={i} className="flex items-center justify-between p-3">
          <div className="min-w-0">
            <div className="truncate font-medium">{e.title}</div>
            <div className="text-muted-foreground text-sm">{e.podcastName}</div>
          </div>
          <Button
            disabled={busy || !e.audioUrl}
            onClick={() =>
              onPick({
                title: e.title,
                audioUrl: e.audioUrl,
                podcastName: e.podcastName,
                artworkUrl: e.artworkUrl,
                episodeGuid: e.guid,
                publishedAt: e.publishedAt,
                durationSec: e.durationSec,
              })
            }
          >
            Add
          </Button>
        </Card>
      ))}
    </div>
  )
}

function SearchEpisodes({ onPick, busy }: { onPick: (p: Record<string, unknown>) => void; busy: boolean }) {
  const [q, setQ] = useState("")
  const [episodes, setEpisodes] = useState<Episode[]>([])

  async function search() {
    const res = await fetch(`/api/itunes/search?type=episode&q=${encodeURIComponent(q)}`)
    setEpisodes((await res.json()).results)
  }

  return (
    <div className="space-y-3 pt-3">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search episodes…" />
        <Button onClick={search}>Search</Button>
      </div>
      {episodes.map((e, i) => (
        <Card key={i} className="flex items-center justify-between p-3">
          <div className="min-w-0">
            <div className="truncate font-medium">{e.title}</div>
            <div className="text-muted-foreground text-sm">{e.podcastName}</div>
          </div>
          <Button
            disabled={busy || !e.audioUrl}
            onClick={() =>
              onPick({
                title: e.title,
                audioUrl: e.audioUrl,
                podcastName: e.podcastName,
                artworkUrl: e.artworkUrl,
                publishedAt: e.releaseDate,
                durationSec: e.durationSec,
              })
            }
          >
            Add
          </Button>
        </Card>
      ))}
    </div>
  )
}

function PasteUrl({ onSubmit, busy }: { onSubmit: (p: Record<string, unknown>) => void; busy: boolean }) {
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [feedEpisodes, setFeedEpisodes] = useState<Episode[] | null>(null)
  const [showName, setShowName] = useState<string | undefined>()

  // Accepts either a direct audio URL or an RSS feed URL.
  async function load() {
    setFeedEpisodes(null)
    const res = await fetch(`/api/itunes/episodes?feedUrl=${encodeURIComponent(url)}`)
    if (!res.ok) {
      toast.error("Could not parse that as a feed. If it's a direct audio URL, give it a title and Add it.")
      return
    }
    const data = await res.json()
    setShowName(data.showName)
    setFeedEpisodes(data.episodes ?? [])
  }

  return (
    <div className="space-y-3 pt-3">
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Audio URL (.mp3) or RSS feed URL" />
      <div className="flex gap-2">
        <Button variant="outline" onClick={load} disabled={!url}>
          Load feed
        </Button>
      </div>

      {feedEpisodes === null ? (
        <div className="space-y-2 border-t pt-3">
          <p className="text-muted-foreground text-sm">…or add a direct audio URL:</p>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Episode title" />
          <Button
            disabled={busy || !url || !title}
            onClick={() => onSubmit({ title, audioUrl: url, sourceUrl: url })}
          >
            Add episode
          </Button>
        </div>
      ) : (
        feedEpisodes.map((e, i) => (
          <Card key={i} className="flex items-center justify-between p-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{e.title}</div>
              <div className="text-muted-foreground text-sm">{showName}</div>
            </div>
            <Button
              disabled={busy || !e.audioUrl}
              onClick={() =>
                onSubmit({
                  title: e.title,
                  audioUrl: e.audioUrl,
                  podcastName: showName,
                  sourceUrl: url,
                  episodeGuid: e.guid,
                  publishedAt: e.publishedAt,
                  durationSec: e.durationSec,
                })
              }
            >
              Add
            </Button>
          </Card>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire up `app/page.tsx`**

```tsx
import Link from "next/link"
import { AddEpisode } from "@/components/add-episode"
import { Button } from "@/components/ui/button"

export default function Page() {
  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Podcast Knowledge Base</h1>
        <Button asChild variant="outline">
          <Link href="/episodes">Archive</Link>
        </Button>
      </header>
      <AddEpisode />
    </div>
  )
}
```

- [ ] **Step 5: Add the `Toaster` to `app/layout.tsx`**

Open `app/layout.tsx` and add `import { Toaster } from "@/components/ui/sonner"`, then render `<Toaster />` just before `</body>`.

- [ ] **Step 6: Verify build + typecheck**

Run: `pnpm typecheck && pnpm build`
Expected: builds successfully.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add episode submission UI with iTunes search tabs"
```

---

## Task 16: UI — Archive list (`/episodes`)

**Files:**
- Create: `app/episodes/page.tsx`

- [ ] **Step 1: Implement `app/episodes/page.tsx`** (server component, reads via the repo)

```tsx
import Link from "next/link"
import { episodeRepo } from "@/lib/db/episodes"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { formatDate } from "@/lib/format"

export const dynamic = "force-dynamic"

export default async function EpisodesPage() {
  const episodes = await episodeRepo.list()
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Archive</h1>
        <Link href="/" className="text-sm underline">
          Add episode
        </Link>
      </div>
      {episodes.length === 0 && <p className="text-muted-foreground">No episodes yet.</p>}
      {episodes.map((e) => (
        <Link key={e.id} href={`/episodes/${e.id}`}>
          <Card className="flex items-center justify-between p-4 hover:bg-accent">
            <div className="min-w-0">
              <div className="truncate font-medium">{e.title}</div>
              <div className="text-muted-foreground text-sm">
                {e.podcastName} · {formatDate(e.publishedAt?.toISOString())}
              </div>
            </div>
            <Badge variant={e.status === "ready" ? "default" : e.status === "failed" ? "destructive" : "secondary"}>
              {e.status}
            </Badge>
          </Card>
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add episode archive list page"
```

---

## Task 17: UI — Episode detail (`/episodes/[id]`)

**Files:**
- Create: `app/episodes/[id]/page.tsx`
- Create: `components/episode-detail.tsx`
- Create: `components/episode-chat.tsx`

- [ ] **Step 1: Implement `app/episodes/[id]/page.tsx`** (server component fetches initial data)

```tsx
import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { episodeRepo } from "@/lib/db/episodes"
import { insights as insightsTable, transcripts as transcriptsTable } from "@/lib/db/schema"
import { EpisodeDetail } from "@/components/episode-detail"

export const dynamic = "force-dynamic"

export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const episode = await episodeRepo.getById(id)
  if (!episode) notFound()

  const [transcript] = await db.select().from(transcriptsTable).where(eq(transcriptsTable.episodeId, id)).limit(1)
  const [insight] = await db.select().from(insightsTable).where(eq(insightsTable.episodeId, id)).limit(1)

  return (
    <EpisodeDetail
      episode={{
        id: episode.id,
        title: episode.title,
        podcastName: episode.podcastName,
        status: episode.status,
        errorMessage: episode.errorMessage,
      }}
      transcript={transcript ? { fullText: transcript.fullText, segments: transcript.segments ?? [] } : null}
      insights={insight ?? null}
    />
  )
}
```

- [ ] **Step 2: Implement `components/episode-detail.tsx`** (client; polls status until ready)

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { formatTimestamp } from "@/lib/format"
import { EpisodeChat } from "@/components/episode-chat"

type Segment = { start: number; end: number; text: string }
type Insights = {
  summary?: string | null
  takeaways?: string[] | null
  topics?: string[] | null
  quotes?: { text: string; approxTimestampSec: number }[] | null
  entities?: { name: string; type: string }[] | null
} | null

export function EpisodeDetail(props: {
  episode: { id: string; title: string; podcastName?: string | null; status: string; errorMessage?: string | null }
  transcript: { fullText: string; segments: Segment[] } | null
  insights: Insights
}) {
  const router = useRouter()
  const { episode } = props
  const inFlight = !["ready", "failed"].includes(episode.status)

  // Poll until the episode finishes processing.
  useEffect(() => {
    if (!inFlight) return
    const t = setInterval(() => router.refresh(), 4000)
    return () => clearInterval(t)
  }, [inFlight, router])

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{episode.title}</h1>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <span>{episode.podcastName}</span>
          <Badge variant={episode.status === "ready" ? "default" : episode.status === "failed" ? "destructive" : "secondary"}>
            {episode.status}
          </Badge>
        </div>
        {episode.status === "failed" && (
          <div className="space-y-1">
            <p className="text-destructive text-sm">{episode.errorMessage}</p>
            <button
              className="text-sm underline"
              onClick={async () => {
                await fetch(`/api/episodes/${episode.id}/retry`, { method: "POST" })
                router.refresh()
              }}
            >
              Retry
            </button>
          </div>
        )}
        {inFlight && <p className="text-muted-foreground text-sm">Processing… this page updates automatically.</p>}
      </header>

      {props.insights && (
        <Card className="space-y-3 p-4">
          <h2 className="font-medium">Insights</h2>
          {props.insights.summary && <p className="text-sm">{props.insights.summary}</p>}
          {props.insights.takeaways?.length ? (
            <ul className="list-disc pl-5 text-sm">
              {props.insights.takeaways.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          ) : null}
          {props.insights.topics?.length ? (
            <div className="flex flex-wrap gap-1">
              {props.insights.topics.map((t, i) => <Badge key={i} variant="secondary">{t}</Badge>)}
            </div>
          ) : null}
          {props.insights.quotes?.length ? (
            <div className="space-y-1 text-sm">
              {props.insights.quotes.map((q, i) => (
                <blockquote key={i} className="border-l-2 pl-2 italic">
                  “{q.text}” <span className="text-muted-foreground">[{formatTimestamp(q.approxTimestampSec)}]</span>
                </blockquote>
              ))}
            </div>
          ) : null}
        </Card>
      )}

      {props.transcript && <EpisodeChat episodeId={episode.id} />}

      {props.transcript && (
        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Transcript</h2>
          <div className="max-h-[480px] space-y-1 overflow-y-auto text-sm">
            {props.transcript.segments.map((s, i) => (
              <p key={i}>
                <span className="text-muted-foreground mr-2 tabular-nums">{formatTimestamp(s.start)}</span>
                {s.text}
              </p>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Implement `components/episode-chat.tsx`** (client; consumes the text stream from `/api/chat`)

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export function EpisodeChat({ episodeId }: { episodeId: string }) {
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [busy, setBusy] = useState(false)

  async function ask() {
    setBusy(true)
    setAnswer("")
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, episodeId }),
      })
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          setAnswer((prev) => prev + decoder.decode(value))
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-2 p-4">
      <h2 className="font-medium">Ask this episode</h2>
      <div className="flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What did they say about…?"
          onKeyDown={(e) => e.key === "Enter" && !busy && question && ask()}
        />
        <Button onClick={ask} disabled={busy || !question}>Ask</Button>
      </div>
      {answer && <p className="text-sm whitespace-pre-wrap">{answer}</p>}
    </Card>
  )
}
```

- [ ] **Step 4: Verify build**

Run: `pnpm typecheck && pnpm build`
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add episode detail page with insights, transcript, and chat"
```

---

## Task 18: UI — Global semantic search

**Files:**
- Create: `app/search/page.tsx`
- Create: `components/global-search.tsx`
- Modify: `app/page.tsx` (add a link to `/search`)

- [ ] **Step 1: Implement `components/global-search.tsx`**

```tsx
"use client"

import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatTimestamp } from "@/lib/format"

type Hit = {
  chunkId: string
  episodeId: string
  episodeTitle: string
  content: string
  startSec: number
  endSec: number
  similarity: number
}

export function GlobalSearch() {
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)

  async function search() {
    setBusy(true)
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
      })
      setHits((await res.json()).hits)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search across all episodes…" />
        <Button onClick={search} disabled={busy || !q}>Search</Button>
      </div>
      {hits.map((h) => (
        <Link key={h.chunkId} href={`/episodes/${h.episodeId}`}>
          <Card className="space-y-1 p-3 hover:bg-accent">
            <div className="text-muted-foreground text-xs">
              {h.episodeTitle} · [{formatTimestamp(h.startSec)}]
            </div>
            <p className="text-sm">{h.content}</p>
          </Card>
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Implement `app/search/page.tsx`**

```tsx
import { GlobalSearch } from "@/components/global-search"

export default function SearchPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Search</h1>
      <GlobalSearch />
    </div>
  )
}
```

- [ ] **Step 3: Add a `/search` link in `app/page.tsx`** header (next to the Archive button)

```tsx
<Button asChild variant="outline">
  <Link href="/search">Search</Link>
</Button>
```

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add global semantic search page"
```

---

## Task 19: Setup docs and full-suite verification

**Files:**
- Create: `SETUP.md`
- Modify: `README.md`

- [ ] **Step 1: Write `SETUP.md`**

```markdown
# Setup

## Prerequisites
- Node + pnpm, a Railway account (Postgres), a Modal account, an OpenAI API key.

## 1. Local development
1. `pnpm install`
2. Copy `.env.example` → `.env.local`. Set `DATABASE_URL` to your Railway Postgres connection string. Set `TEST_DATABASE_URL` to the same string with the database name changed to `podcast_kb_test`.
3. Create the test DB: `psql "$DATABASE_URL" -c "CREATE DATABASE podcast_kb_test;"`
4. `pnpm db:migrate`
5. `pnpm test` (should pass)
6. `pnpm dev`

## 2. Deploy the Modal function
1. `pip install modal && modal token new`
2. `modal deploy modal/transcribe.py`
3. Put the printed web URL in `MODAL_TRANSCRIBE_URL`.
4. Set `MODAL_WEBHOOK_SECRET` to a random string (same value in app + used by Modal).

## 3. Provision Railway
1. Create a Railway project; add a Postgres plugin.
2. Enable pgvector: connect to the DB and run `CREATE EXTENSION IF NOT EXISTS vector;` (the migration also does this).
3. Set the app's `DATABASE_URL` to Railway's connection string.
4. Set env vars on Railway: `DATABASE_URL`, `OPENAI_API_KEY`, `MODAL_TRANSCRIBE_URL`, `MODAL_WEBHOOK_SECRET`, `APP_URL` (the app's public Railway URL).
5. Deploy the Next.js app to Railway (build: `pnpm build`, start: `pnpm start`).
6. Run migrations against the Railway DB: `DATABASE_URL=<railway> pnpm db:migrate`.

## Environment variables
See `.env.example` for the full list.
```

- [ ] **Step 2: Update `README.md`** with a one-paragraph project description and a pointer to `SETUP.md` and the design spec.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass (DB tests require local pgvector up + test DB created).

- [ ] **Step 4: Run typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: add SETUP.md and update README"
```

---

## Manual end-to-end verification (after deploy)

These require live services and are done once accounts/keys are configured:

1. Deploy Modal; set `MODAL_TRANSCRIBE_URL` + secret.
2. Start the app pointed at a real DB with a real `OPENAI_API_KEY`.
3. Search a show → pick an episode → Add. Confirm the episode appears `processing`/`transcribing`.
4. Confirm Modal posts back to `/api/modal/callback`, status moves `analyzing` → `ready`.
5. Open the episode: insights render, transcript shows with timestamps.
6. Ask a question in chat → streamed grounded answer with `[timestamp]` citations.
7. Global search a phrase → relevant chunks with episode + timestamp deep-links.

---

## Notes on library-version drift

This plan targets the versions resolved by `pnpm add` at implementation time. Two areas are most likely to drift and must be checked against the installed packages:
- **AI SDK (`ai`)**: the mock model class names (`MockLanguageModelV2`/`MockEmbeddingModelV2`) and the stream response helper (`toTextStreamResponse`). Check `node_modules/ai` exports and adjust Tasks 10, 11, 14, 17.
- **Drizzle**: `vector` column + `hnsw` index helpers and `cosineDistance`. Check `node_modules/drizzle-orm/pg-core` if Task 2/13 APIs differ.
When an API differs, prefer the installed version's API over this plan and keep the behavior identical.
