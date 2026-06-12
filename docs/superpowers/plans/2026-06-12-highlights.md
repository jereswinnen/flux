# Highlights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users highlight free-text passages in transcripts and insights (with optional notes) and review them on a `/highlights` page, with a source-agnostic model that extends to future sources without schema changes.

**Architecture:** A `highlights` table keyed to `items`, discriminated by `kind` with a flexible JSONB `locator`. Two small per-`kind` switch points — `buildLocator` (write) and `highlightJumpHref` (read) — plus a reusable selection layer (`Highlightable` data attributes + `useHighlightSelection` + `HighlightPopover`). A DTO layer feeds the `/highlights` feed.

**Tech Stack:** Next.js 16, Drizzle (postgres-js), Postgres, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-12-highlights-design.md`

## File Structure

- **Create:** `lib/highlights/locator.ts` (+ test), `lib/db/highlights.ts` (+ test), `lib/api/highlight-dto.ts` (+ test), `lib/db/migrations/0006_highlights.sql`, `app/api/highlights/route.ts`, `app/api/highlights/[id]/route.ts` (+ tests), `components/highlightable.tsx`, `components/highlight-layer.tsx`, `app/highlights/page.tsx`, `components/highlights-feed.tsx`.
- **Modify:** `lib/db/schema.ts` (highlights table), `lib/db/migrations/meta/_journal.json`, `components/live-transcript.tsx` (data attrs), `components/episode-insights.tsx` (data attrs), `components/episode-view.tsx` (mount `HighlightLayer`), `components/app-sidebar.tsx` (nav entry).

---

## Task 1: Locator + jump helpers (pure, TDD)

**Files:** Create `lib/highlights/locator.ts`, `test/highlights/locator.test.ts`.

These pure functions are the per-`kind` seam and are framework-free (the schema and components import the types/functions).

- [ ] **Step 1: Write `test/highlights/locator.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { buildLocator, highlightJumpHref } from "@/lib/highlights/locator"

describe("buildLocator", () => {
  it("transcript → { sec }", () => {
    expect(buildLocator("transcript", { hlSec: "42", hlIndex: "3" })).toEqual({ sec: 42 })
  })
  it("quote → { index, sec }", () => {
    expect(buildLocator("quote", { hlIndex: "2", hlSec: "90" })).toEqual({ index: 2, sec: 90 })
  })
  it("takeaway → { index }", () => {
    expect(buildLocator("takeaway", { hlIndex: "5" })).toEqual({ index: 5 })
  })
  it("ignores missing/NaN attrs", () => {
    expect(buildLocator("transcript", {})).toEqual({})
  })
})

