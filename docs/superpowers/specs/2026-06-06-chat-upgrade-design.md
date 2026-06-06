# Chat Upgrade — Design Spec

**Date:** 2026-06-06
**Status:** Approved for implementation

Make both chats (per-episode and library-wide "Ask") substantially better: multi-turn conversations with saved history (ChatGPT-style for both), full-transcript context for episode chat, query rewriting + hybrid retrieval for the library chat, markdown answers, and stop/regenerate/copy controls. Migrations apply automatically — no manual steps.

Builds on the existing app (RAG chat in `app/api/chat`, `useEpisodeChat`/`ChatPanel`, `lib/db/search`, pgvector).

---

## Decisions locked in

| Area | Decision |
|---|---|
| Conversation model | **Multi-conversation everywhere** — multiple named threads per episode AND in the library, each with a history list/switcher |
| Episode retrieval | Full transcript as a cached stable prefix; RAG fallback when transcript > ~60k tokens |
| Library retrieval | Query rewriting (condense) → hybrid search (vector + full-text, fused by RRF) |
| Transport | Custom messages (server loads thread by `conversationId`), plain-text stream + `x-sources` header — not AI SDK `useChat` |
| Rendering | Markdown (react-markdown + remark-gfm) + a remark plugin that linkifies `[mm:ss]` into seek actions; Sources chips remain |
| Controls | Stop (AbortController), regenerate (re-run last user msg), copy (per message) |
| Migrations | Fully automatic: `railway.json` runs `pnpm db:migrate` before `pnpm start`; applied to the live DB during build too |

---

## 1. Data model (migration)

Two new tables:

```
conversations
  id          uuid pk default gen_random_uuid()
  episode_id  uuid fk → episodes (on delete cascade, NULLABLE; NULL = library-wide)
  title       text not null default 'New chat'   -- auto-set from first user message
  created_at  timestamptz default now() not null
  updated_at  timestamptz default now() not null

messages
  id               uuid pk default gen_random_uuid()
  conversation_id  uuid fk → conversations (on delete cascade) not null
  role             text not null                 -- 'user' | 'assistant'
  content          text not null
  sources          jsonb                          -- ChatSource[] on assistant messages
  created_at       timestamptz default now() not null
```

Indexes: `messages(conversation_id, created_at)`, `conversations(episode_id, updated_at desc)`.

**Hybrid-search column** (hand-written SQL appended to the generated migration):
```sql
ALTER TABLE chunks ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX chunks_content_tsv_idx ON chunks USING gin (content_tsv);
```

## 2. Automatic migrations

- Add `railway.json`:
  ```json
  { "$schema": "https://railway.com/railway.schema.json",
    "deploy": { "startCommand": "pnpm db:migrate && pnpm start" } }
  ```
- Move `tsx` from devDependencies → dependencies so `db:migrate` runs in Railway's runtime. `lib/db/migrate.ts` already reads `DATABASE_URL` from the environment (dotenv `.env.local` load is a no-op when the file is absent, as on Railway).
- During implementation, also run `pnpm db:migrate` against the Railway DB (public URL from `.env.local`) so tables exist before/independent of deploy.

## 3. API

- `POST /api/conversations` `{ episodeId? }` → create, returns `{ id }`.
- `GET /api/conversations?episodeId=<id>` (episode threads) or `?scope=library` (library threads) → `[{ id, title, updatedAt }]` newest-first.
- `GET /api/conversations/:id` → `{ conversation, messages }` (to resume a thread).
- `DELETE /api/conversations/:id`.
- `POST /api/chat` `{ conversationId, content }` →
  1. Load conversation (+ `episode_id`) and prior messages.
  2. Retrieve context (see §4).
  3. `streamText` with `[system, ...history, userMessage]`.
  4. On finish: persist the user message and the assistant message (with sources); bump `conversations.updated_at`; set `title` from the first user message if still default.
  5. Stream plain text; return retrieved sources via `x-sources` header.

The old `{ question, episodeId }` shape is replaced by the conversation-based shape.

## 4. Retrieval

**Episode chat (conversation has `episode_id`):**
- Load the full transcript; build context from segments as `[mm:ss] text` lines, placed as a **stable prefix** (before history) to maximize prompt-cache hits across turns.
- **Cap:** estimate tokens (`chars/4`); if > ~60k, fall back to hybrid chunk retrieval for that episode.
- No query rewriting needed (whole transcript is present).

