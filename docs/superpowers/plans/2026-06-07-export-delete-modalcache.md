# Episode Export + Delete + Modal Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add UI episode deletion (with confirm), Markdown export (copy + download), and Modal Whisper-weight caching for faster/cheaper cold starts.

**Architecture:** A pure `buildEpisodeMarkdown` builder feeds Copy/Download actions; a `DELETE` route + repo method (cascades) backs a confirm-dialog delete; both live in a new `EpisodeActions` menu in the episode detail header. The Modal function mounts a named Volume and loads `large-v3` from it (download once, reuse).

**Tech Stack:** Next.js 16, Drizzle/Postgres, shadcn (dropdown-menu, alert-dialog), Modal Volumes, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-export-delete-modalcache-design.md`

### Conventions
- pnpm. Tests run against `podcast_kb_test` (`test/setup.ts` overrides `DATABASE_URL`). UI gates: `pnpm typecheck` + `pnpm build`. Never commit `.env.local`.
- Next 16 route handlers: async, Web Request/Response, `await params`. Client components need `"use client"`.
- Existing: `@/lib/format` (`formatTimestamp`), `episodeRepo` (`@/lib/db/episodes`: create/getById/list/updateStatus), `@/components/ui/{button,dropdown-menu}` (already installed), `sonner` toast. `app/api/episodes/[id]/route.ts` currently has only `GET`.
- `EpisodeView` props: `episode { id,title,podcastName,artworkUrl,status,errorMessage,publishedAt,durationSec,audioUrl }`, `transcript { fullText, segments:{start,end,text}[] } | null`, `insights {summary,takeaways,topics,quotes:{text,approxTimestampSec}[],entities:{name,type}[]} | null`.

---

## Task 1: Markdown export builder + slug

**Files:**
- Create: `lib/export/episode-markdown.ts`
- Create: `lib/export/slug.ts`
- Test: `test/export/episode-markdown.test.ts`

- [ ] **Step 1: Write failing test `test/export/episode-markdown.test.ts`**

```ts
import { expect, test } from "vitest"
import { buildEpisodeMarkdown } from "@/lib/export/episode-markdown"
import { slugify } from "@/lib/export/slug"

const episode = {
  title: "#415 How Elon Thinks",
  podcastName: "Founders",
  durationSec: 3085,
  publishedAt: "2026-02-01T00:00:00Z",
  sourceUrl: "https://example.com/feed.xml",
}
const insights = {
  summary: "A talk about first principles.",
  takeaways: ["Think from first principles", "Move fast"],
  topics: ["First principles", "Manufacturing"],
  quotes: [{ text: "Question every requirement", approxTimestampSec: 75 }],
  entities: [{ name: "Elon Musk", type: "person" }],
}
const transcript = { segments: [{ start: 0, end: 5, text: "hello" }, { start: 65, end: 70, text: "world" }] }

test("builds full markdown with timestamped transcript", () => {
  const md = buildEpisodeMarkdown(episode, transcript, insights)
  expect(md).toContain("# #415 How Elon Thinks")
  expect(md).toContain("Founders · 51:25")
  expect(md).toContain("Source: https://example.com/feed.xml")
  expect(md).toContain("## Summary\nA talk about first principles.")
  expect(md).toContain("- Think from first principles")
  expect(md).toContain("First principles, Manufacturing")
  expect(md).toContain('> "Question every requirement" — [1:15]')
  expect(md).toContain("Elon Musk (person)")
  expect(md).toContain("## Transcript")
  expect(md).toContain("[0:00] hello")
  expect(md).toContain("[1:05] world")
})

test("omits sections with no data", () => {
  const md = buildEpisodeMarkdown(
    { title: "Bare", podcastName: null, durationSec: null, publishedAt: null },
    null,
    null,
  )
  expect(md).toContain("# Bare")
  expect(md).not.toContain("## Summary")
  expect(md).not.toContain("## Transcript")
})

test("slugify makes a filesystem-safe slug", () => {
  expect(slugify("#415 How Elon Thinks!")).toBe("415-how-elon-thinks")
  expect(slugify("   ")).toBe("episode")
})
```
Run `pnpm test test/export/episode-markdown.test.ts` → FAIL.

- [ ] **Step 2: Implement `lib/export/slug.ts`**

```ts
export function slugify(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  return out || "episode"
}
```

- [ ] **Step 3: Implement `lib/export/episode-markdown.ts`**

```ts
import { formatTimestamp } from "@/lib/format"

export type ExportEpisode = {
  title: string
  podcastName: string | null
  durationSec: number | null
  publishedAt: string | null
  sourceUrl?: string | null
}
export type ExportInsights = {
  summary?: string | null
  takeaways?: string[] | null
  topics?: string[] | null
  quotes?: { text: string; approxTimestampSec: number }[] | null
  entities?: { name: string; type: string }[] | null
} | null
export type ExportTranscript = { segments: { start: number; end: number; text: string }[] } | null

