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
- [ ] **Task 3 — `itemRepo`** (`lib/db/items.ts` + test)
- [ ] **Task 4 — `process-content` pipeline** (rename from `process-transcript`)
- [ ] **Task 5 — `search.ts` itemId rename** (incl. raw SQL)
- [ ] **Task 6 — Modal client / callback / episodes route / retry**
- [ ] **Task 7 — DTO layer** (`lib/api/dto.ts` + test)
- [ ] **Task 8 — Wire DTO into `GET /api/episodes/[id]`**
- [ ] **Task 9 — Mechanical rename sweep** (typecheck + full suite green)
- [ ] **Task 10 — Final verification** (typecheck + test + lint + build + manual smoke)

### Notes / decisions carried forward
- **Flagged deviations from spec (active):** `podcastName`/`audioUrl` kept as columns (not JSONB); `artworkUrl` name kept (not renamed to `thumbnailUrl`). See plan header.
- **Migration approach:** hand-authored `ALTER ... RENAME` (non-destructive, preserves `content_tsv` FTS + data). Drizzle snapshot left stale on purpose — resolve by running `drizzle-kit generate` interactively the next time a real schema change is needed (not before Phase 4).
- **WARP setup (Phase 3):** no Cloudflare account/payment needed; self-registers + caches in Modal Volume. User-side steps: `modal deploy` the new function + set `MODAL_TRANSCRIBE_YOUTUBE_URL`.
