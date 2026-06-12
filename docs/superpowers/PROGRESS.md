# YouTube Transcription — Progress Tracker

Living status across all phases. Updated as work lands. See the spec and per-phase plans for detail.

- **Spec:** [`specs/2026-06-12-youtube-transcription-design.md`](specs/2026-06-12-youtube-transcription-design.md)
- **Branch:** `youtube-transcription`

## Phases

| Phase | Scope | Status |
|------|-------|--------|
| 1 | Polymorphic data model + DTO foundation (`episodes`→`items`, `type`+`sourceMetadata`, `lib/api/` DTOs) | 🟡 In progress |
| 2 | `SourceAdapter` abstraction + unified ingest (podcast adapter, YouTube adapter, `POST /api/items`, retry) | ⚪ Not started |
| 3 | Modal YouTube function (`transcribe_youtube`: wgcf + wireproxy + yt-dlp, health gate, metadata backfill) | ⚪ Not started |
| 4 | Frontend (`ItemView`, pluggable player, YouTube IFrame, live-reading transcript, bottom-right mini-player) | ⚪ Not started |

Legend: ⚪ not started · 🟡 in progress · ✅ done · ⛔ blocked

---

## Phase 1 — Polymorphic data model + DTO foundation

Plan: [`plans/2026-06-12-youtube-phase-1-data-model.md`](plans/2026-06-12-youtube-phase-1-data-model.md)

Each task passes two reviews (spec compliance → code quality) before it's marked done.

- [x] **Task 1 — Schema rename to `items`** (`lib/db/schema.ts`) · commits `7918725` + refinement · reviews ✅ (dropped redundant `channelName`)
- [x] **Task 2 — Hand-authored rename migration** (`0005_items_rename.sql` + journal) · commit `ead5afe` · applied to DB · reviews ✅
- [x] **Task 3 — `itemRepo`** (`lib/db/items.ts` + test) · commit `32fbc6e` · 4/4 tests · reviews ✅
- [x] **Task 4 — `process-content` pipeline** (rename from `process-transcript`; folded in `resolve.ts`) · commit `92995ec` · 3/3 tests · reviews ✅
- [x] **Task 5 — `search.ts` itemId rename** (incl. raw SQL) · commit `f86a606` · 2/2 tests · reviews ✅
- [x] **Task 6 — Modal client / callback / episodes route / retry** (+ fixed `[id]/route.ts`) · commits `69a187e` + fixes · 6/6 tests · reviews ✅
- [x] **Task 7 — DTO layer** (`lib/api/dto.ts` + test) · commit `b2ba0a4` · 2/2 tests · reviews ✅
- [x] **Task 8 — Wire DTO into `GET /api/episodes/[id]`** · commit `d582b38` · reviews ✅
- [ ] **Task 9 — Mechanical rename sweep** (typecheck + full suite green) ← in progress
- [ ] **Task 10 — Final verification** (typecheck + test + lint + build + manual smoke)

### Follow-ups surfaced during review (non-blocking)
- **Test gap:** `sourceUrl` dedup path in `itemRepo.create` has no test — will be exercised + tested by Phase 2 YouTube ingestion.
- **Cleanup:** rename internal opt key `episodeTitle` → `itemTitle` in `PipelineDeps`/`resolve.ts` (vocabulary leak; harmless) — fold into Task 9 sweep.
- **Phase 3 content:** `resolve.ts` `entityChunkText` hardcodes "podcast episode" in embedded chunk text — generalize when YouTube items exist.
- **Perf (pre-existing):** no index on `chunks.item_id`; consider adding when convenient.

### Notes / decisions carried forward
- **Flagged deviations from spec (active):** `podcastName`/`audioUrl` kept as columns (not JSONB); `artworkUrl` name kept (not renamed to `thumbnailUrl`). See plan header.
- **Migration approach:** hand-authored `ALTER ... RENAME` (non-destructive, preserves `content_tsv` FTS + data). Drizzle snapshot left stale on purpose — resolve by running `drizzle-kit generate` interactively the next time a real schema change is needed (not before Phase 4).
- **WARP setup (Phase 3):** no Cloudflare account/payment needed; self-registers + caches in Modal Volume. User-side steps: `modal deploy` the new function + set `MODAL_TRANSCRIBE_YOUTUBE_URL`.