export function buildEpisodeMarkdown(
  episode: ExportEpisode,
  transcript: ExportTranscript,
  insights: ExportInsights,
): string {
  const lines: string[] = [`# ${episode.title}`]

  const meta = [
    episode.podcastName,
    episode.durationSec ? formatTimestamp(episode.durationSec) : null,
    episode.publishedAt ? new Date(episode.publishedAt).toLocaleDateString() : null,
  ].filter(Boolean)
  if (meta.length) lines.push(meta.join(" · "))
  if (episode.sourceUrl) lines.push(`Source: ${episode.sourceUrl}`)

  if (insights?.summary) lines.push("", "## Summary", insights.summary)
  if (insights?.takeaways?.length) lines.push("", "## Takeaways", ...insights.takeaways.map((t) => `- ${t}`))
  if (insights?.topics?.length) lines.push("", "## Topics", insights.topics.join(", "))
  if (insights?.quotes?.length)
    lines.push(
      "",
      "## Notable quotes",
      ...insights.quotes.map((q) => `> "${q.text}" — [${formatTimestamp(q.approxTimestampSec)}]`),
    )
  if (insights?.entities?.length)
    lines.push("", "## People & entities", insights.entities.map((e) => `${e.name} (${e.type})`).join(", "))
  if (transcript?.segments?.length)
    lines.push("", "## Transcript", ...transcript.segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`))

  return `${lines.join("\n")}\n`
}
```
Run the test → PASS. (`formatTimestamp(3085)` = `"51:25"`, `formatTimestamp(75)` = `"1:15"`, `formatTimestamp(0)` = `"0:00"`.)

- [ ] **Step 4: Commit**
```bash
git add lib/export test/export
git commit -m "feat: episode markdown export builder + slug"
```

---

## Task 2: `episodeRepo.remove` + `DELETE` route

**Files:**
- Modify: `lib/db/episodes.ts`
- Modify: `app/api/episodes/[id]/route.ts`
- Test: `test/db/episode-delete.test.ts`

- [ ] **Step 1: Write failing test `test/db/episode-delete.test.ts`**

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

beforeAll(async () => { await migrate(db, { migrationsFolder: "./lib/db/migrations" }) })
beforeEach(async () => { await db.delete(schema.episodes) })
afterAll(async () => { await client.end() })

test("remove deletes the episode and cascades transcript/insights/chunks", async () => {
  const ep = await repo.create({ title: "E", audioUrl: "https://a/1.mp3" })
  await db.insert(schema.transcripts).values({ episodeId: ep.id, fullText: "t", segments: [] })
  await db.insert(schema.insights).values({ episodeId: ep.id, summary: "s" })
  await db.insert(schema.chunks).values({ episodeId: ep.id, content: "c", startSec: 0, endSec: 1, embedding: Array(1536).fill(0.1) })
  await repo.remove(ep.id)
  expect(await repo.getById(ep.id)).toBeNull()
  expect(await db.select().from(schema.transcripts).where(eq(schema.transcripts.episodeId, ep.id))).toHaveLength(0)
  expect(await db.select().from(schema.chunks).where(eq(schema.chunks.episodeId, ep.id))).toHaveLength(0)
})
```
Run `pnpm test test/db/episode-delete.test.ts` → FAIL.

- [ ] **Step 2: Add `remove` to `lib/db/episodes.ts`** (inside the returned object, e.g. after `updateStatus`)

```ts
    async remove(id: string) {
      await db.delete(episodes).where(eq(episodes.id, id))
    },
```
(`eq` and `episodes` are already imported in this file.)
Run the test → PASS.

- [ ] **Step 3: Add `DELETE` to `app/api/episodes/[id]/route.ts`** (keep the existing `GET`; `episodeRepo` is already imported)

```ts
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await episodeRepo.remove(id)
  return Response.json({ status: "deleted" })
}
```

- [ ] **Step 4: Typecheck + commit**
Run `pnpm typecheck` (clean).
```bash
git add lib/db/episodes.ts app/api/episodes/[id]/route.ts test/db/episode-delete.test.ts
git commit -m "feat: episode delete (repo remove + DELETE route)"
```

---

## Task 3: `EpisodeActions` (export + delete) wired into the header

**Files:**
- Add shadcn: `alert-dialog`
- Create: `components/episode-actions.tsx`
- Modify: `components/episode-view.tsx` (header + `sourceUrl` prop)
- Modify: `app/episodes/[id]/page.tsx` (pass `sourceUrl`)

- [ ] **Step 1: Add the alert-dialog component**
Run: `pnpm dlx shadcn@latest add alert-dialog`. Confirm `components/ui/alert-dialog.tsx` exists. (`dropdown-menu` is already installed.)

- [ ] **Step 2: Create `components/episode-actions.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Copy, Download, MoreVertical, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  buildEpisodeMarkdown,
  type ExportEpisode,
  type ExportInsights,
  type ExportTranscript,
} from "@/lib/export/episode-markdown"
import { slugify } from "@/lib/export/slug"