describe("highlightJumpHref", () => {
  it("transcript/quote with sec → ?t=", () => {
    expect(highlightJumpHref("i1", "transcript", { sec: 42.7 })).toBe("/episodes/i1?t=42")
    expect(highlightJumpHref("i1", "quote", { index: 1, sec: 90 })).toBe("/episodes/i1?t=90")
  })
  it("takeaway / no sec → bare item", () => {
    expect(highlightJumpHref("i1", "takeaway", { index: 2 })).toBe("/episodes/i1")
    expect(highlightJumpHref("i1", "transcript", null)).toBe("/episodes/i1")
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`npm test -- test/highlights/locator.test.ts`).

- [ ] **Step 3: Create `lib/highlights/locator.ts`**

```ts
export type HighlightKind = "transcript" | "takeaway" | "quote" | "article" | "kindle"

export type HighlightLocator = {
  sec?: number
  segmentStart?: number
  index?: number
  charStart?: number
  charEnd?: number
  location?: string
}

function num(v: string | undefined): number | undefined {
  if (v == null || v === "") return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Build a locator from a highlightable element's data attributes, per kind. */
export function buildLocator(
  kind: HighlightKind,
  data: Record<string, string | undefined>,
): HighlightLocator {
  switch (kind) {
    case "transcript":
      return strip({ sec: num(data.hlSec) })
    case "quote":
      return strip({ index: num(data.hlIndex), sec: num(data.hlSec) })
    case "takeaway":
      return strip({ index: num(data.hlIndex) })
    default:
      return {}
  }
}

function strip(o: HighlightLocator): HighlightLocator {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
}

/** Where clicking a highlight navigates — the read-side per-kind seam. */
export function highlightJumpHref(
  itemId: string,
  kind: HighlightKind,
  locator: HighlightLocator | null,
): string {
  const sec = locator?.sec
  if ((kind === "transcript" || kind === "quote") && typeof sec === "number" && sec > 0) {
    return `/episodes/${itemId}?t=${Math.floor(sec)}`
  }
  return `/episodes/${itemId}`
}
```

- [ ] **Step 4: Run — expect PASS.** Commit:

```bash
git add lib/highlights/locator.ts test/highlights/locator.test.ts
git commit -m "feat(highlights): locator + jumpHref helpers (per-kind seam)"
```

---

## Task 2: Schema — `highlights` table

**Files:** Modify `lib/db/schema.ts`.

- [ ] **Step 1: Add the table** (after the `items` table; reuses existing `index`, `jsonb`, `text`, `timestamp`, `uuid` imports)

```ts
import type { HighlightLocator } from "@/lib/highlights/locator"

export const highlights = pgTable(
  "highlights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    note: text("note"),
    locator: jsonb("locator").$type<HighlightLocator>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("highlights_item_idx").on(t.itemId),
    index("highlights_created_idx").on(t.createdAt),
  ],
)
```

Put the `import type` line with the other imports at the top of the file.

- [ ] **Step 2: Typecheck** — `npm run typecheck`; errors only where the table isn't used yet is fine. `schema.ts` itself must be clean.

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): highlights table"
```

---

## Task 3: Migration `0006_highlights`

**Files:** Create `lib/db/migrations/0006_highlights.sql`; Modify `lib/db/migrations/meta/_journal.json`.

Hand-authored (the project's convention; `drizzle-kit generate` is interactive). The migrator splits on `--> statement-breakpoint` and runs migrations listed in `_journal.json`.

- [ ] **Step 1: Create `lib/db/migrations/0006_highlights.sql`** (verbatim)

```sql
CREATE TABLE "highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"note" text,
	"locator" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "highlights_item_idx" ON "highlights" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "highlights_created_idx" ON "highlights" USING btree ("created_at");
```

- [ ] **Step 2: Append to `lib/db/migrations/meta/_journal.json`** entries array (after the `idx: 5` entry — add a comma after its closing brace):

```json
    {
      "idx": 6,
      "version": "7",
      "when": 1781300000000,
      "tag": "0006_highlights",
      "breakpoints": true
    }
```

- [ ] **Step 3: Apply to the app DB**

Run: `npm run db:migrate`
Expected: `migrations applied`, no error. (Tests auto-apply it to the test DB via `migrate()` in `beforeAll`.)

- [ ] **Step 4: Commit**

```bash
git add lib/db/migrations/0006_highlights.sql lib/db/migrations/meta/_journal.json
git commit -m "chore(db): migration for highlights table"
```

---

## Task 4: Highlights repo

**Files:** Create `lib/db/highlights.ts`, `test/db/highlights.test.ts`.

- [ ] **Step 1: Write `test/db/highlights.test.ts`** (inline test-DB setup, mirroring `test/db/items.test.ts`)

```ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeItemRepo } from "@/lib/db/items"
import { makeHighlightRepo } from "@/lib/db/highlights"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const items = makeItemRepo(db)
const repo = makeHighlightRepo(db)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
beforeEach(async () => {
  await db.delete(schema.highlights)
  await db.delete(schema.items)
})
afterAll(async () => {
  await client.end()
})

test("create + list newest-first with item context", async () => {
  const item = await items.create({ type: "podcast", title: "Ep", audioUrl: "https://a/1.mp3" })
  await repo.create({ itemId: item.id, kind: "transcript", text: "first", locator: { sec: 10 } })
  await repo.create({ itemId: item.id, kind: "takeaway", text: "second", locator: { index: 0 } })
  const rows = await repo.list({})
  expect(rows.map((r) => r.text)).toEqual(["second", "first"])
  expect(rows[0].item.title).toBe("Ep")
  expect(rows[0].item.type).toBe("podcast")
})

test("filters by source type and searches text/note", async () => {
  const pod = await items.create({ type: "podcast", title: "P", audioUrl: "https://a/p.mp3" })
  const vid = await items.create({ type: "youtube", title: "V", sourceMetadata: { videoId: "x" } })
  await repo.create({ itemId: pod.id, kind: "quote", text: "alpha", note: "keep" })
  await repo.create({ itemId: vid.id, kind: "transcript", text: "beta" })
  expect((await repo.list({ type: "youtube" })).map((r) => r.text)).toEqual(["beta"])
  expect((await repo.list({ q: "alph" })).map((r) => r.text)).toEqual(["alpha"])
  expect((await repo.list({ q: "keep" })).map((r) => r.text)).toEqual(["alpha"])
})

test("updateNote + remove", async () => {
  const item = await items.create({ type: "podcast", title: "Ep", audioUrl: "https://a/1.mp3" })
  const h = await repo.create({ itemId: item.id, kind: "transcript", text: "x" })
  await repo.updateNote(h.id, "my note")
  expect((await repo.list({}))[0].note).toBe("my note")
  await repo.remove(h.id)
  expect(await repo.list({})).toEqual([])
})
```

- [ ] **Step 2: Run — expect FAIL** (`npm test -- test/db/highlights.test.ts`).

- [ ] **Step 3: Create `lib/db/highlights.ts`**

```ts
import { and, desc, eq, ilike, or, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { highlights, items, type ItemType } from "./schema"
import * as schema from "./schema"
import type { HighlightKind, HighlightLocator } from "@/lib/highlights/locator"

export interface NewHighlight {
  itemId: string
  kind: HighlightKind
  text: string
  note?: string
  locator?: HighlightLocator
}

export interface HighlightRow {
  id: string
  kind: string
  text: string
  note: string | null
  locator: HighlightLocator | null
  createdAt: Date
  item: { id: string; type: ItemType; title: string; source: string | null; artworkUrl: string | null }
}

type DB = PostgresJsDatabase<typeof schema>

export function makeHighlightRepo(db: DB) {
  return {
    async create(input: NewHighlight) {
      const [row] = await db
        .insert(highlights)
        .values({
          itemId: input.itemId,
          kind: input.kind,
          text: input.text,
          note: input.note ?? null,
          locator: input.locator,
        })
        .returning()
      return row
    },

    async list(opts: { type?: string; q?: string }): Promise<HighlightRow[]> {
      const filters = []
      if (opts.type) filters.push(eq(items.type, opts.type as ItemType))
      if (opts.q && opts.q.trim()) {
        const term = `%${opts.q.trim()}%`
        filters.push(or(ilike(highlights.text, term), ilike(highlights.note, term)))
      }
      const rows = await db
        .select({
          id: highlights.id,
          kind: highlights.kind,
          text: highlights.text,
          note: highlights.note,
          locator: highlights.locator,
          createdAt: highlights.createdAt,
          itemId: items.id,
          itemType: items.type,
          itemTitle: items.title,
          source: items.podcastName,
          artworkUrl: items.artworkUrl,
        })
        .from(highlights)
        .innerJoin(items, eq(highlights.itemId, items.id))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(highlights.createdAt))
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        text: r.text,
        note: r.note,
        locator: r.locator,
        createdAt: r.createdAt,
        item: {
          id: r.itemId,
          type: r.itemType,
          title: r.itemTitle,
          source: r.source,
          artworkUrl: r.artworkUrl,
        },
      }))
    },

    async updateNote(id: string, note: string | null) {
      await db.update(highlights).set({ note }).where(eq(highlights.id, id))
    },

    async remove(id: string) {
      await db.delete(highlights).where(eq(highlights.id, id))
    },
  }
}

