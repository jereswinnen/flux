# Sync Foundation — Design

**Date:** 2026-06-13
**Status:** Approved design, ready for implementation planning

**Context:** Prep for the iOS app: incremental delta sync so the app can pull only what changed (and learn about deletions) instead of re-fetching everything. Single-user → last-write-wins, no conflict resolution.

## Summary

Add `updatedAt` to `items` and `highlights` (auto-bumped by a DB trigger), a `deletions` tombstone log, and one endpoint `GET /api/sync?since=<iso?>` returning everything changed since a cursor (plus deletions) and a fresh cursor. The client stores the cursor and replays deltas.

## Decisions
- **One endpoint** (`/api/sync`) rather than `?since=` per resource — simplest for the client.
- **`updatedAt` via `BEFORE UPDATE` trigger** — robust across every write path (repos, pipeline, direct).
- **Deletions log** (not soft-delete) — least invasive retrofit; existing hard-delete + cascade stays, tombstones are written alongside.

## Components

### 1. Schema + migration `0013_sync`
- `items`: `updatedAt timestamptz NOT NULL DEFAULT now()`.
- `highlights`: `updatedAt timestamptz NOT NULL DEFAULT now()`.
- A shared trigger function + `BEFORE UPDATE` triggers on both tables:
```sql
ALTER TABLE "items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "highlights" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER items_set_updated_at BEFORE UPDATE ON "items" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER highlights_set_updated_at BEFORE UPDATE ON "highlights" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TABLE "deletions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "deletions_deleted_at_idx" ON "deletions" ("deleted_at");
```
- `schema.ts`: add `updatedAt` to both tables (`timestamp("updated_at",{withTimezone:true}).defaultNow().notNull()`); add a `deletions` pgTable (`id`, `type`, `entityId`, `deletedAt`, index on `deletedAt`). Registered in `_journal.json` (idx 13, after `0012_item_read_state`).

### 2. Repos write tombstones
- `lib/db/items.ts` `remove(id)`: after the delete, `db.insert(deletions).values({ type: "item", entityId: id })`. (Wrap delete+insert in `db.transaction` so a tombstone always accompanies the delete.)
- `lib/db/highlights.ts` `remove(id)`: same with `type: "highlight"`.
- A `makeDeletionRepo`/queries module `lib/db/deletions.ts` is optional; inline inserts in the two repos are fine. Add a `listSince(since)` helper (in `lib/db/deletions.ts`) returning `{ type, entityId, deletedAt }` rows with `deletedAt > since`.

### 3. DTOs
- `ItemDTO` + `HighlightDTO` gain `updatedAt: string` (ISO). `itemToDTO`/`highlightToDTO` map `row.updatedAt.toISOString()`.

### 4. `GET /api/sync` (`app/api/sync/route.ts`)
- Query param `since` (ISO). Missing/invalid → full snapshot (treat as epoch).
- Returns:
```ts
{
  items: ItemDTO[],          // updatedAt > since
  highlights: HighlightDTO[],// updatedAt > since
  deletions: { type: "item" | "highlight", id: string }[], // deletedAt > since
  syncedAt: string           // server now() — the client's next cursor
}
```
- Repo additions: `itemRepo.listUpdatedSince(since)`, `highlightRepo.listUpdatedSince(since)` (mirror existing `list`, add `updatedAt > since` filter, no limit). `deletionsSince(since)` from `lib/db/deletions.ts`.
- `syncedAt` is computed at the start (`new Date()`) and returned, so the next delta is inclusive-safe (use `>` strictly; capturing `now` before the queries avoids missing a write that lands mid-request — acceptable at single-user scale; a tiny overlap just re-sends a row, which is idempotent for the client).

## Client usage (informative)
First launch: `GET /api/sync` (no `since`) → full snapshot, store `syncedAt`. Thereafter: `GET /api/sync?since=<stored>` → apply upserts (items/highlights by id), remove `deletions` (and a deleted item's local child highlights), store the new `syncedAt`. Last-write-wins.

## Error handling
- Invalid/absent `since` → full snapshot (no error).
- The delete+tombstone transaction keeps them atomic.
- Cascade-deleted highlights (from an item delete) get no individual tombstone by design — the item tombstone covers them client-side.

## Testing
- **Integration (test DB):** updating an item bumps `updatedAt` (trigger works); `itemRepo.remove`/`highlightRepo.remove` write a tombstone; `listUpdatedSince`/`deletionsSince` filter correctly; `GET /api/sync?since=` returns only deltas + deletions + a `syncedAt`; full snapshot when `since` omitted.
- Build + lint baseline; full suite green.

## Scope
**In:** `updatedAt` columns + trigger, `deletions` table, repo tombstone writes + `listUpdatedSince`/`deletionsSince`, `updatedAt` on the two DTOs, `GET /api/sync`. **Out:** pagination, soft-delete, conflict resolution, push notifications (separate concerns).
