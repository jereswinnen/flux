# DB & Migration Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile drifted index names, give `transcripts` a `UNIQUE(item_id)` + an atomic `processContent` rebuild, and remove the `drizzle-kit generate` footgun — backend plumbing only, no API/UI behavior change.

**Architecture:** Two hand-authored migrations (index renames; transcript dedupe + unique index) registered in `_journal.json`; a `processContent` restructure that computes insights/embeddings before an atomic delete+insert transaction; a migrations README + neutralized `db:generate` script.

**Tech Stack:** Drizzle (postgres-js) + Postgres, Vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-06-13-db-migration-hygiene-design.md`

**Verified facts:** live DB has `episode_entities_entity_idx` on `item_entities`, `conversations_episode_updated_idx` on `conversations`, PK `episode_entities_episode_id_entity_id_pk` on `item_entities`; `transcripts` has only `transcripts_pkey`; `meta/` snapshots exist only through `0004`; last `_journal.json` entry is `idx: 9` (`0009_highlight_embedding_index`).

## File Structure
- **Create:** `lib/db/migrations/0010_index_renames.sql`, `lib/db/migrations/0011_transcript_unique.sql`, `lib/db/migrations/README.md`.
- **Modify:** `lib/db/migrations/meta/_journal.json`, `lib/db/schema.ts` (transcripts unique index), `lib/pipeline/process-content.ts` (transaction), `package.json` (`db:generate` script), `test/pipeline/process-content-article.test.ts` (or a sibling) for the replace-not-duplicate case.

---

## Task 1: Index-rename migration (0010)

**Files:** Create `lib/db/migrations/0010_index_renames.sql`; Modify `lib/db/migrations/meta/_journal.json`.

- [ ] **Step 1: Create `lib/db/migrations/0010_index_renames.sql`** (verbatim)

```sql
ALTER INDEX "episode_entities_entity_idx" RENAME TO "item_entities_entity_idx";--> statement-breakpoint
ALTER INDEX "conversations_episode_updated_idx" RENAME TO "conversations_item_updated_idx";--> statement-breakpoint
ALTER TABLE "item_entities" RENAME CONSTRAINT "episode_entities_episode_id_entity_id_pk" TO "item_entities_item_id_entity_id_pk";
```

- [ ] **Step 2: Append to `lib/db/migrations/meta/_journal.json`** entries array (after the `idx: 9` entry — comma after its closing brace):

```json
    {
      "idx": 10,
      "version": "7",
      "when": 1781700000000,
      "tag": "0010_index_renames",
      "breakpoints": true
    }
```

- [ ] **Step 3: Apply** — `npm run db:migrate`. Expected: `migrations applied`, no error. If the PK-constraint `RENAME CONSTRAINT` errors (name differs at apply time), remove that third statement, re-run, and report.

- [ ] **Step 4: Verify** — query `pg_indexes`/constraints (a quick `tsx` script or psql) to confirm `item_entities_entity_idx` and `conversations_item_updated_idx` now exist. Commit:

```bash
git add lib/db/migrations/0010_index_renames.sql lib/db/migrations/meta/_journal.json
git commit -m "chore(db): reconcile drifted index names to item_* (migration 0010)"
```

---

## Task 2: Transcript unique index (0011) + schema

**Files:** Create `lib/db/migrations/0011_transcript_unique.sql`; Modify `lib/db/migrations/meta/_journal.json`, `lib/db/schema.ts`.

- [ ] **Step 1: Create `lib/db/migrations/0011_transcript_unique.sql`** (dedupe first, then unique index — verbatim)

```sql
DELETE FROM "transcripts" t USING "transcripts" d
  WHERE t.item_id = d.item_id AND t.ctid < d.ctid;--> statement-breakpoint
