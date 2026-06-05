# Podcast Knowledge Base — Design Spec

**Date:** 2026-06-05
**Status:** Approved for implementation

A personal app that finds a podcast episode (via iTunes search or a pasted URL), transcribes it with high accuracy, generates structured insights, and makes the content queryable through semantic search and grounded Q&A.

This spec builds on `podcast-knowledge-base-plan.md` and records the concrete decisions made during brainstorming.

---

## Decisions locked in

| Area | Decision |
|---|---|
| Transcription | Modal + `faster-whisper` `large-v3` (GPU), async with webhook callback |
| Database | Railway-managed Postgres + pgvector |
| Build scope | Full vertical slice (all layers), built incrementally |
| Episode discovery | iTunes Search API — both podcast-level and episode-level — plus manual URL paste |
| Deployment | I produce runnable code + `SETUP.md`; user creates accounts and supplies keys |
| Data access | Drizzle ORM + drizzle-kit migrations, pgvector `vector(1536)` column |
| Testing | Vitest — TDD on pure logic, route-level tests against a test DB |
| Status model | Four-state progress: `processing → transcribing → analyzing → ready`, plus `failed` |

---

## 1. Architecture

A single Next.js 16 (App Router) app deployed on Railway, a Railway-managed Postgres+pgvector database, and a standalone Modal Python function for GPU transcription. The Next.js server is long-lived (`next start`), so it owns orchestration and receives Modal's webhook callback without serverless timeout concerns.

```
Browser ──► Next.js (Railway)
                │
                ├─ iTunes Search API (find shows/episodes)   [no key]
                ├─ RSS feeds (resolve audio enclosure URL)
                ├─ Modal endpoint (trigger transcription)  ──► faster-whisper large-v3 (GPU)
                │                                                  │
                │   ◄──── POST /api/modal/callback (webhook) ◄─────┘
                ├─ OpenAI (insights via generateObject, embeddings)
                └─ Postgres + pgvector (episodes, transcripts, insights, chunks)
```

**Note on this Next.js version:** the scaffold's `AGENTS.md` warns this Next.js (16.2.6) has breaking changes vs. older knowledge. Consult `node_modules/next/dist/docs/` before writing route handlers, server actions, or config.

---

## 2. Episode discovery & audio resolution

Three entry paths, all converging on an audio **enclosure URL**:

1. **Search shows** — `GET https://itunes.apple.com/search?term=<q>&media=podcast&entity=podcast`. User picks a show; we read its `feedUrl` (RSS), parse `<channel><item><enclosure url=...>` entries, and list recent episodes to choose from.
2. **Search episodes** — `GET https://itunes.apple.com/search?term=<q>&media=podcast&entity=podcastEpisode`. Returns individual episodes with `episodeUrl` (direct audio), `trackName`, `collectionName`, artwork, release date, `feedUrl`. User picks directly.
3. **Paste URL** — a direct audio file URL (used as-is) or an RSS feed URL (parsed, then episodes listed as in path 1).

Details:
- No API key required. Apple rate-limits ~20 req/min; cache search/lookup responses briefly (in-memory TTL) to stay under it.
- To enumerate a show's episodes from an iTunes result, prefer fetching and parsing its `feedUrl` (RSS) — this is authoritative for the audio enclosure. `https://itunes.apple.com/lookup?id=<collectionId>&entity=podcastEpisode` is an acceptable fallback.
- RSS parsed with `fast-xml-parser`. Extract per item: title, enclosure URL + type, guid, pubDate, duration (`itunes:duration`), description.
- Metadata captured at submission: title, show/podcast name, artwork URL, episode guid, published date, audio URL, and (when available) iTunes collection/track IDs.

This resolves the plan's open question — **RSS enclosure is the reliable audio path**; Spotify/Apple app links are not used directly.

---

## 3. Processing pipeline

1. User picks or pastes an episode → `POST /api/episodes` creates an `episodes` record (`status: processing`) with the captured metadata. Deduplicate on `(audio_url)` or `(episode_guid)` to avoid re-ingesting.
2. Backend fires the Modal web endpoint **async** with `{ audio_url, episode_id, callback_url, secret }` and returns immediately (does not block on transcription).
3. Modal downloads the audio, runs `faster-whisper large-v3`, and `POST`s to `/api/modal/callback` with `{ episode_id, transcript, segments[], error? }`, authenticated by a shared-secret header.
4. The callback handler runs the rest of the pipeline:
   a. Store full transcript + timestamped segments (`status: transcribing` → set on trigger).
   b. `status: analyzing` → generate structured insights via Vercel AI SDK `generateObject`.
   c. Chunk the transcript (~600 tokens, with overlap, timestamps preserved) → `embedMany` with `text-embedding-3-small` → write vectors to `chunks`.
   d. `status: ready`.
5. On any failure (Modal download/transcription error, OpenAI error), set `status: failed` and store `error_message`. A `POST /api/episodes/:id/retry` re-triggers from the appropriate step.

Insights + embeddings for a 1-hour transcript take seconds, so running them inline in the callback handler is acceptable for this volume; no separate job queue is needed.

---

## 4. Data model