**Library chat (`episode_id` IS NULL):**
- **Condense** (`lib/ai/condense.ts`): one small model call turning (history + new question) into a standalone search query. Skip when there's no prior history.
- **Hybrid search** (`hybridSearch` in `lib/db/search.ts`): run vector search (cosine) and full-text search (`content_tsv @@ websearch_to_tsquery`) over all chunks, fuse by **Reciprocal Rank Fusion** (`score = Σ 1/(k + rank)`, k=60), return top ~8 with episode title + timestamps. The Library page's semantic search switches to this function too.

Sources returned to the client are the retrieved chunks (`episodeId`, `episodeTitle`, `startSec`). In episode full-transcript mode there is no retrieval, so the `x-sources` header is empty (episode chat already sits beside its transcript, and inline `[mm:ss]` citations remain clickable). Sources chips therefore appear mainly in the library chat.

## 5. Multi-turn transport & state

- Client hook `useConversation(conversationId)`: loads messages, sends a new user message to `/api/chat`, appends the streamed assistant message, captures `x-sources`. Exposes `messages`, `send`, `stop` (AbortController), `regenerate`, `busy`.
- Server is the source of truth (messages persisted in DB); the client mirrors optimistically while streaming.

## 6. UI

- **Ask page (`/ask`)** → two-pane: left = conversation history (`＋ New`, list by `updatedAt`, delete); right = the active thread (full message list, composer at bottom). Mobile: history collapses behind a sheet/menu.
- **Episode chat** → keeps tab (mobile) / side-rail (desktop) placement, with a compact **conversation switcher** (dropdown: `＋ New chat` + recent threads for this episode) above the messages.
- **Messages:** markdown via react-markdown + remark-gfm. A remark plugin rewrites `[m:ss]`/`[h:mm:ss]` text into anchors with a `#t=<seconds>` scheme; a custom `a` renderer turns those into seek actions (episode) and leaves real links alone. Each assistant message: **copy** button; while streaming, a **stop** button; after completion, **regenerate**. Sources rendered as chips under the answer (link to `/episodes/[id]?t=<sec>`).

## 7. New / changed files (sketch)

- DB: `lib/db/schema.ts` (+`conversations`, `messages`, `content_tsv`), new migration, `lib/db/conversations.ts` (repo), `lib/db/search.ts` (+`hybridSearch`).
- AI: `lib/ai/condense.ts`.
- Routes: `app/api/conversations/route.ts`, `app/api/conversations/[id]/route.ts`, rewritten `app/api/chat/route.ts`.
- Chat UI: `useConversation` hook + a thread view (replacing `useEpisodeChat`/`ChatPanel`), `components/conversation-switcher.tsx`, `components/chat-message.tsx` (markdown + controls), timestamp remark plugin (`lib/markdown/timestamps.ts`), reworked `components/ask-library.tsx` (two-pane) and `components/episode-view.tsx` chat wiring.
- Config: `railway.json`; `package.json` (`tsx` → dependencies, add `react-markdown`, `remark-gfm`).

## 8. Build order (one plan, two phases)

1. **Conversational core:** migration + auto-migrate config, conversations repo + CRUD routes, message-based `/api/chat` (on current RAG), `useConversation`, thread UI for Ask (two-pane) and episode (switcher), markdown + stop/regenerate/copy. → working multi-turn chat with history.
2. **Retrieval upgrades:** full-transcript episode mode (+cap+caching), `condense`, `hybridSearch` (+ Library page adoption). → sharper answers.

## 9. Testing

- Vitest: `conversations` repo (DB CRUD + cascade), `hybridSearch` (DB; RRF ordering with a vector-favored and a keyword-favored fixture), `condense` (mocked model), timestamp remark plugin (pure: `[1:15]` → seek anchor for `75`), `/api/conversations` + `/api/chat` route contracts (DB, with mocked model/embeddings where needed).
- UI verified via `pnpm typecheck` + `pnpm build` + manual smoke (new thread, follow-up, switch threads, stop, regenerate, copy, markdown render, timestamp seek, library sources).

## 10. Out of scope

- Sharing/exporting conversations.
- Re-ranking beyond RRF (cross-encoder).
- Streaming token-level markdown re-layout optimizations (render incrementally; good enough).
