# YouTube Transcription — Progress Tracker

Living status across all phases. Updated as work lands. See the spec and per-phase plans for detail.

- **Spec:** [`specs/2026-06-12-youtube-transcription-design.md`](specs/2026-06-12-youtube-transcription-design.md)
- **Branch:** `youtube-transcription`

## Phases

| Phase | Scope | Status |
|------|-------|--------|
| 1 | Polymorphic data model + DTO foundation (`episodes`→`items`, `type`+`sourceMetadata`, `lib/api/` DTOs) | ✅ Done (pending manual smoke test) |
| 2 | `SourceAdapter` abstraction + unified ingest (podcast adapter, YouTube adapter, `POST /api/items`, retry) | ✅ Done |
| 3 | Modal YouTube function (`transcribe_youtube`: wgcf + wireproxy + yt-dlp, health gate, metadata backfill) | 🟡 In progress |
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
- [x] **Task 9 — Mechanical rename sweep** (30 files) · commit `bdc8ff1` · typecheck clean + 90/90 tests · reviews ✅
- [x] **Task 10 — Final verification** · typecheck clean · 90/90 tests · build ✅ · lint: 0 new errors (11 pre-existing on main) · final holistic review: **GO**
  - ⏳ **Pending (user):** manual podcast smoke test — add a podcast via ⌘K, confirm it reaches `ready` and renders.

**Phase 1 + Phase 2 merged to `main` locally** (fast-forward, branches deleted). `main` is ahead of `origin/main` (~32 commits) — not yet pushed.

---

## Phase 3 — Modal `transcribe_youtube` (WARP + yt-dlp)

Plan: [`plans/2026-06-12-youtube-phase-3-modal.md`](plans/2026-06-12-youtube-phase-3-modal.md) · Branch: `youtube-phase-3-modal`

- [ ] Task 1 — pure helpers (`modal/youtube_helpers.py`) + tests (TDD, plain python3)
- [ ] Task 2 — `modal/transcribe_youtube.py` (WARP egress + yt-dlp + large-v3)
- [ ] Task 3 — verify wgcf/wireproxy/yt-dlp release URLs + pins
- [ ] Task 4 — `modal/README.md` deploy + env docs
- [ ] Task 5 — automated verification + **manual deploy handoff (user)**

Reality: the WARP/yt-dlp/Modal integration is only fully verifiable via `modal deploy` (user step). Phase 3 auto-tests the pure helpers + py_compile + contract match; deploy + real-video smoke is the documented manual handoff. Wire contract (must match Phase 2): in `{item_id, video_url, callback_url, secret}`; out `{item_id, secret, metadata{title,channelName,thumbnailUrl,durationSec,publishedAt}, transcript, segments}`.

---

## Phase 2 — SourceAdapter + unified ingest

Plan: [`plans/2026-06-12-youtube-phase-2-adapters.md`](plans/2026-06-12-youtube-phase-2-adapters.md) · Branch: `youtube-phase-2-adapters`

- [x] Task 1 — `SourceAdapter` interface · `44f2376` · reviews ✅
- [x] Task 2 — YouTube URL parsing · `b3785e6` · reviews ✅
- [x] Task 3 — `triggerYoutubeTranscription` Modal client · `0a88659` · reviews ✅
- [x] Task 4 — Podcast + YouTube adapters + registry · `ad43312` (+fix) · reviews ✅
- [x] Task 5 — Unified `POST`/`GET /api/items` · `682edd8` (+fix) · reviews ✅
- [x] Task 6 — Generalized `POST /api/items/[id]/retry` · `72eba7a` · reviews ✅
- [x] Task 7 — Callback metadata backfill (`item_id` + `metadata`) · `69fad82` · reviews ✅
- [x] Task 8 — add-command UI: paste YouTube URL → ingest · `778f271` (+fix) · reviews ✅
- [x] Task 9 — Final verification · typecheck clean · 109/109 tests · build ✅ · lint 0 new

### Phase 2 fast-follows (non-blocking, from review)
- `POST /api/items` returns 201 with a "queued" toast even on dedup (re-submit of an existing URL) — make it signal "already in library".
- `ingest()` / `ingestItem()` in add-command are near-duplicates — collapse into one `postAndNavigate` helper.
- Minor test-coverage adds: `youtu.be?t=` + `music.youtube.com` URL cases; youtube non-2xx trigger error; retry `updateStatus` transition assertions.
- YouTube playback affordance on the detail page is **Phase 4** (ItemView + IFrame player), not a Phase 2 gap.

Boundary note: YouTube ingestion is fully wired on the Vercel side here but only works **end-to-end once Phase 3 deploys the Modal `transcribe_youtube` endpoint**. Until then a YouTube add creates the item then moves to `failed`. Verified in Phase 2 with the Modal call mocked.

---

### Phase 1 fast-follows (non-blocking, from final review)
- Index-name drift: DB still has `conversations_episode_updated_idx` / `episode_entities_entity_idx` (renames are cosmetic; a future `drizzle-kit generate` emits them).
- `messages.sources` JSONB has stale `episodeId`/`episodeTitle` keys in pre-migration **dev** rows only (no prod data) — delete old dev conversations or backfill.
- Stale "episode" wording in a few comments + the `verify.ts` `"Episode:"` prompt label (fold into the Phase 3 content-vocabulary generalization).

### Follow-ups surfaced during review (non-blocking)
- **Test gap:** `sourceUrl` dedup path in `itemRepo.create` has no test — will be exercised + tested by Phase 2 YouTube ingestion.
- **Cleanup:** rename internal opt key `episodeTitle` → `itemTitle` in `PipelineDeps`/`resolve.ts` (vocabulary leak; harmless) — fold into Task 9 sweep.
- **Phase 3 content:** `resolve.ts` `entityChunkText` hardcodes "podcast episode" in embedded chunk text — generalize when YouTube items exist.
- **Perf (pre-existing):** no index on `chunks.item_id`; consider adding when convenient.

### Notes / decisions carried forward
- **Flagged deviations from spec (active):** `podcastName`/`audioUrl` kept as columns (not JSONB); `artworkUrl` name kept (not renamed to `thumbnailUrl`). See plan header.
- **Migration approach:** hand-authored `ALTER ... RENAME` (non-destructive, preserves `content_tsv` FTS + data). Drizzle snapshot left stale on purpose — resolve by running `drizzle-kit generate` interactively the next time a real schema change is needed (not before Phase 4).
- **WARP setup (Phase 3):** no Cloudflare account/payment needed; self-registers + caches in Modal Volume. User-side steps: `modal deploy` the new function + set `MODAL_TRANSCRIBE_YOUTUBE_URL`.
