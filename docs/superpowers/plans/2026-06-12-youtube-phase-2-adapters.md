# YouTube Phase 2 — SourceAdapter Abstraction + Unified Ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Introduce a `SourceAdapter` abstraction and a unified ingest path so YouTube videos (and, later, articles) can be added the same way podcasts are, with all source-specific logic isolated behind one interface.

**Architecture:** A `SourceAdapter` per source type implements `detect` / `resolve` / `startProcessing`. A registry dispatches an ingest request (a URL, or an explicit-typed podcast payload) to the right adapter. A unified `POST /api/items` uses the registry; the podcast path is refactored into a `PodcastAdapter` (preserving today's iTunes-driven flow), and a new `YouTubeAdapter` creates a minimal item from a video URL and kicks off the YouTube Modal job.

**Tech Stack:** Next.js 16, Drizzle, Postgres, Vitest, TypeScript.

---

## Scope & Phase Boundary

- **In scope:** `SourceAdapter` interface + registry; `PodcastAdapter` (wrap existing logic); `YouTubeAdapter` (URL → `videoId`, minimal item, trigger); `triggerYoutubeTranscription` Modal client; unified `POST /api/items` + `GET /api/items` (DTO list); generalized `POST /api/items/[id]/retry` (dispatch by `type`); add-command UI detects YouTube URLs and ingests them.
- **Depends on (Phase 3, not built here):** the Modal `transcribe_youtube` function + WARP. In Phase 2, `YouTubeAdapter.startProcessing` POSTs to `MODAL_TRANSCRIBE_YOUTUBE_URL`. Until Phase 3 deploys that endpoint, a real YouTube add will create the item and then move to `failed` (no endpoint). This is expected; Phase 2 is verified with the Modal call **mocked**. YouTube **metadata** (title/channel/thumbnail/duration) is resolved inside the Modal job in Phase 3 and backfilled via the callback — so `YouTubeAdapter.resolve` here produces only a minimal placeholder item.
- **Compatibility:** keep `POST /api/episodes` working (delegate to the podcast adapter or leave intact) so existing UI keeps functioning during the transition.

## File Structure

- **Create:** `lib/sources/types.ts` (interface), `lib/sources/podcast.ts`, `lib/sources/youtube.ts`, `lib/sources/registry.ts`, `app/api/items/route.ts`, `app/api/items/[id]/retry/route.ts`, plus tests under `test/sources/` and `test/api/`.
- **Modify:** `lib/modal/client.ts` (add `triggerYoutubeTranscription`), `app/api/modal/callback/route.ts` (accept YouTube metadata backfill — see Task 7), `components/add-command.tsx` (detect + ingest YouTube URLs), `.env.example` (`MODAL_TRANSCRIBE_YOUTUBE_URL`).

---

## Task 1: `SourceAdapter` interface + types

**Files:** Create `lib/sources/types.ts`; Test `test/sources/types.test.ts` (none needed — type-only).

- [ ] **Step 1: Create `lib/sources/types.ts`**

```ts
import type { ItemRow } from "@/lib/api/dto"
import type { NewItem } from "@/lib/db/items"

/** Result of attempting to ingest one input through an adapter. */
export interface SourceAdapter {
  /** The item type this adapter produces. */
  readonly type: NewItem["type"]
  /** True if this adapter handles the given raw URL/string input. */
  detect(input: string): boolean
  /** Build the (unsaved) item record from the input. Cheap/metadata-only —
   *  heavy fetching (audio, YouTube metadata) happens in startProcessing/Modal. */
  resolve(input: string): Promise<NewItem>
  /** Kick off transcription/extraction for an already-persisted item.
   *  Must not throw for "expected" async failures — callers handle status. */
  startProcessing(item: ItemRow): Promise<void>
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` — `lib/sources/types.ts` must be error-free (other files unaffected).

- [ ] **Step 3: Commit**

```bash
git add lib/sources/types.ts
git commit -m "feat(sources): SourceAdapter interface"
```

---

## Task 2: YouTube URL detection + videoId parsing (pure, TDD)

**Files:** Create `lib/sources/youtube-url.ts`; Test `test/sources/youtube-url.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { parseYouTubeId, isYouTubeUrl } from "@/lib/sources/youtube-url"

describe("parseYouTubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"],
    ["https://youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("extracts id from %s", (url, id) => {
    expect(parseYouTubeId(url)).toBe(id)
  })
  it("returns null for non-YouTube urls", () => {
    expect(parseYouTubeId("https://example.com/watch?v=x")).toBeNull()
    expect(parseYouTubeId("https://anchor.fm/ep.mp3")).toBeNull()
  })
})

describe("isYouTubeUrl", () => {
  it("is true only when an id can be parsed", () => {
    expect(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true)
    expect(isYouTubeUrl("https://example.com")).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`npm test -- test/sources/youtube-url.test.ts`).

- [ ] **Step 3: Implement `lib/sources/youtube-url.ts`**

```ts
/** Extract an 11-char YouTube video id from common URL shapes, else null. */
export function parseYouTubeId(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\.|^m\./, "")
  const id = (() => {
    if (host === "youtu.be") return url.pathname.slice(1)
    if (host === "youtube.com" || host === "music.youtube.com") {
      if (url.pathname === "/watch") return url.searchParams.get("v") ?? ""
      const m = url.pathname.match(/^\/(shorts|embed|v)\/([^/]+)/)
      if (m) return m[2]
    }
    return ""
  })()
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
}

