# Inline Highlights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-draw saved highlights inside the article body and insights (takeaways, quotes), and let the user click a highlight to remove it via a small popover.

**Architecture:** The episode page fetches the item's highlights and seeds a client `HighlightsProvider` (holds the list + add/remove + a shared remove-popover). Two marking mechanisms read it: a pure `splitForMarks` splitter drives `MarkedText` for React-rendered insights, and a `HighlightedHtml` text-node walker marks the uncontrolled article prose. Unfindable snapshots are silently skipped.

**Tech Stack:** Next.js 16, React 19, Drizzle (postgres-js), Vitest, Tailwind v4, sonner.

**Spec:** `docs/superpowers/specs/2026-06-13-inline-highlights-design.md`

## File Structure

- **Create:** `lib/highlights/mark-text.ts` (+ `test/highlights/mark-text.test.ts`), `components/highlights-context.tsx`, `components/highlight-marks.tsx`.
- **Modify:** `lib/db/highlights.ts` (+ `test/db/highlights.test.ts`) and `app/api/highlights/route.ts` (`itemId` filter); `app/episodes/[id]/page.tsx` (fetch + pass highlights); `components/episode-view.tsx` (provider + article body); `components/episode-insights.tsx` (mark takeaways/quotes); `components/highlight-layer.tsx` (call `add` on save).

---

## Task 1: `itemId` filter on the highlights repo + route

**Files:** Modify `lib/db/highlights.ts`, `app/api/highlights/route.ts`; Test `test/db/highlights.test.ts`.