CREATE UNIQUE INDEX "transcripts_item_unique" ON "transcripts" ("item_id");
```

- [ ] **Step 2: Append journal entry** (`idx: 11`, `when: 1781800000000`, `tag: "0011_transcript_unique"`, `breakpoints: true`).

- [ ] **Step 3: Update `lib/db/schema.ts`** — add the unique index to the `transcripts` table. Add `uniqueIndex` to the `drizzle-orm/pg-core` import, and change the table to use the index callback:

```ts
export const transcripts = pgTable(
  "transcripts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    fullText: text("full_text").notNull(),
    segments: jsonb("segments").$type<TranscriptSegment[]>(),
    contentHtml: text("content_html"),
  },
  (t) => [uniqueIndex("transcripts_item_unique").on(t.itemId)],
)
```

- [ ] **Step 4: Apply** — `npm run db:migrate` (expect applied); `npm run typecheck` clean.

- [ ] **Step 5: Verify** `transcripts_item_unique` exists (pg_indexes). Commit:

```bash
git add lib/db/migrations/0011_transcript_unique.sql lib/db/migrations/meta/_journal.json lib/db/schema.ts
git commit -m "feat(db): UNIQUE(transcripts.item_id) (dedupe + migration 0011)"
```

---

## Task 3: Atomic `processContent` rebuild (TDD)

**Files:** Modify `lib/pipeline/process-content.ts`; Test `test/pipeline/process-content-article.test.ts`.

- [ ] **Step 1: Add a failing test** — append to `test/pipeline/process-content-article.test.ts` a case asserting a second run replaces (not duplicates) the transcript row:

```ts
test("re-processing replaces the transcript row, not duplicates it", async () => {
  const item = await items.create({ type: "article", title: "A", sourceUrl: "https://x/y" })
  const run = (html: string) =>
    processContent(
      { itemId: item.id, transcript: "body", segments: [{ start: 0, end: 0, text: "body" }], contentHtml: html },
      {
        db,
        generateInsights: async () => ({ summary: "s", takeaways: [], topics: [], chapters: [], quotes: [], entities: [] }),
        embedTexts: async (t) => t.map(() => Array(1536).fill(0)),
        resolveEntities: async () => {},
      },
    )
  await run("<p>one</p>")
  await run("<p>two</p>")
  const rows = await db.select().from(schema.transcripts).where(eq(schema.transcripts.itemId, item.id))
  expect(rows).toHaveLength(1)
  expect(rows[0].contentHtml).toBe("<p>two</p>")
})
```

(Match the existing imports/helpers in the file — `items`, `db`, `schema`, `eq`, `processContent`. Adjust the `Insights` stub shape if the file already defines a helper for it.)

- [ ] **Step 2: Run — expect FAIL** before the restructure only if a duplicate is possible; it may already pass via delete-then-insert. Either way, keep the test (it guards the invariant). Run `npm test -- test/pipeline/process-content-article.test.ts`.

- [ ] **Step 3: Restructure `lib/pipeline/process-content.ts`.** Replace the `try { … }` body so the slow work runs before an atomic swap. The new shape:

```ts
  try {
    // 1. Compute the slow, network-bound work FIRST — before touching stored data.
    await repo.updateStatus(result.itemId, "analyzing")
    const insights = await genInsights(result.transcript, result.segments)
    const chunks = chunkSegments(result.segments, { targetTokens: 600, overlapSegments: 1 })
    const vectors = chunks.length > 0 ? await embed(chunks.map((c) => c.content)) : []

    // 2. Atomically swap derived data (brief, no network calls inside the txn).
    await db.transaction(async (tx) => {
      await tx.delete(schema.insights).where(eq(schema.insights.itemId, result.itemId))
      await tx.delete(schema.chunks).where(eq(schema.chunks.itemId, result.itemId))
      await tx.delete(schema.itemEntities).where(eq(schema.itemEntities.itemId, result.itemId))
      await tx.delete(schema.transcripts).where(eq(schema.transcripts.itemId, result.itemId))

      await tx.insert(schema.transcripts).values({
        itemId: result.itemId,
        fullText: result.transcript,
        segments: result.segments,
        contentHtml: result.contentHtml,
      })
      await tx.insert(schema.insights).values({
        itemId: result.itemId,
        summary: insights.summary,
        takeaways: insights.takeaways,
        topics: insights.topics,
        chapters: insights.chapters,
        quotes: insights.quotes,
        entities: insights.entities,
      })
      if (chunks.length > 0) {
        await tx.insert(schema.chunks).values(
          chunks.map((c, i) => ({
            itemId: result.itemId,
            content: c.content,
            startSec: c.startSec,
            endSec: c.endSec,
            embedding: vectors[i],
          })),
        )
      }
    })

    // 3. Canonical entities — best-effort, after the swap (re-populates item_entities).
    try {
      const item = await repo.getById(result.itemId)
      await resolveEntities(result.itemId, insights.entities ?? [], { itemTitle: item?.title })
    } catch (e) {
      console.error(`entity resolution failed for item ${result.itemId}`, e)
    }

    // 4. Ready
    await repo.updateStatus(result.itemId, "ready")
  } catch (e) {
    await repo.updateStatus(result.itemId, "failed", e instanceof Error ? e.message : String(e))
    throw e
  }
