# Podcast Knowledge Base — Technical Plan

A personal app that fetches a podcast episode, transcribes it with high accuracy, generates insights, and makes the content queryable through semantic search.

---

## Overview

Submit a podcast episode link → the app downloads and transcribes the audio → generates summaries and insights → embeds the transcript for semantic search. The result is a searchable, queryable personal archive of everything you listen to.

**Volume assumption:** ~1 episode/day, ~1 hour each. Low volume, so cost stays minimal.

---

## Stack

| Layer | Choice | Role |
|---|---|---|
| Hosting | **Railway** | Hosts the Next.js app + managed Postgres |
| Frontend | **Next.js (App Router) + shadcn/ui** | Submit episodes, browse archive, search/chat UI |
| Backend | **Next.js Route Handlers / Server Actions** | Orchestration layer |
| Transcription | **Modal + Whisper** | Serverless GPU transcription |
| AI insights | **Vercel AI SDK + OpenAI** | Summaries, key takeaways, structured insights |
| Embeddings | **OpenAI embeddings** (`text-embedding-3-small`) | Vectorize transcript chunks |
| Database | **Postgres + pgvector** (on Railway) | Store transcripts, insights, embeddings |

---

## Data Flow

```
1. User submits podcast episode URL (Next.js frontend)
2. Backend resolves the audio URL and creates an `episode` record (status: processing)
3. Backend triggers the Modal Whisper function (async) with the audio URL
4. Modal downloads audio → transcribes → returns transcript (+ timestamped segments)
5. Backend:
   a. Stores the full transcript
   b. Calls OpenAI (via Vercel AI SDK) to generate insights/summary
   c. Chunks the transcript + generates embeddings → stores in pgvector
   d. Marks episode status: ready
6. Frontend:
   - Browses archive
   - Semantic search ("what did they say about X")
   - Q&A chat grounded in the transcript (RAG)
```

---

## Component Detail

### Modal (Transcription)

- A single Python function deployed to Modal, exposed as a web endpoint.
- Takes an audio URL, downloads it, runs Whisper, returns transcript + timestamped segments as JSON.
- **Model recommendation:** `faster-whisper` (large-v3) — same accuracy as Whisper large, significantly faster and cheaper to run on GPU. Use `large-v3` for max accuracy since quality is a priority.
- **Runtime for a 1-hour episode:** roughly **2–3 minutes** on GPU.
- Triggered async from the backend; backend should treat it as a job (don't block the request).

**Integration:** plain HTTPS request from the Next.js backend → Modal web endpoint. No SDK lock-in; it behaves like any other API.

> Note: transcription is long-running, so don't call Modal from a serverless edge function with a short timeout. Either (a) call Modal and have it POST back to a webhook when done, or (b) run the orchestration in a Railway-hosted Node process / background job. Webhook callback is the cleaner pattern.

### Backend (Next.js on Railway)

Responsibilities:
- Accept episode submissions, validate, resolve audio URL.
- Trigger Modal; receive the transcript via webhook callback.
- Generate insights via Vercel AI SDK.
- Chunk + embed transcript, write to pgvector.
- Serve search + RAG chat endpoints.

Because Railway runs a long-lived Node server (not serverless functions), long jobs and webhooks are straightforward — no timeout headaches.

### AI Insights (Vercel AI SDK + OpenAI)

- After transcript is ready, send it to OpenAI to produce a structured insights object:
  - Short summary (2–3 sentences)
  - Key takeaways (bulleted)
  - Topics / themes
  - Notable quotes (with approximate timestamps)
  - People / entities mentioned
- Use the Vercel AI SDK's `generateObject` with a schema so the output is structured and reliable to store.
- **Runtime:** a few seconds for a 1-hour transcript.

### Semantic Search + Q&A (RAG)

- Chunk the transcript (e.g. ~500–800 tokens per chunk, with overlap), keep timestamps per chunk.
- Embed each chunk with `text-embedding-3-small` and store the vector in pgvector.
- **Search:** embed the query → cosine similarity against chunks → return top matches (with timestamps so you can jump to the moment).
- **Q&A:** retrieve top chunks → pass as context to OpenAI via the AI SDK → grounded answer with citations back to timestamps.

---

## Suggested Schema (Postgres + pgvector)

```sql
-- episodes
id            uuid pk
title         text
podcast_name  text
audio_url     text
source_url    text
duration_sec  int
status        text          -- processing | ready | failed
created_at    timestamptz

-- transcripts
id            uuid pk
episode_id    uuid fk -> episodes
full_text     text
segments      jsonb         -- [{ start, end, text }]

-- insights
id            uuid pk
episode_id    uuid fk -> episodes
summary       text
takeaways     jsonb
topics        jsonb
quotes        jsonb
entities      jsonb

-- chunks (for semantic search)
id            uuid pk
episode_id    uuid fk -> episodes
content       text
start_sec     int
end_sec       int
embedding     vector(1536)  -- text-embedding-3-small
```

---

## API Surface (rough)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/episodes` | POST | Submit a new episode URL |
| `/api/episodes` | GET | List episodes |
| `/api/episodes/:id` | GET | Episode detail (transcript + insights) |
| `/api/modal/callback` | POST | Webhook: Modal returns the finished transcript |
| `/api/search` | POST | Semantic search across all episodes |
| `/api/chat` | POST | RAG Q&A grounded in a transcript |

---

## Cost Estimate (≈1 episode/day)

| Item | Cost |
|---|---|
| Modal transcription | ~$0.50–$1.00 per 1-hr episode; covered by Modal's **$30/month free credit** (Starter plan, $0 base) |
| OpenAI insights | A few cents per episode |
| OpenAI embeddings | Fractions of a cent per episode (`text-embedding-3-small` is very cheap) |
| Railway | Usage-based; small app + Postgres is low monthly cost |

**Bottom line:** at ~1 episode/day, transcription likely stays entirely within Modal's free credit, and OpenAI usage is negligible. Main fixed cost is Railway hosting.

---

## Build Order (suggested)

1. **Modal function** — deploy `faster-whisper`, test with a sample audio URL.
2. **DB schema** — set up Postgres + pgvector on Railway.
3. **Backend pipeline** — submit → trigger Modal → webhook → store transcript.
4. **Insights** — wire up Vercel AI SDK + OpenAI `generateObject`.
5. **Embeddings + search** — chunk, embed, pgvector similarity search.
6. **RAG chat** — retrieval + grounded answers.
7. **Frontend** — Next.js + shadcn: submit form, archive list, episode detail, search/chat.

---

## Open Questions for the Team

- How is the audio URL resolved from a podcast link? (RSS feed parsing vs. direct file. Spotify/Apple don't expose raw audio easily — RSS is usually the reliable path.)
- Whisper model size: `large-v3` (max accuracy) vs `medium` (faster/cheaper). Recommend `large-v3` given accuracy priority.
- Notion export — keep as a later "nice to have" or skip?