export function isYouTubeUrl(input: string): boolean {
  return parseYouTubeId(input) !== null
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add lib/sources/youtube-url.ts test/sources/youtube-url.test.ts
git commit -m "feat(sources): YouTube URL parsing"
```

---

## Task 3: `triggerYoutubeTranscription` Modal client

**Files:** Modify `lib/modal/client.ts`; Modify `.env.example`; Test `test/modal/youtube-client.test.ts`.

- [ ] **Step 1: Write the failing test** (mirror the existing `test/modal/client.test.ts` fetch-mock pattern)

```ts
import { afterEach, expect, test, vi } from "vitest"
import { triggerYoutubeTranscription } from "@/lib/modal/client"

afterEach(() => vi.unstubAllGlobals())

test("posts video_url + item_id + callback to the youtube endpoint", async () => {
  process.env.MODAL_TRANSCRIBE_YOUTUBE_URL = "https://modal.test/yt"
  process.env.MODAL_WEBHOOK_SECRET = "s3cr3t"
  process.env.APP_URL = "https://app.test"
  const calls: { url: string; body: unknown }[] = []
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return new Response(null, { status: 200 })
  })
  await triggerYoutubeTranscription("it-1", "https://youtu.be/dQw4w9WgXcQ")
  expect(calls[0].url).toBe("https://modal.test/yt")
  expect(calls[0].body).toMatchObject({
    item_id: "it-1",
    video_url: "https://youtu.be/dQw4w9WgXcQ",
    callback_url: "https://app.test/api/modal/callback",
    secret: "s3cr3t",
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Add to `lib/modal/client.ts`** (append; keep `triggerTranscription` as-is)

```ts
export async function triggerYoutubeTranscription(itemId: string, videoUrl: string) {
  const endpoint = process.env.MODAL_TRANSCRIBE_YOUTUBE_URL
  const secret = process.env.MODAL_WEBHOOK_SECRET
  const appUrl = process.env.APP_URL
  if (!endpoint || !secret || !appUrl) {
    throw new Error(
      "Modal env not configured (MODAL_TRANSCRIBE_YOUTUBE_URL/SECRET/APP_URL)",
    )
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      item_id: itemId,
      video_url: videoUrl,
      callback_url: `${appUrl}/api/modal/callback`,
      secret,
    }),
  })
  if (!res.ok) throw new Error(`Modal youtube trigger failed: ${res.status}`)
}
```

Note: the YouTube wire uses `item_id` (new function, new contract) and `video_url` — distinct from the legacy podcast `episode_id`/`audio_url`. Phase 3's Modal function and the callback must read `item_id` for YouTube. (The callback already reads `episode_id` into `itemId` for podcasts; Task 7 makes it accept either.)

- [ ] **Step 4: Add `MODAL_TRANSCRIBE_YOUTUBE_URL=""` to `.env.example`** under the existing Modal section.

- [ ] **Step 5: Run — expect PASS.** Commit:

```bash
git add lib/modal/client.ts test/modal/youtube-client.test.ts .env.example
git commit -m "feat(modal): triggerYoutubeTranscription client"
```

---

## Task 4: PodcastAdapter + YouTubeAdapter + registry

**Files:** Create `lib/sources/podcast.ts`, `lib/sources/youtube.ts`, `lib/sources/registry.ts`; Test `test/sources/registry.test.ts`.

- [ ] **Step 1: Create `lib/sources/podcast.ts`**

```ts
import type { ItemRow } from "@/lib/api/dto"
import { itemRepo, type NewItem } from "@/lib/db/items"
import { triggerTranscription } from "@/lib/modal/client"
import type { SourceAdapter } from "./types"

/** Input shape the podcast adapter accepts (from the iTunes-driven UI). */
export interface PodcastInput {
  title: string
  audioUrl: string
  podcastName?: string
  sourceUrl?: string
  artworkUrl?: string
  publishedAt?: string
  durationSec?: number
  episodeGuid?: string
  itunesCollectionId?: number
  itunesTrackId?: number
}

export function podcastInputToNewItem(input: PodcastInput): NewItem {
  const sourceMetadata = {
    guid: input.episodeGuid,
    itunesCollectionId: input.itunesCollectionId,
    itunesTrackId: input.itunesTrackId,
  }
  const hasMeta = Object.values(sourceMetadata).some((v) => v !== undefined && v !== null)
  return {
    type: "podcast",
    title: input.title,
    audioUrl: input.audioUrl,
    podcastName: input.podcastName,
    sourceUrl: input.sourceUrl,
    artworkUrl: input.artworkUrl,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
    durationSec: input.durationSec,
    sourceMetadata: hasMeta ? sourceMetadata : undefined,
  }
}

export const podcastAdapter: SourceAdapter = {
  type: "podcast",
  detect: () => false, // podcasts are dispatched by explicit type, not URL sniffing
  async resolve() {
    throw new Error("podcastAdapter.resolve is unused; use podcastInputToNewItem")
  },
  async startProcessing(item: ItemRow) {
    if (item.audioUrl) await triggerTranscription(item.id, item.audioUrl)
  },
}

export { itemRepo }
```

(Detection for podcasts is by explicit `type`, since the UI already supplies full metadata — see registry Task. `resolve` is intentionally unused for podcasts because the payload IS the metadata; the unified route uses `podcastInputToNewItem`.)

- [ ] **Step 2: Create `lib/sources/youtube.ts`**

```ts
import type { ItemRow } from "@/lib/api/dto"
import type { NewItem } from "@/lib/db/items"
import { triggerYoutubeTranscription } from "@/lib/modal/client"
import type { SourceAdapter } from "./types"
import { parseYouTubeId, isYouTubeUrl } from "./youtube-url"

export const youtubeAdapter: SourceAdapter = {
  type: "youtube",
  detect: (input) => isYouTubeUrl(input),
  async resolve(input): Promise<NewItem> {
    const videoId = parseYouTubeId(input)
    if (!videoId) throw new Error("not a YouTube URL")
    // Minimal placeholder; real metadata (title/channel/thumbnail/duration) is
    // resolved inside the Modal job and backfilled via the callback (Phase 3).
    return {
      type: "youtube",
      title: "YouTube video", // backfilled on callback
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      sourceMetadata: { videoId },
    }
  },
  async startProcessing(item: ItemRow) {
    const videoId = item.sourceMetadata?.videoId
    if (!videoId) throw new Error("youtube item missing videoId")
    await triggerYoutubeTranscription(item.id, `https://www.youtube.com/watch?v=${videoId}`)
  },
}
```

- [ ] **Step 3: Write the failing registry test** `test/sources/registry.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { detectAdapter, getAdapter } from "@/lib/sources/registry"

describe("registry", () => {
  it("detects youtube by url", () => {
    expect(detectAdapter("https://youtu.be/dQw4w9WgXcQ")?.type).toBe("youtube")
  })
  it("returns null when no url adapter matches", () => {
    expect(detectAdapter("https://anchor.fm/x.mp3")).toBeNull()
  })
  it("gets an adapter by explicit type", () => {
    expect(getAdapter("podcast").type).toBe("podcast")
    expect(getAdapter("youtube").type).toBe("youtube")
  })
})
```

- [ ] **Step 4: Run — expect FAIL.**

- [ ] **Step 5: Create `lib/sources/registry.ts`**

```ts
import type { NewItem } from "@/lib/db/items"
import { podcastAdapter } from "./podcast"
import type { SourceAdapter } from "./types"
import { youtubeAdapter } from "./youtube"

// Order matters for detect(): URL-based adapters first.
const URL_ADAPTERS: SourceAdapter[] = [youtubeAdapter]
const BY_TYPE: Record<NewItem["type"], SourceAdapter> = {
  podcast: podcastAdapter,
  youtube: youtubeAdapter,
  article: youtubeAdapter, // placeholder; replaced when an ArticleAdapter exists
}

/** Find the URL-based adapter for a raw input, or null. */
export function detectAdapter(input: string): SourceAdapter | null {
  return URL_ADAPTERS.find((a) => a.detect(input)) ?? null
}

export function getAdapter(type: NewItem["type"]): SourceAdapter {
  return BY_TYPE[type]
}
```

Note: leave `article` mapped to a placeholder only to satisfy the exhaustive record; it is never invoked in Phase 2 (no article ingestion path exists). A reviewer may prefer omitting `article` from `BY_TYPE` and narrowing `getAdapter`'s param to `"podcast" | "youtube"` — either is acceptable; pick one and keep types honest.

- [ ] **Step 6: Run — expect PASS.** Commit:

```bash
git add lib/sources test/sources/registry.test.ts
git commit -m "feat(sources): podcast + youtube adapters and registry"
```

---

## Task 5: Unified `POST /api/items` + `GET /api/items`

**Files:** Create `app/api/items/route.ts`; Test `test/api/items-route.test.ts`.

- [ ] **Step 1: Write the failing test** (mock `itemRepo` + adapters' trigger; assert dispatch)

```ts
import { afterEach, expect, test, vi } from "vitest"

vi.mock("@/lib/modal/client", () => ({
  triggerTranscription: vi.fn(async () => {}),
  triggerYoutubeTranscription: vi.fn(async () => {}),
}))

const created: any[] = []
vi.mock("@/lib/db/items", () => ({
  itemRepo: {
    create: vi.fn(async (v: any) => {
      const row = { id: "new-id", status: "processing", ...v }
      created.push(row)
      return row
    }),
    updateStatus: vi.fn(async () => {}),
  },
}))

afterEach(() => { created.length = 0; vi.clearAllMocks() })

test("ingests a youtube url via the registry", async () => {
  const { POST } = await import("@/app/api/items/route")
  const res = await POST(
    new Request("http://t/api/items", {
      method: "POST",
      body: JSON.stringify({ url: "https://youtu.be/dQw4w9WgXcQ" }),
    }),
  )
  expect(res.status).toBe(201)
  expect(created[0]).toMatchObject({ type: "youtube", sourceMetadata: { videoId: "dQw4w9WgXcQ" } })
  const { triggerYoutubeTranscription } = await import("@/lib/modal/client")
  expect(triggerYoutubeTranscription).toHaveBeenCalledWith("new-id", expect.stringContaining("dQw4w9WgXcQ"))
})

test("rejects an unrecognized url", async () => {
  const { POST } = await import("@/app/api/items/route")
  const res = await POST(
    new Request("http://t/api/items", { method: "POST", body: JSON.stringify({ url: "https://example.com" }) }),
  )
  expect(res.status).toBe(400)
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `app/api/items/route.ts`**

```ts
import { itemToDTO } from "@/lib/api/dto"
import { itemRepo } from "@/lib/db/items"
import { podcastInputToNewItem, type PodcastInput } from "@/lib/sources/podcast"
import { detectAdapter, getAdapter } from "@/lib/sources/registry"

export async function GET() {
  const list = await itemRepo.list()
  return Response.json({ items: list.map(itemToDTO) })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) return Response.json({ error: "invalid body" }, { status: 400 })

  // Explicit podcast payload (iTunes-driven UI) vs. URL-based source (youtube).
  if (body.type === "podcast" || (body.audioUrl && !body.url)) {
    if (!body.title || !body.audioUrl) {
      return Response.json({ error: "title and audioUrl required" }, { status: 400 })
    }
    const adapter = getAdapter("podcast")
    const item = await itemRepo.create(podcastInputToNewItem(body as PodcastInput))
    fireProcessing(adapter, item)
    return Response.json({ item: itemToDTO(item) }, { status: 201 })
  }

  const url: unknown = body.url
  if (typeof url !== "string" || !url) {
    return Response.json({ error: "url required" }, { status: 400 })
  }
  const adapter = detectAdapter(url)
  if (!adapter) {
    return Response.json({ error: "unrecognized source URL" }, { status: 400 })
  }
  const item = await itemRepo.create(await adapter.resolve(url))
  fireProcessing(adapter, item)
  return Response.json({ item: itemToDTO(item) }, { status: 201 })
}

// Fire-and-forget; record failure without blocking the response.
function fireProcessing(adapter: { startProcessing: (i: any) => Promise<void> }, item: any) {
  if (item.status !== "processing") return
  adapter
    .startProcessing(item)
    .then(() => itemRepo.updateStatus(item.id, "transcribing"))
    .catch((e: unknown) =>
      itemRepo.updateStatus(item.id, "failed", e instanceof Error ? e.message : String(e)),
    )
}
```

- [ ] **Step 4: Run — expect PASS.** Then `npm run typecheck` clean for this file. Commit:

```bash
git add app/api/items/route.ts test/api/items-route.test.ts
git commit -m "feat(api): unified POST/GET /api/items via source registry"
```

---

## Task 6: Generalized retry `POST /api/items/[id]/retry`

**Files:** Create `app/api/items/[id]/retry/route.ts`; Test `test/api/items-retry.test.ts`.

- [ ] **Step 1: Write the failing test** — assert: existing transcript → resume analysis (calls `processContent`); no transcript + youtube → calls `triggerYoutubeTranscription`; no transcript + podcast → `triggerTranscription`. Mock `@/lib/modal/client`, `@/lib/pipeline/process-content`, `@/lib/db/items`, and `@/lib/db` (db).

```ts
import { afterEach, expect, test, vi } from "vitest"

vi.mock("@/lib/modal/client", () => ({
  triggerTranscription: vi.fn(async () => {}),
  triggerYoutubeTranscription: vi.fn(async () => {}),
}))
vi.mock("@/lib/pipeline/process-content", () => ({ processContent: vi.fn(async () => {}) }))

let item: any
vi.mock("@/lib/db/items", () => ({
  itemRepo: { getById: vi.fn(async () => item), updateStatus: vi.fn(async () => {}) },
}))
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
}))

afterEach(() => vi.clearAllMocks())

test("retry of a youtube item with no transcript re-triggers youtube", async () => {
  item = { id: "y1", type: "youtube", audioUrl: null, sourceMetadata: { videoId: "dQw4w9WgXcQ" } }
  const { POST } = await import("@/app/api/items/[id]/retry/route")
  const res = await POST(new Request("http://t"), { params: Promise.resolve({ id: "y1" }) })
  expect(res.status).toBe(202)
  const { triggerYoutubeTranscription } = await import("@/lib/modal/client")
  expect(triggerYoutubeTranscription).toHaveBeenCalledWith("y1", expect.stringContaining("dQw4w9WgXcQ"))
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `app/api/items/[id]/retry/route.ts`**

```ts
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { itemRepo } from "@/lib/db/items"
import { transcripts } from "@/lib/db/schema"
import { getAdapter } from "@/lib/sources/registry"
import { processContent } from "@/lib/pipeline/process-content"

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await itemRepo.getById(id)
  if (!item) return Response.json({ error: "not found" }, { status: 404 })

  const [transcript] = await db.select().from(transcripts).where(eq(transcripts.itemId, id)).limit(1)

  if (transcript) {
    await itemRepo.updateStatus(id, "analyzing")
    processContent(
      { itemId: id, transcript: transcript.fullText, segments: transcript.segments ?? [] },
      { db },
    ).catch(() => {})
  } else {
    await itemRepo.updateStatus(id, "processing")
    getAdapter(item.type)
      .startProcessing(item)
      .then(() => itemRepo.updateStatus(id, "transcribing"))
      .catch((e: unknown) =>
        itemRepo.updateStatus(id, "failed", e instanceof Error ? e.message : String(e)),
      )
  }
  return Response.json({ status: "retrying" }, { status: 202 })
}
```

- [ ] **Step 4: Run — expect PASS.** Commit:

```bash
git add "app/api/items/[id]/retry/route.ts" test/api/items-retry.test.ts
git commit -m "feat(api): generalized /api/items/[id]/retry dispatching by type"
```

---

## Task 7: Callback accepts YouTube metadata backfill

**Files:** Modify `app/api/modal/callback/route.ts`; Test: extend `test/api/modal-callback.test.ts`.

The YouTube Modal job (Phase 3) will POST `item_id` (not `episode_id`) plus a `metadata` object to backfill. Make the callback accept either id key and apply metadata when present.

- [ ] **Step 1: Write/extend the failing test** — a callback body `{ item_id, secret, metadata: { title, podcastName, artworkUrl, durationSec }, transcript, segments }` should call `itemRepo.update` (or a new `applyMetadata`) and then `processContent({ itemId })`. (If `itemRepo` has no metadata-update method, add `updateMeta(id, fields)` to the repo in this task and test it minimally.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**
- In `lib/db/items.ts`, add:
```ts
    async updateMeta(id: string, fields: Partial<Pick<NewItem, "title" | "podcastName" | "artworkUrl" | "durationSec"> & { publishedAt?: Date }>) {
      await db.update(items).set(fields).where(eq(items.id, id))
    },
```
- In `app/api/modal/callback/route.ts`: read `const itemId = body.item_id ?? body.episode_id`; if `body.metadata` is present, `await itemRepo.updateMeta(itemId, { ...mapped })` (map only defined fields) before launching `processContent`. Keep the existing error-path + secret check.

- [ ] **Step 4: Run — expect PASS** (`npm test -- test/api/modal-callback.test.ts`). Commit:

```bash
git add app/api/modal/callback/route.ts lib/db/items.ts test/api/modal-callback.test.ts
git commit -m "feat(api): callback backfills item metadata + accepts item_id"
```

---

## Task 8: add-command UI detects + ingests YouTube URLs

**Files:** Modify `components/add-command.tsx`.

- [ ] **Step 1: Add YouTube handling to the URL group**

Import `isYouTubeUrl` from `@/lib/sources/youtube-url`. In the `urlQuery` `CommandGroup` (around lines 248-265), add a branch BEFORE the feed/audio branch:
```tsx
                  onSelect={() => {
                    if (isYouTubeUrl(urlQuery)) {
                      ingestItem({ url: urlQuery })
                    } else if (looksLikeFeedUrl(urlQuery)) {
                      loadShowEpisodes(urlQuery, {})
                    } else {
                      ingest({ title: urlQuery, audioUrl: urlQuery, sourceUrl: urlQuery })
                    }
                  }}
```
and make the label reflect it: `isYouTubeUrl(urlQuery) ? "Add this YouTube video" : looksLikeFeedUrl(urlQuery) ? "Load feed episodes" : "Add this audio URL"`.

- [ ] **Step 2: Add an `ingestItem` helper** next to the existing `ingest` (which POSTs to `/api/episodes`). `ingestItem` POSTs the body to `/api/items` and, on success, navigates to `/episodes/${data.item.id}` (the existing detail route still serves all item types). Mirror `ingest`'s submitting-state + error handling.

```tsx
  async function ingestItem(payload: Record<string, unknown>) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "ingest failed")
      onOpenChange(false)
      goTo(`/episodes/${data.item.id}`)
    } catch (e) {
      // surface via the same mechanism `ingest` uses (toast/console)
      console.error(e)
    } finally {
      setSubmitting(false)
    }
  }