Drizzle ORM with drizzle-kit migrations. pgvector enabled (`CREATE EXTENSION vector`). Cosine search via an **HNSW** index on the embedding column.

```
episodes
  id                uuid pk
  title             text
  podcast_name      text
  audio_url         text         -- resolved enclosure URL (unique-ish, used for dedupe)
  source_url        text         -- original link the user provided, if any
  artwork_url       text
  episode_guid      text
  published_at      timestamptz
  duration_sec      int
  itunes_collection_id  bigint
  itunes_track_id       bigint
  status            text         -- processing | transcribing | analyzing | ready | failed
  error_message     text
  created_at        timestamptz default now()

transcripts
  id            uuid pk
  episode_id    uuid fk -> episodes (on delete cascade)
  full_text     text
  segments      jsonb            -- [{ start, end, text }]

insights
  id            uuid pk
  episode_id    uuid fk -> episodes (on delete cascade)
  summary       text
  takeaways     jsonb            -- string[]
  topics        jsonb            -- string[]
  quotes        jsonb            -- [{ text, approx_timestamp_sec }]
  entities      jsonb            -- [{ name, type }]

chunks
  id            uuid pk
  episode_id    uuid fk -> episodes (on delete cascade)
  content       text
  start_sec     int
  end_sec       int
  embedding     vector(1536)     -- text-embedding-3-small
  -- HNSW index on embedding (vector_cosine_ops)
```

---

## 5. API surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/itunes/search` | GET | Search iTunes; `?q=&type=podcast\|episode` |
| `/api/itunes/episodes` | GET | List episodes for a show; `?feedUrl=` or `?collectionId=` (parses RSS) |
| `/api/episodes` | POST | Submit an episode (audio URL + metadata); creates record, triggers Modal |
| `/api/episodes` | GET | List episodes (archive) |
| `/api/episodes/:id` | GET | Episode detail (transcript + insights + status) |
| `/api/episodes/:id/retry` | POST | Re-run a failed episode |
| `/api/modal/callback` | POST | Webhook: Modal returns transcript (shared-secret auth) |
| `/api/search` | POST | Semantic search across all episodes; returns chunks + timestamps |
| `/api/chat` | POST | RAG Q&A grounded in a transcript (streamed) |

---

## 6. UI (Next.js + shadcn/ui)

- `/` — **Add episode** page with three tabs: *Search shows*, *Search episodes*, *Paste URL*. Show search → episode picker. Submitting kicks off processing and routes to the episode detail.
- `/episodes` — archive grid/list with artwork, show, title, status badge (live progress for in-flight episodes).
- `/episodes/[id]` — detail: status/progress, insights panel (summary, takeaways, topics, quotes, entities), transcript with clickable timestamp jumps, and a grounded chat box.
- Global semantic search ("what did they say about X") surfacing matching chunks with episode + timestamp deep-links.

---

## 7. Modal function

- `modal/transcribe.py` — a Modal app exposing a web endpoint. Receives `{ audio_url, episode_id, callback_url, secret }`.
- Uses `Function.spawn` (or equivalent) so the HTTP request returns quickly while transcription runs on GPU in the background; the background task POSTs results to `callback_url`.
- Loads `faster-whisper` `large-v3` on a GPU container; returns transcript text + timestamped segments.
- Deployed separately via `modal deploy`; the resulting web URL goes into `MODAL_TRANSCRIBE_URL`.
- Verifies the shared secret on inbound requests and sends it on the callback.

---

## 8. Configuration

Environment variables (documented in `SETUP.md` with account-creation steps):

- `DATABASE_URL` — Railway Postgres (pgvector enabled)
- `OPENAI_API_KEY` — insights + embeddings
- `MODAL_TRANSCRIBE_URL` — deployed Modal web endpoint
- `MODAL_WEBHOOK_SECRET` — shared secret for trigger + callback auth
- `APP_URL` — public base URL used to build the callback URL

---

## 9. Error handling

- Episode-level failures recorded as `status: failed` + `error_message`; surfaced in the UI with a retry action.
- iTunes/RSS failures (bad feed, no enclosure) reported to the user at submission time, before a record is created.
- Modal callback validates the shared secret; unauthorized requests rejected (401).
- OpenAI failures during insights/embeddings mark the episode failed without losing the stored transcript (retry resumes from analysis).

---

## 10. Testing strategy

Vitest, TDD-first on pure logic:

- iTunes response mapping (search results → normalized episode/show objects).
- RSS parsing (enclosure URL, guid, duration extraction; malformed-feed handling).
- Transcript chunking (token sizing, overlap, timestamp preservation).
- Search query construction and result mapping.

Plus route-level tests for the API handlers against a test database, and a minimal check of the Modal function's request/response contract.

---

## 11. Build order

1. DB schema + Drizzle migrations + pgvector extension/index.
2. iTunes search + RSS resolution (`lib/itunes`, `lib/rss`) with tests.
3. Episode submission + dedupe + Modal trigger client (`lib/modal`).
4. Modal `transcribe.py` + callback handler wiring.
5. Insights (`generateObject`) + chunking + embeddings + storage.
6. Semantic search + RAG chat endpoints.
7. UI: add page (3 tabs), archive, episode detail, search/chat.
8. `SETUP.md` deploy guide.