```

(Preserve the function signature, deps wiring, and imports. `db.transaction` is supported by the postgres-js drizzle client. Keep the chunk-content field names exactly as they were — copy from the current insert.)

- [ ] **Step 4: Run — expect PASS** (`npm test -- test/pipeline/process-content-article.test.ts` and the existing `test/pipeline/process-content.test.ts`). `npm run typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/process-content.ts test/pipeline/process-content-article.test.ts
git commit -m "fix(pipeline): atomic processContent rebuild (compute then swap in a transaction)"
```

---

## Task 4: Migrations README + neutralize `db:generate`

**Files:** Create `lib/db/migrations/README.md`; Modify `package.json`.

- [ ] **Step 1: Create `lib/db/migrations/README.md`**

```markdown
# Migrations

Migrations here are **hand-authored**, not generated.

- Write the SQL file `NNNN_name.sql`, splitting statements with `--> statement-breakpoint`.
- Register it in `meta/_journal.json` (`idx`, `tag`, `breakpoints: true`).
- Apply with `npm run db:migrate` (runs `lib/db/migrate.ts` against `DATABASE_URL`).

## Do NOT run `drizzle-kit generate`

Snapshot files in `meta/` are intentionally **not** maintained past `0004`. Running
`drizzle-kit generate` would diff against stale snapshots and emit destructive SQL
(re-creating existing tables/columns). The `db:generate:UNSAFE` script exists only as a
deliberate, rarely-needed escape hatch — do not run it without regenerating snapshots first.
```

- [ ] **Step 2: Neutralize the script in `package.json`** — rename `db:generate` to `db:generate:UNSAFE` so it can't be run by muscle memory:

```json
    "db:generate:UNSAFE": "drizzle-kit generate",
```

(Find the existing `"db:generate": "drizzle-kit generate"` line and rename the key. Leave `db:migrate` as-is.)

- [ ] **Step 3: Commit**

```bash
git add lib/db/migrations/README.md package.json
git commit -m "docs(db): document hand-authored migration convention; rename db:generate to :UNSAFE"
```

---

## Task 5: Final verification

- [ ] **Step 1:** `npm run typecheck` (clean); `npm test` (all pass — run ONCE; concurrent vitest runs corrupt the shared test DB); `npm run build` (succeeds); `npm run lint` (no new errors vs the 11 baseline).
- [ ] **Step 2:** confirm via a `tsx` query that `item_entities_entity_idx`, `conversations_item_updated_idx`, and `transcripts_item_unique` all exist on the DB and the old names are gone.

---

## Self-Review (plan author)
- **Spec coverage:** index renames ✅ (T1); transcripts unique + dedupe + atomic rebuild ✅ (T2, T3); snapshot footgun via README + neutralized script ✅ (T4); no API/UI change ✅.
- **Placeholder scan:** none — exact SQL + code per step. The PK-rename fallback (T1 S3) is a concrete contingency, not a placeholder.
- **Type consistency:** `uniqueIndex` import + transcripts callback; `db.transaction(tx => …)` uses `tx` for all swap ops; `processContent` deps (`genInsights`/`embed`/`resolveEntities`) and signature unchanged; journal idx 10/11 follow idx 9.