```
(Match the exact submitting-state setter names and error/toast pattern already used by `ingest` in this file — read it first and stay consistent.)

- [ ] **Step 2b:** Verify `npm run typecheck` is clean and `npm run build` succeeds (the page compiles).

- [ ] **Step 3: Commit**

```bash
git add components/add-command.tsx
git commit -m "feat(ui): paste a YouTube URL to ingest via /api/items"
```

---

## Task 9: Final verification

- [ ] **Step 1:** `npm run typecheck` — clean.
- [ ] **Step 2:** `npm test` — all pass (the new pure + mocked-route tests run without network; DB tests unaffected).
- [ ] **Step 3:** `npm run lint` — confirm **no new** errors vs. the 11 pre-existing on `main`.
- [ ] **Step 4:** `npm run build` — succeeds.
- [ ] **Step 5 (manual, deferred to Phase 3):** end-to-end YouTube add is only fully testable once Phase 3 deploys the Modal `transcribe_youtube` endpoint and `MODAL_TRANSCRIBE_YOUTUBE_URL` is set. Until then, pasting a YouTube URL creates the item and moves it to `failed` (no endpoint) — expected.

---

## Self-Review (plan author)

- **Spec coverage:** SourceAdapter interface ✅ (Task 1); podcast + youtube adapters + registry ✅ (Task 4); unified ingest `POST /api/items` ✅ (Task 5); generalized retry ✅ (Task 6); YouTube trigger client ✅ (Task 3); callback metadata backfill ✅ (Task 7); UI ingest ✅ (Task 8). Article adapter explicitly deferred. Modal/WARP function is Phase 3.
- **Placeholder scan:** none — full code or precise edit instructions per step. The one "match the existing pattern" note (Task 8 `ingest` submitting-state) is delegated with an instruction to read the file first, because the exact toast/state names live in code not captured here.
- **Type consistency:** `SourceAdapter`, `detectAdapter`/`getAdapter`, `podcastInputToNewItem`, `triggerYoutubeTranscription`, `itemRepo.updateMeta`, `ItemDTO`/`itemToDTO`, `processContent({ itemId })` consistent across tasks.
- **Phase boundary risk:** YouTube wire uses `item_id`/`video_url`; Phase 3's Modal function MUST honor that contract and POST `{ item_id, metadata, transcript, segments }`. Recorded here so Phase 3's plan matches.