export function EpisodeActions({
  episodeId,
  episode,
  transcript,
  insights,
}: {
  episodeId: string
  episode: ExportEpisode
  transcript: ExportTranscript
  insights: ExportInsights
}) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const markdown = () => buildEpisodeMarkdown(episode, transcript, insights)

  async function copy() {
    await navigator.clipboard.writeText(markdown())
    toast.success("Copied markdown")
  }

  function download() {
    const blob = new Blob([markdown()], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${slugify(episode.title)}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function remove() {
    const res = await fetch(`/api/episodes/${episodeId}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Episode deleted")
      router.push("/")
    } else {
      toast.error("Delete failed")
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Episode actions">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={copy}>
            <Copy className="size-4" /> Copy markdown
          </DropdownMenuItem>
          <DropdownMenuItem onClick={download}>
            <Download className="size-4" /> Download .md
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setConfirmOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this episode?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes its transcript, insights, and chats. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
```

- [ ] **Step 3: Add `sourceUrl` to `EpisodeViewProps` + pass it from the page**

In `components/episode-view.tsx`, add `sourceUrl: string | null` to the `episode` shape in `EpisodeViewProps`.
In `app/episodes/[id]/page.tsx`, add to the `episode` prop object: `sourceUrl: episode.sourceUrl,` (the DB row has `sourceUrl`).

- [ ] **Step 4: Render `EpisodeActions` in the `episode-view.tsx` header**

Add the import:
```ts
import { EpisodeActions } from "@/components/episode-actions"
```
In the header, immediately AFTER the status `Badge` block (still inside `<header>`), add:
```tsx
        <EpisodeActions
          episodeId={episode.id}
          episode={{
            title: episode.title,
            podcastName: episode.podcastName,
            durationSec: episode.durationSec,
            publishedAt: episode.publishedAt,
            sourceUrl: episode.sourceUrl,
          }}
          transcript={transcript}
          insights={insights}
        />
```
(`transcript` and `insights` are already in scope as the component's props.)

- [ ] **Step 5: Typecheck + build + commit**
Run `pnpm typecheck && pnpm build` (clean/green).
```bash
git add components/episode-actions.tsx components/episode-view.tsx app/episodes/[id]/page.tsx components/ui/alert-dialog.tsx
git commit -m "feat: episode actions menu — copy/download markdown + delete with confirm"
```

---

## Task 4: Modal Whisper-weight caching

**Files:**
- Modify: `modal/transcribe.py`

- [ ] **Step 1: Update `modal/transcribe.py`** to mount a Volume and load the model from it

Add the Volume + cache dir near the top:
```python
CACHE_DIR = "/cache"
model_cache = modal.Volume.from_name("whisper-cache", create_if_missing=True)
```
Change the `transcribe` function decorator to mount the volume:
```python
@app.function(image=image, gpu="A10G", timeout=1800, volumes={CACHE_DIR: model_cache})
```
Inside `transcribe`, load the model from the cache (download once, persist):
```python
    model_cache.reload()
    model = WhisperModel("large-v3", device="cuda", compute_type="float16", download_root=CACHE_DIR)
    model_cache.commit()
```
(Replace the existing `WhisperModel("large-v3", device="cuda", compute_type="float16")` line; keep the rest of the function — download, transcribe loop, callback — unchanged. The `web` endpoint function is NOT changed and does not mount the volume.)

- [ ] **Step 2: Validate Python syntax**
Run: `python3 -m py_compile modal/transcribe.py` → no output (success).

- [ ] **Step 3: Commit**
```bash
git add modal/transcribe.py
git commit -m "perf: cache Whisper weights in a Modal Volume for faster cold starts"
```

- [ ] **Step 4: USER ACTION (deploy)** — after this lands, the user runs `modal deploy modal/transcribe.py`. The `whisper-cache` Volume is auto-created (`create_if_missing=True`); the first transcription downloads the model into it (one slower run), and subsequent runs load from cache. No Modal dashboard steps. (The controller will surface this instruction to the user; it is not an automated step.)

---

## Task 5: Verify + deploy

- [ ] **Step 1: Full verification**
Run `pnpm test` (all pass, against `podcast_kb_test`), `pnpm typecheck` (clean), `pnpm build` (success).

- [ ] **Step 2: Manual smoke (local `pnpm dev`)**
On an episode: the ⋯ menu shows Copy markdown (clipboard toast), Download .md (downloads a file), Delete (opens confirm → on Delete returns to Library and the episode is gone). Verify the downloaded markdown looks right (sections present, timestamps).

- [ ] **Step 3: Push**
```bash
git push origin main
```

- [ ] **Step 4: Confirm deploy**
Poll `gh api repos/jereswinnen/flux/commits/$(git rev-parse HEAD)/status --jq .state` until `success`. (No DB migration; web app unaffected by the Modal change.) Then remind the user to run `modal deploy modal/transcribe.py` to activate the caching.

---

## Notes
- Use the `shadcn` skill for `alert-dialog`; `frontend-design` for the menu styling.
- No DB migration (cascade deletes already defined by FKs).
- The Modal change only affects the separately-deployed transcription function; it does not affect the Next.js deploy.
