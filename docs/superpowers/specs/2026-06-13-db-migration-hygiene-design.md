# DB & Migration Hygiene — Design

**Date:** 2026-06-13
**Status:** Approved design, ready for implementation planning

**Context:** Sub-project #1 of a 4-part hardening sweep (then: API/data-model consolidation & iOS-ready surface → UX quick wins → shared-component DRY pass). This one is backend plumbing only — no API or UI behavior change — and clears the way to add SP2's migrations safely.

## Summary

Fix three integrity/consistency issues surfaced by the architecture audit: (1) index names that drifted from `schema.ts` after the `episodes→items` rename, (2) `transcripts` lacks a `UNIQUE(item_id)` and `processContent` rebuilds derived data non-atomically (a crash leaves an item half-wiped), and (3) migration snapshots are missing for 0005–0009, so a stray `drizzle-kit generate` could emit destructive SQL.

## Decisions

- **Snapshots:** do **not** hand-author the missing snapshot JSONs (error-prone, low value since the project hand-authors migrations and never runs `generate`). Instead, remove the footgun at the source: document the hand-authored convention and neutralize the `db:generate` script so it can't be run accidentally.
- **Transaction scope:** wrap only the destructive delete+insert in a transaction, and compute the slow LLM/embedding work *before* it — never hold a DB transaction open across network calls, and never delete old data until the new data is ready.

## Components

### 1. Index-name reconciliation
The live DB (verified) still has the pre-rename index/PK names while `schema.ts` declares the new ones:
- `item_entities` table → index `episode_entities_entity_idx` (schema declares `item_entities_entity_idx`); PK constraint `episode_entities_episode_id_entity_id_pk`.
- `conversations` table → index `conversations_episode_updated_idx` (schema declares `conversations_item_updated_idx`).

**Migration `0010_index_renames.sql`:**
```sql
ALTER INDEX "episode_entities_entity_idx" RENAME TO "item_entities_entity_idx";--> statement-breakpoint
ALTER INDEX "conversations_episode_updated_idx" RENAME TO "conversations_item_updated_idx";--> statement-breakpoint
ALTER TABLE "item_entities" RENAME CONSTRAINT "episode_entities_episode_id_entity_id_pk" TO "item_entities_item_id_entity_id_pk";
```
(The PK-constraint rename is cosmetic but completes the rename; `schema.ts` doesn't assert the PK name, so it's safe either way. If the constraint name differs at apply time, drop that statement.) No `schema.ts` change — it already declares the target names.

### 2. Transcript integrity + atomic rebuild
**Migration `0011_transcript_unique.sql`** — dedupe any existing duplicates (keep the most recent row per item), then add the unique index:
```sql
DELETE FROM "transcripts" t USING "transcripts" d
  WHERE t.item_id = d.item_id AND t.ctid < d.ctid;--> statement-breakpoint
CREATE UNIQUE INDEX "transcripts_item_unique" ON "transcripts" ("item_id");
```
**`schema.ts`** — add the unique index to the `transcripts` table definition:
```ts
export const transcripts = pgTable(
  "transcripts",
  { /* …existing columns unchanged… */ },
  (t) => [uniqueIndex("transcripts_item_unique").on(t.itemId)],
)
```
(`uniqueIndex` imported from `drizzle-orm/pg-core`.)

**`lib/pipeline/process-content.ts`** — restructure so the slow work happens *before* any destructive write, and the delete+insert is one transaction:
1. `status → analyzing`.
2. `const insights = await genInsights(...)` (LLM).
3. `const chunks = chunkSegments(...)`; `const vectors = chunks.length ? await embed(...) : []` (embed).
4. `await db.transaction(async (tx) => { … })`:
   - `tx.delete` insights / chunks / itemEntities / transcripts for `itemId` (idempotency).
   - `tx.insert` transcript (with `contentHtml`), insights, chunks (with vectors).
5. Entity resolution (`resolveEntities`) stays **after** the transaction, best-effort with its own try/catch (it re-populates `itemEntities`), unchanged.
6. `status → ready`.
7. On any throw → `status → failed` with the message (existing catch).

This removes the half-empty window (old data isn't deleted until new data is computed) and keeps the transaction brief (no network calls inside it). The dep-injection interface (`generateInsights`/`embedTexts`/`resolveEntities`) is unchanged, so existing pipeline tests keep working.

### 3. Migration-snapshot footgun
- Add `lib/db/migrations/README.md` documenting the convention: migrations are **hand-authored** + registered in `meta/_journal.json`; **do not run `drizzle-kit generate`** (it diffs against snapshots that are intentionally not maintained and would emit destructive SQL against the live schema). Document the `--> statement-breakpoint` splitting and the `npm run db:migrate` apply step.
- Neutralize the accidental path: rename the `db:generate` package script to `db:generate:UNSAFE` (or remove it) so it can't be run by muscle memory; note in the README why.

## Data flow / behavior

No external behavior change. Internally: re-processing an item (Modal callback, retry) now computes insights+embeddings first, then atomically swaps the derived data; a mid-pipeline crash leaves the *previous* good data intact and the item marked `failed` rather than half-empty.

## Error handling

- Migrations are idempotent-safe to apply once; the dedupe runs before the unique index so it can't fail on existing duplicates.
- `processContent` transaction: any failure rolls back the swap; the catch sets `failed`. The pre-transaction LLM/embed failures also hit the catch (status `failed`), same as today.

## Testing

- **Existing pipeline tests** (`test/pipeline/process-content*.test.ts`) must still pass after the restructure (transcript+contentHtml persisted, status `ready`, idempotent re-run). Add one case: a second `processContent` for the same item replaces (not duplicates) the transcript row — asserts the `UNIQUE` + transaction path.
- **Migrations:** apply via `npm run db:migrate` against the app DB; verify (query `pg_indexes`) the indexes are renamed and `transcripts_item_unique` exists.
- **Full suite + build + lint** at the 11-error baseline.

## Scope

**In:** `0010_index_renames` + `0011_transcript_unique` migrations (+ journal entries), `schema.ts` transcripts unique index, `processContent` transaction restructure, migrations README + neutralized `db:generate` script, one new pipeline test.

**Out:** hand-authoring snapshot JSONs; the `podcastName → source_name` rename (deferred — SP2 exposes `source` via the DTO without a column rename); any API/UI change.
