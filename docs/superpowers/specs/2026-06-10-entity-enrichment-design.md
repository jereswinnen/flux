# Canonical Entities with Verified Enrichment

**Date:** 2026-06-10
**Status:** Approved

## Goal

Turn the flat `{ name, type }` entity mentions on episodes into a canonical, enriched knowledge base: deduplicated entities with external metadata (Wikipedia, Google Books, iTunes), real entity pages, and a richer "Mentioned" section on the episode detail page.

## Background

Today, entities are extracted by the insights LLM call (`lib/ai/insights.ts`) into a JSONB column on `insights` (`lib/db/schema.ts`), rendered as plain badges (`components/episode-insights.tsx`) linking to `/topics/[slug]`, which lists episodes by exact name match. There is no deduplication, no external metadata, and no per-mention context.

## Data Model

Two new tables (Drizzle migration):

### `entities`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | default random |
| `name` | text not null | canonical display name |
| `slug` | text unique not null | URL slug, derived from name (suffix on collision) |
| `type` | text not null | `person \| company \| book \| product \| place \| other` (same values as extraction enum) |
| `description` | text | one-liner (e.g. Wikipedia description) |
| `summary` | text | longer extract (Wikipedia summary / book blurb) |
| `imageUrl` | text | thumbnail / book cover |
| `wikipediaUrl` | text | |
| `wikidataId` | text | canonical external identity when available |
| `externalIds` | jsonb | `{ itunesId?, isbn?, googleBooksId? }` |
| `metadata` | jsonb | type-specific extras, e.g. `{ author, publishedYear }` for books |
| `enrichmentStatus` | text not null | `pending \| enriched \| unmatched \| failed` |
| `createdAt` / `updatedAt` | timestamp | |

### `episode_entities`

| Column | Type | Notes |
| --- | --- | --- |
| `episodeId` | uuid FK → episodes, cascade delete | composite PK with `entityId` |
| `entityId` | uuid FK → entities, cascade delete | |
| `context` | text | short phrase: how/why it was mentioned in this episode |
| `approxTimestampSec` | integer nullable | jump-to-moment in the player |

`insights.entities` (JSONB) continues to be written as raw extraction output — useful for debugging and reprocessing — but all UI reads come from the new tables.

## Extraction Changes

The `entities` array in `insightsSchema` (`lib/ai/insights.ts`) gains two fields per entity:

- `context: string` — short phrase describing how the entity was mentioned (powers LLM match verification and UI copy)
- `approxTimestampSec: number` — approximate moment of first/main mention (same pattern as quotes)

## Resolution + Enrichment Pipeline

New module `lib/entities/` invoked from `lib/pipeline/process-transcript.ts` after insights are stored. Runs async per episode; failures never block the episode reaching `ready`.

For each extracted entity:

1. **Match existing:** look up by normalized (case/whitespace-insensitive) name + type. If found, skip enrichment and just link.
2. **Candidate search** (new entities only, top ~3 candidates):
   - `person`, `company`, `place`, `other` → Wikipedia REST search + summary endpoints (description, extract, thumbnail, Wikidata ID)
   - `book` → Google Books volumes search (title, author, cover, ISBN, year)
   - `product` → iTunes Search plus Wikipedia
   - All calls go through a TTL-cached fetch layer following the existing `lib/itunes/client.ts` pattern.
3. **LLM verification:** one `gpt-5.4-mini` structured-output call per new entity: given the entity name, type, and transcript `context`, plus the candidates, it picks the correct candidate or rejects all. Rejection → `enrichmentStatus = unmatched`.
4. **Persist:** insert the entity (enriched or unmatched), then insert the `episode_entities` row with `context` and `approxTimestampSec`.

**Backfill:** `scripts/backfill-entities.ts` runs all existing `insights` rows through the same resolver. Existing rows lack `context`/`approxTimestampSec`; backfilled links store null timestamp and the verifier works from name + episode title/summary instead.

## Entity Pages

New route `app/entities/[slug]/page.tsx`. (`/topics/[slug]` remains unchanged for topic strings.)

- **Header:** image, name, type badge, one-line description, external links (Wikipedia / store).
- **Summary:** the longer extract, when available.
- **Mentioned in:** episode list; each row shows that episode's `context` line and, when present, a jump link to `/episodes/[id]?t={approxTimestampSec}`.
- **Often mentioned with:** top co-occurring entities computed from `episode_entities` counts.
- **Books:** additionally show cover, author, published year.
- Unmatched entities still get a page (name, type, episode list) without external metadata.

## Mentioned Section UI

In `components/episode-insights.tsx`:

- Badges link to `/entities/[slug]` (data now comes from the join tables, not `insights.entities`).
- Each badge gets a shadcn `HoverCard`: thumbnail, one-line description, "mentioned in N episodes".
- The **Books** group renders as a horizontal cover-art row (cover, title, author) instead of badges.

## Error Handling

- Enrichment runs per entity; one failure doesn't affect others. Failures set `enrichmentStatus = failed` and are retryable (status-driven, idempotent resolver).
- External API errors or LLM rejection degrade to `unmatched`, never block the pipeline.
- External calls are TTL-cached and rate-limit-aware (reuse the iTunes client pattern).

## Testing

- Unit tests for the resolver: existing-match path, candidate selection per type, verifier accept/reject handling, unmatched fallback — external APIs and LLM mocked.
- Schema/migration verified locally.
- Manual end-to-end check: run the backfill on the existing library, inspect entity pages and the Mentioned section.

## Out of Scope (natural follow-ups)

- RAG-generated entity digests ("what your podcasts said about X")
- Library-wide `/books` reading-list page
- Alias merging / manual entity-merge admin UI
- Co-mention graph visualizations