import { db } from "./index"
export const highlightRepo = makeHighlightRepo(db)
```

(`sql` import is unused above — remove it if `npm run lint` flags it.)

- [ ] **Step 4: Run — expect PASS** (`npm test -- test/db/highlights.test.ts`). Commit:

```bash
git add lib/db/highlights.ts test/db/highlights.test.ts
git commit -m "feat(db): highlightRepo (create/list/updateNote/remove)"
```

---

## Task 5: DTO

**Files:** Create `lib/api/highlight-dto.ts`, `test/api/highlight-dto.test.ts`.

- [ ] **Step 1: Write `test/api/highlight-dto.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { highlightToDTO } from "@/lib/api/highlight-dto"

describe("highlightToDTO", () => {
  it("maps a transcript highlight with a jump href + ISO date", () => {
    const dto = highlightToDTO({
      id: "h1",
      kind: "transcript",
      text: "hello",
      note: null,
      locator: { sec: 42 },
      createdAt: new Date("2026-01-02T03:04:05Z"),
      item: { id: "i1", type: "youtube", title: "Vid", source: "Chan", artworkUrl: null },
    })
    expect(dto).toMatchObject({
      id: "h1",
      kind: "transcript",
      text: "hello",
      note: null,
      createdAt: "2026-01-02T03:04:05.000Z",
      jumpHref: "/episodes/i1?t=42",
      item: { id: "i1", type: "youtube", title: "Vid", source: "Chan", artworkUrl: null },
    })
  })
  it("takeaway → bare item href", () => {
    const dto = highlightToDTO({
      id: "h2",
      kind: "takeaway",
      text: "t",
      note: "n",
      locator: { index: 1 },
      createdAt: new Date("2026-01-01T00:00:00Z"),
      item: { id: "i2", type: "podcast", title: "Ep", source: null, artworkUrl: null },
    })
    expect(dto.jumpHref).toBe("/episodes/i2")
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `lib/api/highlight-dto.ts`**

```ts
import type { ItemType } from "@/lib/db/schema"
import type { HighlightRow } from "@/lib/db/highlights"
import { highlightJumpHref, type HighlightKind } from "@/lib/highlights/locator"

export interface HighlightDTO {
  id: string
  kind: string
  text: string
  note: string | null
  createdAt: string
  item: { id: string; type: ItemType; title: string; source: string | null; artworkUrl: string | null }
  jumpHref: string
}

export function highlightToDTO(row: HighlightRow): HighlightDTO {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    item: row.item,
    jumpHref: highlightJumpHref(row.item.id, row.kind as HighlightKind, row.locator),
  }
}
```

- [ ] **Step 4: Run — expect PASS.** Commit:

```bash
git add lib/api/highlight-dto.ts test/api/highlight-dto.test.ts
git commit -m "feat(api): HighlightDTO serialization"
```

---

## Task 6: API routes

**Files:** Create `app/api/highlights/route.ts`, `app/api/highlights/[id]/route.ts`, `test/api/highlights-route.test.ts`.

- [ ] **Step 1: Write `test/api/highlights-route.test.ts`** (mock the repo; validation-focused)

```ts
import { afterEach, expect, test, vi } from "vitest"

const created: any[] = []
vi.mock("@/lib/db/highlights", () => ({
  highlightRepo: {
    create: vi.fn(async (v: Record<string, unknown>) => {
      const row = { id: "h-new", createdAt: new Date(), note: null, locator: null, ...v }
      created.push(row)
      return row
    }),
    list: vi.fn(async () => []),
  },
}))

afterEach(() => {
  created.length = 0
  vi.clearAllMocks()
})

test("POST creates a highlight", async () => {
  const { POST } = await import("@/app/api/highlights/route")
  const res = await POST(
    new Request("http://t/api/highlights", {
      method: "POST",
      body: JSON.stringify({ itemId: "i1", kind: "transcript", text: "hi", locator: { sec: 5 } }),
    }),
  )
  expect(res.status).toBe(201)
  expect(created[0]).toMatchObject({ itemId: "i1", kind: "transcript", text: "hi" })
})

test("POST rejects empty text", async () => {
  const { POST } = await import("@/app/api/highlights/route")
  const res = await POST(
    new Request("http://t/api/highlights", {
      method: "POST",
      body: JSON.stringify({ itemId: "i1", kind: "transcript", text: "   " }),
    }),
  )
  expect(res.status).toBe(400)
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `app/api/highlights/route.ts`**

```ts
import { highlightRepo } from "@/lib/db/highlights"
import { highlightToDTO } from "@/lib/api/highlight-dto"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const type = url.searchParams.get("type") ?? undefined
  const q = url.searchParams.get("q") ?? undefined
  const rows = await highlightRepo.list({ type, q })
  return Response.json({ highlights: rows.map(highlightToDTO) })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const text = typeof body?.text === "string" ? body.text.trim() : ""
  if (!body?.itemId || !body?.kind || !text) {
    return Response.json({ error: "itemId, kind and text are required" }, { status: 400 })
  }
  const row = await highlightRepo.create({
    itemId: body.itemId,
    kind: body.kind,
    text,
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined,
    locator: body.locator ?? undefined,
  })
  return Response.json({ highlight: row }, { status: 201 })
}
```

- [ ] **Step 4: Create `app/api/highlights/[id]/route.ts`**

```ts
import { highlightRepo } from "@/lib/db/highlights"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null
  await highlightRepo.updateNote(id, note)
  return Response.json({ status: "ok" })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await highlightRepo.remove(id)
  return Response.json({ status: "ok" })
}
```

- [ ] **Step 5: Run — expect PASS** (`npm test -- test/api/highlights-route.test.ts`); `npm run typecheck` clean. Commit:

```bash
git add app/api/highlights test/api/highlights-route.test.ts
git commit -m "feat(api): /api/highlights create/list + [id] patch/delete"
```

---

## Task 7: Selection layer (Highlightable + popover + hook)

**Files:** Create `components/highlightable.tsx`, `components/highlight-layer.tsx`.

- [ ] **Step 1: Create `components/highlightable.tsx`**

```tsx
"use client"

import type { ReactNode } from "react"
import type { HighlightKind } from "@/lib/highlights/locator"

/** Stamps the data attributes the selection layer reads. Wrap any highlightable
 *  region (transcript line, takeaway, quote). `sec`/`index` feed the locator. */
export function Highlightable({
  kind,
  sec,
  index,
  as: Tag = "div",
  className,
  children,
}: {
  kind: HighlightKind
  sec?: number
  index?: number
  as?: "div" | "p" | "li" | "span" | "blockquote"
  className?: string
  children: ReactNode
}) {
  return (
    <Tag
      data-hl-kind={kind}
      data-hl-sec={sec != null ? String(sec) : undefined}
      data-hl-index={index != null ? String(index) : undefined}
      className={className}
    >
      {children}
    </Tag>
  )
}
```

- [ ] **Step 2: Create `components/highlight-layer.tsx`**

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { buildLocator, type HighlightKind } from "@/lib/highlights/locator"

type Pending = { x: number; y: number; kind: HighlightKind; text: string; data: Record<string, string | undefined> }

/** Mounted once on a detail view. Watches for a text selection that lands inside a
 *  [data-hl-kind] region and offers a floating "Highlight" button that POSTs it. */
export function HighlightLayer({ itemId }: { itemId: string }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onUp() {
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ""
      if (!sel || sel.rangeCount === 0 || !text) {
        setPending(null)
        return
      }
      const node = sel.anchorNode
      const el = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-hl-kind]")
      if (!el) {
        setPending(null)
        return
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      setPending({
        x: rect.left + rect.width / 2,
        y: rect.top,
        kind: (el.dataset.hlKind as HighlightKind) ?? "transcript",
        text,
        data: { hlSec: el.dataset.hlSec, hlIndex: el.dataset.hlIndex },
      })
    }
    document.addEventListener("mouseup", onUp)
    return () => document.removeEventListener("mouseup", onUp)
  }, [])

  async function save() {
    if (!pending) return
    const body = {
      itemId,
      kind: pending.kind,
      text: pending.text,
      locator: buildLocator(pending.kind, pending.data),
    }
    setPending(null)
    window.getSelection()?.removeAllRanges()
    try {
      const res = await fetch("/api/highlights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast.success("Highlighted")
    } catch {
      toast.error("Couldn't save highlight")
    }
  }

  if (!pending) return null
  return (
    <div
      ref={barRef}
      style={{ left: pending.x, top: pending.y - 44 }}
      className="fixed z-50 -translate-x-1/2"
      onMouseDown={(e) => e.preventDefault()} // keep the selection while clicking
    >
      <button
        type="button"
        onClick={save}
        className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-lg"
      >
        Highlight
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Verify** — `npm run typecheck` clean; `npm run build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/highlightable.tsx components/highlight-layer.tsx
git commit -m "feat(highlights): selection popover + Highlightable wrapper"
```

---

## Task 8: Wire data attributes into transcript + insights, mount the layer

**Files:** Modify `components/live-transcript.tsx`, `components/episode-insights.tsx`, `components/episode-view.tsx`.

- [ ] **Step 1: Transcript lines** — in `components/live-transcript.tsx`, add the two data attributes to the segment `<p>` (alongside its existing props):

```tsx
            <p
              key={s.start ?? i}
              ref={i === focusIndex ? targetRef : undefined}
              onClick={() => seekToLine(s.start)}
              data-hl-kind="transcript"
              data-hl-sec={String(s.start)}
              className={[ /* ...unchanged... */ ]
                .filter(Boolean)
                .join(" ")}
            >
```

(Leave everything else in the `<p>` unchanged.)

- [ ] **Step 2: Takeaways + quotes** — in `components/episode-insights.tsx`:
  - Takeaway `<li>` (the `takeaways.map`): add `data-hl-kind="takeaway"` and `data-hl-index={String(i)}` to the `<li>`.
  - Quote `<blockquote>` (the `quotes.map`): add `data-hl-kind="quote"`, `data-hl-index={String(i)}`, `data-hl-sec={String(q.approxTimestampSec)}` to the `<blockquote>`.

- [ ] **Step 3: Mount the layer** — in `components/episode-view.tsx`, import `HighlightLayer` and render it once inside the top-level fragment (it's `position: fixed`, so placement is flexible; put it just before the closing `</>`), passing the item id:

```tsx
import { HighlightLayer } from "@/components/highlight-layer"
// ...
      {/* existing InsightsNav block ... */}
      <HighlightLayer itemId={episode.id} />
    </>
```

- [ ] **Step 4: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors.

- [ ] **Step 5: Commit**

```bash
git add components/live-transcript.tsx components/episode-insights.tsx components/episode-view.tsx
git commit -m "feat(highlights): make transcript/takeaways/quotes highlightable"
```

---

## Task 9: Highlights page + sidebar entry

**Files:** Create `app/highlights/page.tsx`, `components/highlights-feed.tsx`; Modify `components/app-sidebar.tsx`.

- [ ] **Step 1: Create `components/highlights-feed.tsx`** (client; filters + search + cards)

```tsx
"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { hiResArtwork } from "@/lib/artwork"
import { formatRelativeDate } from "@/lib/format"
import type { HighlightDTO } from "@/lib/api/highlight-dto"

const TYPES = [
  { key: "all", label: "All" },
  { key: "podcast", label: "Podcasts" },
  { key: "youtube", label: "Videos" },
  { key: "article", label: "Articles" },
  { key: "kindle", label: "Kindle" },
]

export function HighlightsFeed({ initial }: { initial: HighlightDTO[] }) {
  const router = useRouter()
  const [items, setItems] = useState(initial)
  const [type, setType] = useState("all")
  const [q, setQ] = useState("")

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return items.filter(
      (h) =>
        (type === "all" || h.item.type === type) &&
        (!term || h.text.toLowerCase().includes(term) || (h.note ?? "").toLowerCase().includes(term)),
    )
  }, [items, type, q])

  async function remove(id: string) {
    setItems((xs) => xs.filter((h) => h.id !== id))
    await fetch(`/api/highlights/${id}`, { method: "DELETE" }).catch(() => {})
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setType(t.key)}
            className={
              "rounded-full border px-3 py-1 text-sm " +
              (type === t.key ? "bg-foreground text-background" : "hover:bg-muted")
            }
          >
            {t.label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search highlights…"
          className="ml-auto rounded-lg border bg-background px-3 py-1.5 text-sm outline-none"
        />
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No highlights yet — select text in a transcript or insight to save one.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((h) => (
            <li key={h.id} className="group rounded-xl border p-4">
              <button
                type="button"
                onClick={() => router.push(h.jumpHref)}
                className="block w-full text-left font-serif text-lg leading-relaxed"
              >
                {h.text}
              </button>
              {h.note && <p className="mt-2 text-sm text-muted-foreground">{h.note}</p>}
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Link href={`/episodes/${h.item.id}`} className="flex min-w-0 items-center gap-2 hover:text-foreground">
                  <span className="size-6 shrink-0 overflow-hidden rounded bg-muted">
                    {h.item.artworkUrl ? (
                      <img src={hiResArtwork(h.item.artworkUrl, 60)} alt="" className="size-full object-cover" />
                    ) : null}
                  </span>
                  <span className="truncate">{h.item.title}</span>
                </Link>
                <span aria-hidden>·</span>
                <span className="capitalize">{h.item.type}</span>
                <span aria-hidden>·</span>
                <span>{formatRelativeDate(h.createdAt)}</span>
                <button
                  type="button"
                  onClick={() => remove(h.id)}
                  aria-label="Delete highlight"
                  className="ml-auto opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `app/highlights/page.tsx`** (server component → repo → DTO)

```tsx
import { db } from "@/lib/db"
import { makeHighlightRepo } from "@/lib/db/highlights"
import { highlightToDTO } from "@/lib/api/highlight-dto"
import { AppHeader } from "@/components/app-header"
import { HighlightsFeed } from "@/components/highlights-feed"

export const dynamic = "force-dynamic"

export default async function HighlightsPage() {
  const rows = await makeHighlightRepo(db).list({})
  const highlights = rows.map(highlightToDTO)
  return (
    <>
      <AppHeader breadcrumbs={[{ label: "Highlights" }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
          <HighlightsFeed initial={highlights} />
        </div>
      </div>
    </>
  )
}
```

(If `AppHeader`'s `breadcrumbs` prop shape differs, match the existing usage in `app/episodes/[id]/page.tsx` / `ask-view.tsx`.)

- [ ] **Step 3: Sidebar entry** — in `components/app-sidebar.tsx`, add a nav link to `/highlights` labeled "Highlights" with a `Highlighter` (lucide) icon, following the existing nav-item pattern in that file (match how "Ask"/"Search"/library links are rendered).

- [ ] **Step 4: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/highlights components/highlights-feed.tsx components/app-sidebar.tsx
git commit -m "feat(highlights): /highlights feed page + sidebar entry"
```

---

## Task 10: Final verification

- [ ] **Step 1:** `npm run typecheck` (clean); `npm test` (all pass — new locator/dto/repo/route tests included); `npm run build` (succeeds); `npm run lint` (no new errors vs. the pre-existing 11).
- [ ] **Step 2 (manual):** on a podcast and a YouTube detail page, select text in the transcript, a takeaway, and a quote → "Highlight" appears → save → it shows on `/highlights`. Filter by type, search, click a highlight (jumps to the item, cueing audio bar / video mini for timestamped ones), delete one.

---

## Self-Review (plan author)

- **Spec coverage:** model + `kind`/`locator` ✅ (Tasks 2–3); repo/API/DTO + `jumpHref` ✅ (Tasks 4–6); free-text selection via `Highlightable` + hook + popover + `buildLocator` ✅ (Tasks 7–8) wired into transcript/takeaways/quotes ✅; `/highlights` flat feed + type filter + search + delete + edit-note API ✅ (Task 9); notes supported in model/API/DTO ✅. Deferred (inline re-marking, Article/Kindle) intentionally absent.
- **Placeholder scan:** none — full code or exact edit instructions per step. The two "match existing pattern" notes (sidebar item, AppHeader breadcrumb shape) are delegated with a concrete reference file because those conventions live in code, not the spec.
- **Type consistency:** `HighlightKind`/`HighlightLocator` (locator.ts) used everywhere; `NewHighlight`/`HighlightRow` (repo) → `highlightToDTO` → `HighlightDTO`; `buildLocator(kind, data)` and `highlightJumpHref(itemId, kind, locator)` signatures consistent across tasks; data attributes `data-hl-kind/-sec/-index` consistent between `Highlightable`, the wiring, and the hook.
- **Note on edit-note UI:** the PATCH endpoint exists; the feed wires delete + (note display). Inline note-editing UI is a tiny follow-up if desired — the API supports it.