- [ ] **Step 1: Add a failing test** to `test/db/highlights.test.ts` (append; reuses the file's existing `items`/`repo`/setup):

```ts
test("list filters by itemId", async () => {
  const a = await items.create({ type: "podcast", title: "A", audioUrl: "https://a/a.mp3" })
  const b = await items.create({ type: "podcast", title: "B", audioUrl: "https://a/b.mp3" })
  await repo.create({ itemId: a.id, kind: "transcript", text: "from a" })
  await repo.create({ itemId: b.id, kind: "transcript", text: "from b" })
  const rows = await repo.list({ itemId: a.id })
  expect(rows.map((r) => r.text)).toEqual(["from a"])
})
```

- [ ] **Step 2: Run — expect FAIL** (`npm test -- test/db/highlights.test.ts`).

- [ ] **Step 3: Add the filter** in `lib/db/highlights.ts`. Change the `list` signature and add a filter:

```ts
    async list(opts: { type?: string; q?: string; itemId?: string }): Promise<HighlightRow[]> {
      const filters = []
      if (opts.itemId) filters.push(eq(highlights.itemId, opts.itemId))
      if (opts.type) filters.push(eq(items.type, opts.type as ItemType))
      if (opts.q && opts.q.trim()) {
        const term = `%${opts.q.trim()}%`
        filters.push(or(ilike(highlights.text, term), ilike(highlights.note, term)))
      }
```

(Leave the rest of `list` unchanged — `eq` is already imported.)

- [ ] **Step 4: Pass it through the route** in `app/api/highlights/route.ts` `GET`:

```ts
export async function GET(request: Request) {
  const url = new URL(request.url)
  const type = url.searchParams.get("type") ?? undefined
  const q = url.searchParams.get("q") ?? undefined
  const itemId = url.searchParams.get("itemId") ?? undefined
  const rows = await highlightRepo.list({ type, q, itemId })
  return Response.json({ highlights: rows.map(highlightToDTO) })
}
```

- [ ] **Step 5: Run — expect PASS**; `npm run typecheck` clean. Commit:

```bash
git add lib/db/highlights.ts app/api/highlights/route.ts test/db/highlights.test.ts
git commit -m "feat(highlights): itemId filter on repo list + GET route"
```

---

## Task 2: `splitForMarks` pure splitter (TDD)

**Files:** Create `lib/highlights/mark-text.ts`, `test/highlights/mark-text.test.ts`.

- [ ] **Step 1: Write `test/highlights/mark-text.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { splitForMarks } from "@/lib/highlights/mark-text"

describe("splitForMarks", () => {
  it("wraps a single match, keeping surrounding text", () => {
    expect(splitForMarks("the quick brown fox", [{ id: "h1", text: "quick brown" }])).toEqual([
      { text: "the " },
      { text: "quick brown", id: "h1" },
      { text: " fox" },
    ])
  })
  it("handles multiple non-overlapping matches in order", () => {
    expect(
      splitForMarks("a b c", [
        { id: "h2", text: "c" },
        { id: "h1", text: "a" },
      ]),
    ).toEqual([
      { text: "a", id: "h1" },
      { text: " b ", id: undefined },
      { text: "c", id: "h2" },
    ])
  })
  it("first wins on overlap; later overlapping match is skipped", () => {
    expect(
      splitForMarks("hello world", [
        { id: "h1", text: "hello world" },
        { id: "h2", text: "world" },
      ]),
    ).toEqual([{ text: "hello world", id: "h1" }])
  })
  it("returns the whole text when nothing matches", () => {
    expect(splitForMarks("nothing here", [{ id: "h1", text: "absent" }])).toEqual([
      { text: "nothing here" },
    ])
  })
})
```

(Note: the `{ text: " b ", id: undefined }` entry — plain segments may omit `id`; `toEqual` treats a missing key and `undefined` as equal, so the implementation may push `{ text }` without `id`.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `lib/highlights/mark-text.ts`**

```ts
export type MarkSegment = { text: string; id?: string }

/** Split `text` into segments, wrapping the first non-overlapping occurrence of
 *  each mark's snapshot. Earlier marks win on overlap; unmatched marks are skipped.
 *  Pure — the React layer maps segments with an `id` to <mark>. */
export function splitForMarks(
  text: string,
  marks: { id: string; text: string }[],
): MarkSegment[] {
  const ranges: { start: number; end: number; id: string }[] = []
  for (const m of marks) {
    const needle = m.text.trim()
    if (!needle) continue
    const start = text.indexOf(needle)
    if (start < 0) continue
    const end = start + needle.length
    if (ranges.some((r) => start < r.end && end > r.start)) continue // overlap → skip
    ranges.push({ start, end, id: m.id })
  }
  ranges.sort((a, b) => a.start - b.start)

  const out: MarkSegment[] = []
  let pos = 0
  for (const r of ranges) {
    if (r.start > pos) out.push({ text: text.slice(pos, r.start) })
    out.push({ text: text.slice(r.start, r.end), id: r.id })
    pos = r.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos) })
  if (out.length === 0) out.push({ text })
  return out
}
```

- [ ] **Step 4: Run — expect PASS.** Commit:

```bash
git add lib/highlights/mark-text.ts test/highlights/mark-text.test.ts
git commit -m "feat(highlights): splitForMarks text splitter"
```

---

## Task 3: `HighlightsProvider` context + remove popover

**Files:** Create `components/highlights-context.tsx`.

- [ ] **Step 1: Create `components/highlights-context.tsx`**

```tsx
"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import type { HighlightLocator } from "@/lib/highlights/locator"

export type InlineHighlight = {
  id: string
  kind: string
  text: string
  note: string | null
  locator: HighlightLocator | null
}

type Ctx = {
  highlights: InlineHighlight[]
  add: (h: InlineHighlight) => void
  remove: (id: string) => Promise<void>
  openMark: (id: string, rect: DOMRect) => void
}

const HighlightsContext = createContext<Ctx | null>(null)

/** Throws if no provider — use in surfaces always rendered inside the detail view. */
export function useHighlights(): Ctx {
  const c = useContext(HighlightsContext)
  if (!c) throw new Error("useHighlights must be used within HighlightsProvider")
  return c
}

/** Returns null when there's no provider — for shared surfaces that may render
 *  outside a detail view (they fall back to plain, unmarked text). */
export function useHighlightsOptional(): Ctx | null {
  return useContext(HighlightsContext)
}

export function HighlightsProvider({
  initial,
  children,
}: {
  initial: InlineHighlight[]
  children: ReactNode
}) {
  const [highlights, setHighlights] = useState<InlineHighlight[]>(initial)
  const [active, setActive] = useState<{ id: string; rect: DOMRect } | null>(null)

  const add = useCallback((h: InlineHighlight) => {
    setHighlights((xs) => (xs.some((x) => x.id === h.id) ? xs : [h, ...xs]))
  }, [])

  const remove = useCallback(async (id: string) => {
    setActive(null)
    let rolledBack: InlineHighlight[] = []
    setHighlights((xs) => {
      rolledBack = xs
      return xs.filter((x) => x.id !== id)
    })
    try {
      const res = await fetch(`/api/highlights/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
    } catch {
      setHighlights(rolledBack)
      toast.error("Couldn't remove highlight")
    }
  }, [])

  const openMark = useCallback((id: string, rect: DOMRect) => setActive({ id, rect }), [])

  const value = useMemo(() => ({ highlights, add, remove, openMark }), [highlights, add, remove, openMark])
  const activeHl = active ? highlights.find((h) => h.id === active.id) ?? null : null

  return (
    <HighlightsContext.Provider value={value}>
      {children}
      {active && activeHl && (
        <RemovePopover
          rect={active.rect}
          note={activeHl.note}
          onRemove={() => void remove(active.id)}
          onClose={() => setActive(null)}
        />
      )}
    </HighlightsContext.Provider>
  )
}

function RemovePopover({
  rect,
  note,
  onRemove,
  onClose,
}: {
  rect: DOMRect
  note: string | null
  onRemove: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // Defer so the opening click doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener("mousedown", onDown)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{ left: rect.left + rect.width / 2, top: Math.max(8, rect.top - 8) }}
      className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-xl border bg-popover p-3 text-sm shadow-md"
    >
      {note && <p className="mb-2 max-w-60 text-muted-foreground">{note}</p>}
      <button
        type="button"
        onClick={onRemove}
        className="font-medium text-destructive hover:underline"
      >
        Remove highlight
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` clean.

- [ ] **Step 3: Commit**

```bash
git add components/highlights-context.tsx
git commit -m "feat(highlights): HighlightsProvider context + remove popover"
```

---

## Task 4: Marking components — `MarkedText` + `HighlightedHtml`

**Files:** Create `components/highlight-marks.tsx`.

- [ ] **Step 1: Create `components/highlight-marks.tsx`**

```tsx
"use client"

import { useEffect, useRef } from "react"
import { splitForMarks } from "@/lib/highlights/mark-text"

const MARK_CLASS =
  "rounded-[3px] bg-primary/15 hover:bg-primary/25 transition-colors cursor-pointer"

/** Render a plain string with saved highlights wrapped in clickable <mark>s.
 *  For React-controlled text (insights takeaways/quotes). */
export function MarkedText({
  text,
  marks,
  onMarkClick,
}: {
  text: string
  marks: { id: string; text: string }[]
  onMarkClick: (id: string, rect: DOMRect) => void
}) {
  const segments = splitForMarks(text, marks)
  return (
    <>
      {segments.map((s, i) =>
        s.id ? (
          <mark
            key={i}
            data-hl-id={s.id}
            className={MARK_CLASS}
            onClick={(e) => onMarkClick(s.id!, e.currentTarget.getBoundingClientRect())}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

/** Render sanitized article HTML, then wrap the first single-text-node occurrence
 *  of each highlight snapshot in a clickable <mark>. The subtree is uncontrolled
 *  (set via innerHTML), so direct DOM mutation is safe. */
export function HighlightedHtml({
  html,
  marks,
  onMarkClick,
  className,
}: {
  html: string
  marks: { id: string; text: string }[]
  onMarkClick: (id: string, rect: DOMRect) => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    root.innerHTML = html
    for (const m of marks) {
      const needle = m.text.trim()
      if (!needle) continue
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode() as Text | null
      while (node) {
        const idx = node.nodeValue?.indexOf(needle) ?? -1
        if (idx >= 0) {
          const range = document.createRange()
          range.setStart(node, idx)
          range.setEnd(node, idx + needle.length)
          const mark = document.createElement("mark")
          mark.setAttribute("data-hl-id", m.id)
          mark.className = MARK_CLASS
          try {
            range.surroundContents(mark)
          } catch {
            // Selection crossed an element boundary — skip this one.
          }
          break
        }
        node = walker.nextNode() as Text | null
      }
    }
  }, [html, marks])

  useEffect(() => {
    const root = ref.current
    if (!root) return
    function onClick(e: MouseEvent) {
      const mark = (e.target as HTMLElement)?.closest?.("mark[data-hl-id]") as HTMLElement | null
      if (mark) onMarkClick(mark.getAttribute("data-hl-id")!, mark.getBoundingClientRect())
    }
    root.addEventListener("click", onClick)
    return () => root.removeEventListener("click", onClick)
  }, [onMarkClick])

  return <div ref={ref} data-hl-kind="article" className={className} />
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` clean; `npm run build` succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/highlight-marks.tsx
git commit -m "feat(highlights): MarkedText + HighlightedHtml marking components"
```

---

## Task 5: Wire the article body + provider + page fetch

**Files:** Modify `app/episodes/[id]/page.tsx`, `components/episode-view.tsx`.

- [ ] **Step 1: Fetch highlights in `app/episodes/[id]/page.tsx`.** Add the import and fetch, and pass to `EpisodeView`:

```ts
import { highlightRepo } from "@/lib/db/highlights"
```
After the `entities` fetch:
```ts
  const highlightRows = await highlightRepo.list({ itemId: id })
  const highlights = highlightRows.map((h) => ({
    id: h.id,
    kind: h.kind,
    text: h.text,
    note: h.note,
    locator: h.locator,
  }))
```
Add the prop to the `<EpisodeView ... />`:
```tsx
        highlights={highlights}
```

- [ ] **Step 2: Accept the prop + mount the provider in `components/episode-view.tsx`.** Add imports:
```tsx
import { HighlightsProvider, type InlineHighlight } from "@/components/highlights-context"
import { HighlightedHtml } from "@/components/highlight-marks"
```
Add `highlights` to `EpisodeViewProps`:
```tsx
  entities?: MentionedEntity[]
  highlights?: InlineHighlight[]
```
Destructure it in the component signature (default `[]`):
```tsx
export function EpisodeView({ episode, transcript, insights, entities = [], highlights = [] }: EpisodeViewProps) {
```
Wrap the entire returned tree in the provider. The current return is `return ( <> ... </> )`. Change to:
```tsx
  return (
    <HighlightsProvider initial={highlights}>
      <>
        {/* ...existing AppHeader + content + InsightsNav + <HighlightLayer/> ... */}
      </>
    </HighlightsProvider>
  )
```
(Keep the existing `<HighlightLayer itemId={episode.id} />` where it is, now inside the provider.)

- [ ] **Step 3: Render the article body through `HighlightedHtml`.** In the `ArticleBody` component, it currently consumes its props. Make it read the context for article marks. Add at the top of `ArticleBody`:
```tsx
import { useHighlights } from "@/components/highlights-context"
```
(put with the other imports). Inside `ArticleBody`, before the return:
```tsx
  const { highlights, openMark } = useHighlights()
  const articleMarks = highlights
    .filter((h) => h.kind === "article")
    .map((h) => ({ id: h.id, text: h.text }))
```
Replace the existing body `<div data-hl-kind="article" className="prose ..." dangerouslySetInnerHTML={{ __html: contentHtml }} />` with:
```tsx
        <HighlightedHtml
          html={contentHtml}
          marks={articleMarks}
          onMarkClick={openMark}
          className="prose prose-lg prose-neutral max-w-none font-serif leading-relaxed dark:prose-invert prose-img:rounded-lg"
        />
```
(Use the EXACT className currently on that div — copy it verbatim from the file; the string above reflects the current classes but confirm and match. The `eslint-disable-next-line react/no-danger` comment that was above the old div can be removed.)

- [ ] **Step 4: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors (baseline 11).

- [ ] **Step 5: Commit**

```bash
git add "app/episodes/[id]/page.tsx" components/episode-view.tsx
git commit -m "feat(highlights): seed provider + mark the article body inline"
```

---

## Task 6: Mark insights (takeaways, quotes) + instant-mark on create

**Files:** Modify `components/episode-insights.tsx`, `components/highlight-layer.tsx`.

- [ ] **Step 1: Mark takeaways + quotes in `components/episode-insights.tsx`.** Add imports:
```tsx
import { useHighlightsOptional } from "@/components/highlights-context"
import { MarkedText } from "@/components/highlight-marks"
```
Inside `EpisodeInsights`, after the existing destructuring of `chapters/takeaways/quotes/...`, add:
```tsx
  const hl = useHighlightsOptional()
  const marksFor = (kind: string, index: number) =>
    (hl?.highlights ?? [])
      .filter((h) => h.kind === kind && h.locator?.index === index)
      .map((h) => ({ id: h.id, text: h.text }))
```
Takeaway render — replace the `<span>{t}</span>` inside the takeaway `<li>` with:
```tsx
                <span>
                  {hl ? <MarkedText text={t} marks={marksFor("takeaway", i)} onMarkClick={hl.openMark} /> : t}
                </span>
```
Quote render — replace the bare `&ldquo;{q.text}&rdquo;` text with a marked version (keep the surrounding `&ldquo;`/`&rdquo;` and the timestamp button exactly as they are):
```tsx
                &ldquo;{hl ? <MarkedText text={q.text} marks={marksFor("quote", i)} onMarkClick={hl.openMark} /> : q.text}&rdquo;{" "}
```
(Leave the `data-hl-kind`/`data-hl-index`/`data-hl-sec` attributes on the `<li>`/`<blockquote>` untouched — they drive *creating* new highlights.)

- [ ] **Step 2: Instant-mark on create in `components/highlight-layer.tsx`.** It POSTs a new highlight; make it push the created row into the provider so the mark appears immediately. Add import:
```tsx
import { useHighlights } from "@/components/highlights-context"
```
In the component, get `add`:
```tsx
  const { add } = useHighlights()
```
In `save()`, change the success path to read the created row and call `add`. The current success branch is roughly `if (!res.ok) throw new Error(); toast.success("Highlighted")`. Replace with:
```tsx
      if (!res.ok) throw new Error()
      const { highlight } = await res.json()
      add({
        id: highlight.id,
        kind: highlight.kind,
        text: highlight.text,
        note: highlight.note ?? null,
        locator: highlight.locator ?? null,
      })
      toast.success("Highlighted")
```
(The `POST /api/highlights` returns `{ highlight: row }` where `row` has `id`, `kind`, `text`, `note`, `locator`.)

NOTE: `HighlightLayer` is mounted inside `HighlightsProvider` (Task 5), so `useHighlights()` is valid. If `npm run build` reports `useHighlights must be used within HighlightsProvider`, confirm the provider wraps `<HighlightLayer/>` (it should, per Task 5 Step 2).

- [ ] **Step 3: Verify** — `npm run typecheck` clean; `npm run build` succeeds; `npm run lint` no new errors (baseline 11).

- [ ] **Step 4: Commit**

```bash
git add components/episode-insights.tsx components/highlight-layer.tsx
git commit -m "feat(highlights): mark takeaways/quotes inline + instant mark on create"
```

---

## Task 7: Final verification

- [ ] **Step 1:** `npm run typecheck` (clean); `npm test` (all pass — new mark-text + repo itemId tests included; run ONCE — concurrent vitest runs corrupt the shared test DB); `npm run build` (succeeds); `npm run lint` (no new errors vs. the pre-existing 11).
- [ ] **Step 2 (manual):** on an article and a podcast/video: existing highlights appear marked in the body / takeaways / quotes; selecting new text → "Highlight" → it marks instantly; clicking a mark opens the popover (note shown if present) → Remove deletes it and the text reflows; reload shows the same marks; an edited/unfindable snapshot simply isn't marked (still on `/highlights`).

---

## Self-Review (plan author)

- **Spec coverage:** `itemId` filter (Task 1); two mechanisms — `splitForMarks`/`MarkedText` for insights (Tasks 2, 4, 6) and `HighlightedHtml` walker for the article (Tasks 4, 5); per-kind anchoring — article body, takeaway/quote by `locator.index` (Tasks 5, 6); click→popover with note + Remove and optimistic delete+rollback (Task 3); instant mark on create (Task 6); silently skip unfindable (`splitForMarks` skips no-match; `HighlightedHtml` `try/catch` + first-text-node only) ✅; themed style `bg-primary/15` (Task 4); transcript deferred (not wired) ✅.
- **Placeholder scan:** none — full code per step. The one "match the verbatim className" note (Task 5 Step 3) points at existing code because that class string lives in the file, not the spec; the current value is reproduced for reference.
- **Type consistency:** `InlineHighlight {id,kind,text,note,locator}` defined in `highlights-context.tsx` and reused by the page map (Task 5) and `add` (Task 6); `splitForMarks(text, marks:{id,text}[])` → `MarkSegment {text,id?}` consistent across Tasks 2/4; `openMark(id, rect)` / `onMarkClick(id, rect)` signature identical in context, `MarkedText`, `HighlightedHtml`; `marksFor` returns `{id,text}[]` matching both components' `marks` prop; `useHighlights` (throwing) used inside the provider (ArticleBody, HighlightLayer), `useHighlightsOptional` used by the shared `EpisodeInsights`.
