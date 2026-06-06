# Chat Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade both chats to saved multi-turn conversations (ChatGPT-style), full-transcript episode context, query-rewriting + hybrid retrieval for the library, markdown answers, and stop/regenerate/copy — with migrations that apply automatically.

**Architecture:** New `conversations`/`messages` tables back persisted threads. `/api/chat` becomes conversation-based (server loads history by `conversationId`, streams the answer, persists messages). Episode chat uses the full transcript (cached prefix, RAG fallback); library chat condenses the question then runs hybrid (vector+full-text, RRF) retrieval. UI renders markdown with clickable timestamps and per-message controls. Built in two phases: conversational core, then retrieval upgrades.

**Tech Stack:** Next.js 16, Drizzle + Postgres/pgvector, Vercel AI SDK v6 (`streamText`/`generateText`), react-markdown + remark-gfm, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-06-chat-upgrade-design.md`

### Conventions
- pnpm. Tests `pnpm test` (Vitest, sequential, against the Railway DB in `.env.local`). UI gates: `pnpm typecheck` + `pnpm build`. Never commit `.env.local`.
- Next 16: route handlers Web `Request`/`Response`; dynamic params async (`await params`); client components need `"use client"`.
- AI SDK v6: `streamText({ model, system, messages, onFinish })`, `result.toTextStreamResponse({ headers })`; `generateText({ model, prompt })`. Mocks: `MockLanguageModelV3`/`MockEmbeddingModelV3` from `ai/test` (V3 shapes: `finishReason: { unified, raw }`, nested `usage`, `warnings: []`).
- Existing: `@/lib/db` (`db`, `schema`), `@/lib/ai/embeddings` (`embedQuery`), `@/lib/db/search` (`searchChunks`, `SearchHit`), `@/lib/format` (`formatTimestamp`, `parseTimestamp`).

---

# PHASE 1 — Conversational core

## Task 1: Migration tables + auto-migrate config

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `package.json` (move `tsx` to deps; add markdown deps)
- Create: `railway.json`
- Migration: generated SQL + hand-appended tsvector

- [ ] **Step 1: Add tables to `lib/db/schema.ts`** (append; keep existing exports)

```ts
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("conversations_episode_updated_idx").on(t.episodeId, t.updatedAt)],
)

export type MessageRole = "user" | "assistant"
export type ChatSource = { episodeId: string; episodeTitle: string; startSec: number }

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").$type<MessageRole>().notNull(),
    content: text("content").notNull(),
    sources: jsonb("sources").$type<ChatSource[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("messages_conversation_created_idx").on(t.conversationId, t.createdAt)],
)
```
(`content_tsv` is intentionally NOT modeled in Drizzle — it's a generated column added via raw SQL in Step 3 and queried with raw SQL later.)

- [ ] **Step 2: Generate the migration**

Run with the Railway URL in scope:
`DATABASE_URL="$(grep '^DATABASE_URL' .env.local | cut -d= -f2- | tr -d '\"')" pnpm db:generate`
Expected: a new file in `lib/db/migrations/` creating `conversations` + `messages`.

- [ ] **Step 3: Append the hybrid-search column to that migration file**

Add to the END of the newest `lib/db/migrations/*.sql`:
```sql
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;
--> statement-breakpoint
CREATE INDEX "chunks_content_tsv_idx" ON "chunks" USING gin ("content_tsv");
```

- [ ] **Step 4: Move `tsx` to dependencies and add markdown deps**

Run: `pnpm add tsx react-markdown remark-gfm unist-util-visit` then `pnpm remove -D tsx` (if still listed under devDependencies).
Confirm `tsx`, `react-markdown`, `remark-gfm`, `unist-util-visit` are under `"dependencies"` in package.json.

- [ ] **Step 5: Create `railway.json`**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "deploy": { "startCommand": "pnpm db:migrate && pnpm start" }
}
```

- [ ] **Step 6: Apply the migration to the Railway DB**

Run: `pnpm db:migrate`
Expected: "migrations applied". Then verify:
```
node --input-type=module -e "import {config} from 'dotenv';config({path:'.env.local'});import postgres from 'postgres';const sql=postgres(process.env.DATABASE_URL,{max:1});const t=await sql\`select table_name from information_schema.tables where table_name in ('conversations','messages')\`;console.log(t.map(r=>r.table_name));const c=await sql\`select column_name from information_schema.columns where table_name='chunks' and column_name='content_tsv'\`;console.log('content_tsv:',c.length);await sql.end()"
```
Expected: `['conversations','messages']` and `content_tsv: 1`.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck` (expect clean).
```bash
git add lib/db/schema.ts lib/db/migrations package.json pnpm-lock.yaml railway.json
git commit -m "feat: conversations/messages tables, hybrid tsvector column, auto-migrate on deploy"
```

---

## Task 2: Conversations repository

**Files:**
- Create: `lib/db/conversations.ts`
- Test: `test/db/conversations.test.ts`

- [ ] **Step 1: Write failing test `test/db/conversations.test.ts`**

```ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeConversationRepo } from "@/lib/db/conversations"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const repo = makeConversationRepo(db)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
beforeEach(async () => {
  await db.delete(schema.conversations)
})
afterAll(async () => {
  await client.end()
})

test("create + list a library conversation", async () => {
  const c = await repo.create({ episodeId: null })
  expect(c.title).toBe("New chat")
  const list = await repo.list(null)
  expect(list.map((x) => x.id)).toContain(c.id)
})

test("addMessage, get returns ordered messages, title set from first user msg", async () => {
  const c = await repo.create({ episodeId: null })
  await repo.addMessage({ conversationId: c.id, role: "user", content: "What is RRF?" })
  await repo.setTitleFromFirstMessage(c.id, "What is RRF?")
  await repo.addMessage({
    conversationId: c.id,
    role: "assistant",
    content: "Reciprocal rank fusion.",
    sources: [{ episodeId: "e1", episodeTitle: "E", startSec: 10 }],
  })
  const got = await repo.get(c.id)
  expect(got?.conversation.title).toBe("What is RRF?")
  expect(got?.messages.map((m) => m.role)).toEqual(["user", "assistant"])
  expect(got?.messages[1].sources?.[0].startSec).toBe(10)
})

test("remove cascades to messages", async () => {
  const c = await repo.create({ episodeId: null })
  await repo.addMessage({ conversationId: c.id, role: "user", content: "hi" })
  await repo.remove(c.id)
  expect(await repo.get(c.id)).toBeNull()
})
```
Run: `pnpm test test/db/conversations.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement `lib/db/conversations.ts`**

```ts
import { and, asc, desc, eq, isNull } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { conversations, messages, type ChatSource, type MessageRole } from "./schema"
import * as schema from "./schema"
import { db as appDb } from "./index"

type DB = PostgresJsDatabase<typeof schema>

export function makeConversationRepo(db: DB) {
  return {
    async create(input: { episodeId?: string | null }) {
      const [row] = await db
        .insert(conversations)
        .values({ episodeId: input.episodeId ?? null })
        .returning()
      return row
    },

    async list(episodeId: string | null) {
      return db
        .select()
        .from(conversations)
        .where(episodeId === null ? isNull(conversations.episodeId) : eq(conversations.episodeId, episodeId))
        .orderBy(desc(conversations.updatedAt))
    },

    async get(id: string) {
      const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1)
      if (!conversation) return null
      const msgs = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, id))
        .orderBy(asc(messages.createdAt))
      return { conversation, messages: msgs }
    },

    async addMessage(input: {
      conversationId: string
      role: MessageRole
      content: string
      sources?: ChatSource[]
    }) {
      const [row] = await db
        .insert(messages)
        .values({
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          sources: input.sources ?? null,
        })
        .returning()
      return row
    },

    async touch(id: string) {
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, id))
    },

    async setTitleFromFirstMessage(id: string, content: string) {
      const title = content.trim().slice(0, 60) || "New chat"
      await db
        .update(conversations)
        .set({ title })
        .where(and(eq(conversations.id, id), eq(conversations.title, "New chat")))
    },

    async remove(id: string) {
      await db.delete(conversations).where(eq(conversations.id, id))
    },
  }
}

export const conversationRepo = makeConversationRepo(appDb)
```
Run the test → PASS (all 3).

- [ ] **Step 3: Commit**
```bash
git add lib/db/conversations.ts test/db/conversations.test.ts
git commit -m "feat: conversations repository"
```

---

## Task 3: Conversation CRUD routes

**Files:**
- Create: `app/api/conversations/route.ts`
- Create: `app/api/conversations/[id]/route.ts`
- Test: `test/api/conversations.test.ts`

- [ ] **Step 1: Write failing test `test/api/conversations.test.ts`**

```ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { afterAll, beforeEach, expect, test } from "vitest"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "@/lib/db/schema"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
beforeEach(async () => { await db.delete(schema.conversations) })
afterAll(async () => { await client.end() })

test("POST creates and GET lists library conversations", async () => {
  const create = await import("@/app/api/conversations/route")
  const res = await create.POST(
    new Request("http://x/api/conversations", { method: "POST", body: JSON.stringify({}) }),
  )
  expect(res.status).toBe(201)
  const { id } = (await res.json()).conversation
  const listRes = await create.GET(new Request("http://x/api/conversations?scope=library"))
  const body = await listRes.json()
  expect(body.conversations.map((c: { id: string }) => c.id)).toContain(id)
})

test("GET :id returns messages; DELETE removes", async () => {
  const create = await import("@/app/api/conversations/route")
  const detail = await import("@/app/api/conversations/[id]/route")
  const made = await (await create.POST(new Request("http://x", { method: "POST", body: "{}" }))).json()
  const id = made.conversation.id
  const getRes = await detail.GET(new Request("http://x"), { params: Promise.resolve({ id }) })
  expect((await getRes.json()).messages).toEqual([])
  const delRes = await detail.DELETE(new Request("http://x"), { params: Promise.resolve({ id }) })
  expect(delRes.status).toBe(200)
})
```
Run → FAIL.

- [ ] **Step 2: Implement `app/api/conversations/route.ts`**

```ts
import { conversationRepo } from "@/lib/db/conversations"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const conversation = await conversationRepo.create({ episodeId: body?.episodeId ?? null })
  return Response.json({ conversation }, { status: 201 })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const episodeId = searchParams.get("episodeId")
  const scope = searchParams.get("scope")
  if (!episodeId && scope !== "library") {
    return Response.json({ error: "specify episodeId or scope=library" }, { status: 400 })
  }
  const conversations = await conversationRepo.list(episodeId ?? null)
  return Response.json({ conversations })
}
```

- [ ] **Step 3: Implement `app/api/conversations/[id]/route.ts`**

```ts
import { conversationRepo } from "@/lib/db/conversations"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await conversationRepo.get(id)
  if (!data) return Response.json({ error: "not found" }, { status: 404 })
  return Response.json(data)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await conversationRepo.remove(id)
  return Response.json({ status: "deleted" })
}
```
Run the test → PASS.

- [ ] **Step 4: Commit**
```bash
git add app/api/conversations test/api/conversations.test.ts
git commit -m "feat: conversation CRUD routes"
```

---

## Task 4: Conversation-based `/api/chat` (phase-1 retrieval)

**Files:**
- Modify: `app/api/chat/route.ts`
- Test: `test/api/chat.test.ts` (replace old)

- [ ] **Step 1: Replace `test/api/chat.test.ts`**

```ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { afterAll, beforeEach, expect, test, vi } from "vitest"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "@/lib/db/schema"
import { makeConversationRepo } from "@/lib/db/conversations"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const repo = makeConversationRepo(db)
beforeEach(async () => { await db.delete(schema.conversations) })
afterAll(async () => { await client.end() })

test("400 without conversationId or content", async () => {
  const { POST } = await import("@/app/api/chat/route")
  const res = await POST(new Request("http://x/api/chat", { method: "POST", body: JSON.stringify({}) }))
  expect(res.status).toBe(400)
})

test("404 for unknown conversation", async () => {
  const { POST } = await import("@/app/api/chat/route")
  const res = await POST(
    new Request("http://x/api/chat", {
      method: "POST",
      body: JSON.stringify({ conversationId: "00000000-0000-0000-0000-000000000000", content: "hi" }),
    }),
  )
  expect(res.status).toBe(404)
})

test.skipIf(!process.env.OPENAI_API_KEY)("persists user + assistant messages", async () => {
  const c = await repo.create({ episodeId: null })
  const { POST } = await import("@/app/api/chat/route")
  const res = await POST(
    new Request("http://x/api/chat", {
      method: "POST",
      body: JSON.stringify({ conversationId: c.id, content: "Say hello." }),
    }),
  )
  expect(res.status).toBe(200)
  await res.text() // drain stream so onFinish runs
  const got = await repo.get(c.id)
  expect(got?.messages[0]).toMatchObject({ role: "user", content: "Say hello." })
  expect(got?.messages.at(-1)?.role).toBe("assistant")
})
```
Run → FAIL (route still old shape).

- [ ] **Step 2: Rewrite `app/api/chat/route.ts`** (phase 1: reuse `searchChunks`; phase 2 swaps retrieval)

```ts
import { openai } from "@ai-sdk/openai"
import { streamText, type ModelMessage } from "ai"
import { embedQuery } from "@/lib/ai/embeddings"
import { db } from "@/lib/db"
import { conversationRepo } from "@/lib/db/conversations"
import { searchChunks } from "@/lib/db/search"
import { formatTimestamp } from "@/lib/format"
import type { ChatSource } from "@/lib/db/schema"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.conversationId || !body?.content) {
    return Response.json({ error: "conversationId and content are required" }, { status: 400 })
  }

  const data = await conversationRepo.get(body.conversationId)
  if (!data) return Response.json({ error: "conversation not found" }, { status: 404 })

  const episodeId = data.conversation.episodeId
  const content: string = body.content

  // Persist the user turn + set title immediately (survives stream abort).
  await conversationRepo.addMessage({ conversationId: body.conversationId, role: "user", content })
  await conversationRepo.setTitleFromFirstMessage(body.conversationId, content)

  // Phase-1 retrieval: chunk RAG scoped by the conversation's episode (if any).
  const hits = await searchChunks(db, await embedQuery(content), {
    limit: 8,
    episodeId: episodeId ?? undefined,
  })
  const libraryWide = !episodeId
  const context = hits
    .map((h) =>
      libraryWide
        ? `[${h.episodeTitle} — ${formatTimestamp(h.startSec)}] ${h.content}`
        : `[${formatTimestamp(h.startSec)}] ${h.content}`,
    )
    .join("\n\n")
  const sources: ChatSource[] = hits.map((h) => ({
    episodeId: h.episodeId,
    episodeTitle: h.episodeTitle,
    startSec: h.startSec,
  }))

  const history: ModelMessage[] = data.messages.map((m) => ({ role: m.role, content: m.content }))
  const messages: ModelMessage[] = [...history, { role: "user", content }]

  const result = streamText({
    model: openai("gpt-5.4-mini-2026-03-17"),
    system:
      "You are answering questions about podcast transcripts using ONLY the provided excerpts. " +
      (libraryWide
        ? "Cite the episode title and [timestamp] you rely on. "
        : "Cite the [timestamp] you rely on. ") +
      "Use markdown. If the answer isn't in the excerpts, say so.\n\nExcerpts:\n" +
      context,
    messages,
    onFinish: async ({ text }) => {
      await conversationRepo.addMessage({
        conversationId: body.conversationId,
        role: "assistant",
        content: text,
        sources,
      })
      await conversationRepo.touch(body.conversationId)
    },
  })

  return result.toTextStreamResponse({
    headers: { "x-sources": encodeURIComponent(JSON.stringify(sources)) },
  })
}
```
Run the test → 400 + 404 pass; persist test passes if `OPENAI_API_KEY` set (else skipped). If `ModelMessage` isn't exported by the installed `ai`, use `import type { CoreMessage as ModelMessage } from "ai"` or inline the type `{ role: "user" | "assistant"; content: string }[]`.

- [ ] **Step 3: Commit**
```bash
git add app/api/chat/route.ts test/api/chat.test.ts
git commit -m "feat: conversation-based chat route with persistence"
```

---

## Task 5: Timestamp markdown plugin

**Files:**
- Create: `lib/markdown/timestamps.ts`
- Test: `test/markdown/timestamps.test.ts`

- [ ] **Step 1: Write failing test `test/markdown/timestamps.test.ts`**

```ts
import { expect, test } from "vitest"
import { splitTimestamps } from "@/lib/markdown/timestamps"

test("splits [m:ss] into a seek link node with seconds", () => {
  const parts = splitTimestamps("See [1:15] and [1:02:03] here")
  // text, link(75), text, link(3723), text
  expect(parts).toHaveLength(5)
  expect(parts[0]).toEqual({ type: "text", value: "See " })
  expect(parts[1]).toMatchObject({ type: "link", url: "#t=75" })
  expect(parts[3]).toMatchObject({ type: "link", url: "#t=3723" })
})

test("returns null when there is no timestamp", () => {
  expect(splitTimestamps("no timestamps here")).toBeNull()
})
```
Run → FAIL.

- [ ] **Step 2: Implement `lib/markdown/timestamps.ts`**

```ts
import { visit } from "unist-util-visit"
import { parseTimestamp } from "@/lib/format"

const RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] }

// Pure: split a text string into mdast nodes, linkifying [m:ss]; null if no match.
export function splitTimestamps(value: string): MdNode[] | null {
  if (!RE.test(value)) return null
  RE.lastIndex = 0
  const out: MdNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = RE.exec(value)) !== null) {
    if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) })
    const ts = m[1]
    out.push({
      type: "link",
      url: `#t=${parseTimestamp(ts)}`,
      children: [{ type: "text", value: `[${ts}]` }],
    })
    last = m.index + m[0].length
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) })
  return out
}

// Remark plugin using the pure splitter above.
export function remarkTimestamps() {
  return (tree: MdNode) => {
    visit(tree as never, "text", (node: MdNode, index: number | null, parent: MdNode | null) => {
      if (!parent || index == null || !node.value) return
      const replacement = splitTimestamps(node.value)
      if (!replacement) return
      parent.children!.splice(index, 1, ...replacement)
      return index + replacement.length
    })
  }
}
```
Run the test → PASS.

- [ ] **Step 3: Commit**
```bash
git add lib/markdown/timestamps.ts test/markdown/timestamps.test.ts
git commit -m "feat: markdown timestamp linkifier"
```

---

## Task 6: Chat message component (markdown + controls)

**Files:**
- Create: `components/chat-message.tsx`

- [ ] **Step 1: Create `components/chat-message.tsx`**

```tsx
"use client"

import Link from "next/link"
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Copy } from "lucide-react"
import { remarkTimestamps } from "@/lib/markdown/timestamps"
import { parseTimestamp } from "@/lib/format"

export type UIMessage = {
  role: "user" | "assistant"
  content: string
  sources?: { episodeId: string; episodeTitle: string; startSec: number }[] | null
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label="Copy"
      className="text-muted-foreground hover:text-foreground"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

export function ChatMessage({
  message,
  onSeek,
}: {
  message: UIMessage
  onSeek?: (sec: number) => void
}) {
  const isUser = message.role === "user"
  return (
    <div className={isUser ? "flex justify-end" : "space-y-2"}>
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm"
            : "prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed"
        }
      >
        {isUser ? (
          message.content
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkTimestamps]}
            components={{
              a({ href, children }) {
                if (href?.startsWith("#t=")) {
                  const sec = parseTimestamp(String(children).replace(/[[\]]/g, ""))
                  return (
                    <button
                      type="button"
                      onClick={() => onSeek?.(Number(href.slice(3)) || sec)}
                      className="text-primary hover:underline"
                    >
                      {children}
                    </button>
                  )
                }
                return (
                  <a href={href} className="text-primary hover:underline">
                    {children}
                  </a>
                )
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>

      {!isUser && message.content && (
        <div className="flex items-center gap-3">
          <CopyButton text={message.content} />
          {message.sources && message.sources.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {message.sources.map((s, i) => (
                <Link
                  key={i}
                  href={`/episodes/${s.episodeId}?t=${s.startSec}`}
                  title={s.episodeTitle}
                  className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {s.episodeTitle.length > 24 ? `${s.episodeTitle.slice(0, 24)}…` : s.episodeTitle}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` (expect clean; react-markdown ships its own types).
```bash
git add components/chat-message.tsx
git commit -m "feat: markdown chat message with copy + source chips + seek links"
```

---

## Task 7: `useConversation` hook + Conversation view + switcher (episode chat)

**Files:**
- Create: `components/use-conversation.ts`
- Create: `components/conversation-view.tsx`
- Create: `components/conversation-switcher.tsx`
- Modify: `components/episode-view.tsx` (replace chat panel usage)

> `components/episode-chat.tsx` is NOT deleted here — `ask-library.tsx` still imports it until Task 8, so deleting now would break the build. It's removed in Task 8 after `ask-library` stops using it.

- [ ] **Step 1: Create `components/use-conversation.ts`**

```ts
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { UIMessage } from "@/components/chat-message"

export function useConversation(conversationId: string | null) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Load existing messages whenever the active conversation changes.
  useEffect(() => {
    if (!conversationId) {
      setMessages([])
      return
    }
    let active = true
    fetch(`/api/conversations/${conversationId}`)
      .then((r) => r.json())
      .then((d) => {
        if (active) setMessages(d.messages ?? [])
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [conversationId])

  const send = useCallback(
    async (content: string) => {
      if (!conversationId) return
      setBusy(true)
      setMessages((prev) => [...prev, { role: "user", content }, { role: "assistant", content: "" }])
      const ac = new AbortController()
      abortRef.current = ac
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, content }),
          signal: ac.signal,
        })
        if (!res.ok) throw new Error("Chat failed")
        let sources: UIMessage["sources"] = null
        const header = res.headers.get("x-sources")
        if (header) {
          try {
            sources = JSON.parse(decodeURIComponent(header))
          } catch {
            /* ignore */
          }
        }
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value)
            setMessages((prev) => {
              const next = [...prev]
              const lastMsg = next[next.length - 1]
              next[next.length - 1] = { ...lastMsg, content: lastMsg.content + chunk, sources }
              return next
            })
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") toast.error("Chat failed")
      } finally {
        setBusy(false)
        abortRef.current = null
      }
    },
    [conversationId],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const regenerate = useCallback(() => {
    // Re-send the last user message; drop the trailing assistant placeholder/answer.
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUser) return
    setMessages((prev) => {
      const idx = prev.map((m) => m.role).lastIndexOf("user")
      return prev.slice(0, idx + 1)
    })
    void send(lastUser.content)
  }, [messages, send])

  return { messages, busy, send, stop, regenerate }
}
```
Note on regenerate: it re-sends the last user content (the server appends another turn). Good enough for a personal app.

- [ ] **Step 2: Create `components/conversation-view.tsx`** (presentational — takes a shared `useConversation` result, so it can be rendered in two places without duplicating chat state)

```tsx
"use client"

import { useState } from "react"
import { Loader2, RefreshCw, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChatMessage } from "@/components/chat-message"
import type { useConversation } from "@/components/use-conversation"

export function ConversationView({
  chat,
  onSeek,
  emptyHint = "Ask a question to get started.",
  disabled = false,
}: {
  chat: ReturnType<typeof useConversation>
  onSeek?: (sec: number) => void
  emptyHint?: string
  disabled?: boolean
}) {
  const { messages, busy, send, stop, regenerate } = chat
  const [draft, setDraft] = useState("")

  function submit() {
    const q = draft.trim()
    if (!q || busy || disabled) return
    setDraft("")
    void send(q)
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex-1 space-y-4 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          messages.map((m, i) => <ChatMessage key={i} message={m} onSeek={onSeek} />)
        )}
      </div>

      <div className="space-y-2">
        {messages.some((m) => m.role === "assistant") && (
          <div className="flex gap-3">
            {busy ? (
              <button type="button" onClick={stop} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Square className="size-3" /> Stop
              </button>
            ) : (
              <button type="button" onClick={regenerate} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <RefreshCw className="size-3" /> Regenerate
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What did they say about…?"
            disabled={disabled}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <Button onClick={submit} disabled={busy || !draft.trim() || disabled}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Ask"}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `components/conversation-switcher.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Convo = { id: string; title: string }

export function ConversationSwitcher({
  episodeId,
  activeId,
  onSelect,
}: {
  episodeId: string
  activeId: string | null
  onSelect: (id: string) => void
}) {
  const [convos, setConvos] = useState<Convo[]>([])

  async function refresh() {
    const d = await fetch(`/api/conversations?episodeId=${episodeId}`).then((r) => r.json())
    setConvos(d.conversations ?? [])
    return (d.conversations ?? []) as Convo[]
  }

  useEffect(() => {
    refresh().then((list) => {
      if (!activeId && list[0]) onSelect(list[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId])

  async function newChat() {
    const d = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ episodeId }),
    }).then((r) => r.json())
    await refresh()
    onSelect(d.conversation.id)
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={activeId ?? undefined} onValueChange={onSelect}>
        <SelectTrigger className="h-8 flex-1 text-xs">
          <SelectValue placeholder="No conversations yet" />
        </SelectTrigger>
        <SelectContent>
          {convos.map((c) => (
            <SelectItem key={c.id} value={c.id} className="text-xs">
              {c.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="icon" variant="outline" className="size-8 shrink-0" onClick={newChat} aria-label="New chat">
        <Plus className="size-4" />
      </Button>
    </div>
  )
}
```
Add the shadcn `select` component first: `pnpm dlx shadcn@latest add select`.

- [ ] **Step 4: Wire episode chat in `components/episode-view.tsx`**

Replace the `useEpisodeChat`/`ChatPanel` usage. At the top of the component add ONE shared conversation hook + active-thread state:
```tsx
const [activeConvo, setActiveConvo] = useState<string | null>(null)
const chat = useConversation(activeConvo)
```
(Import `useState` from react; import `useConversation`, `ConversationSwitcher`, `ConversationView`; remove the `ChatPanel, useEpisodeChat` import and the `const chat = useEpisodeChat(...)` line. The single `chat` instance is shared by both the mobile tab and desktop rail, so there's only one conversation state.)

Replace the chat tab content and the side-rail chat with this shared block (used in both the mobile `value="chat"` TabsContent and the desktop `<aside>` — both reference the same `chat` and `activeConvo`):
```tsx
<div className="flex h-full flex-col gap-3">
  <ConversationSwitcher episodeId={episode.id} activeId={activeConvo} onSelect={setActiveConvo} />
  <ConversationView chat={chat} onSeek={seek} disabled={!activeConvo} emptyHint="Ask about this episode." />
</div>
```
For the desktop rail, wrap it in the existing `<Card className="... lg:sticky lg:top-6">` and give the card/inner a sensible max height (e.g. `max-h-[70vh]`) so the message list scrolls.

- [ ] **Step 5: Typecheck + build + commit**

Run: `pnpm typecheck && pnpm build` (expect clean/success). `episode-view` must no longer import `episode-chat`; `ask-library` still does (removed in Task 8), so the build stays green.
```bash
git add -A
git commit -m "feat: multi-turn conversation hook, view, and episode chat switcher"
```

---

## Task 8: Ask page — two-pane history

**Files:**
- Modify: `components/ask-library.tsx`
- Delete: `components/episode-chat.tsx` (now unused)

- [ ] **Step 1: Rewrite `components/ask-library.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConversationView } from "@/components/conversation-view"
import { useConversation } from "@/components/use-conversation"

type Convo = { id: string; title: string }

export function AskLibrary() {
  const [convos, setConvos] = useState<Convo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const chat = useConversation(activeId)

  async function refresh() {
    const d = await fetch("/api/conversations?scope=library").then((r) => r.json())
    setConvos(d.conversations ?? [])
    return (d.conversations ?? []) as Convo[]
  }

  useEffect(() => {
    refresh().then((list) => setActiveId((id) => id ?? list[0]?.id ?? null))
  }, [])

  async function newChat() {
    const d = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json())
    await refresh()
    setActiveId(d.conversation.id)
  }

  async function remove(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" })
    const list = await refresh()
    if (activeId === id) setActiveId(list[0]?.id ?? null)
  }

  return (
    <div className="grid flex-1 gap-4 md:grid-cols-[240px_1fr]">
      <aside className="space-y-2">
        <Button onClick={newChat} className="w-full gap-2" variant="outline">
          <Plus className="size-4" /> New chat
        </Button>
        <div className="space-y-1">
          {convos.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                c.id === activeId ? "bg-muted" : "hover:bg-muted/50"
              }`}
            >
              <button type="button" onClick={() => setActiveId(c.id)} className="min-w-0 flex-1 truncate text-left">
                {c.title}
              </button>
              <button
                type="button"
                aria-label="Delete conversation"
                onClick={() => remove(c.id)}
                className="ml-2 opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <Card className="flex min-h-[60vh] flex-col p-4">
        {activeId ? (
          <ConversationView chat={chat} disabled={!activeId} emptyHint="Ask anything across your whole library." />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Button onClick={newChat}>Start your first conversation</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
```
(The `/ask` page already renders `<AskLibrary />` inside a padded container — keep it; this component now fills it.)

- [ ] **Step 2: Remove the now-unused old chat component, verify, commit**

Nothing imports `episode-chat.tsx` anymore — delete it:
```bash
git rm components/episode-chat.tsx
```
Run `grep -rn "episode-chat" app components` → expect NO matches. Then `pnpm typecheck && pnpm build` (both clean/green).
```bash
git add -A
git commit -m "feat: two-pane Ask page with history; remove obsolete chat component"
```

- [ ] **Step 3: Full Phase-1 verification**

Run: `pnpm test` (all pass; chat persist test skipped without key), `pnpm typecheck`, `pnpm build`. Manual smoke (local): new thread, ask, follow-up, switch threads, delete, stop, regenerate, copy, markdown render, timestamp click.

---

# PHASE 2 — Retrieval upgrades

## Task 9: Full-transcript episode context (+ cap)

**Files:**
- Modify: `app/api/chat/route.ts`
- Create: `lib/ai/episode-context.ts`
- Test: `test/ai/episode-context.test.ts`

- [ ] **Step 1: Write failing test `test/ai/episode-context.test.ts`**

```ts
import { expect, test } from "vitest"
import { buildTranscriptContext, estimateTokens } from "@/lib/ai/episode-context"

test("formats segments as [mm:ss] lines", () => {
  const ctx = buildTranscriptContext([
    { start: 0, end: 5, text: "hello" },
    { start: 65, end: 70, text: "world" },
  ])
  expect(ctx).toBe("[0:00] hello\n[1:05] world")
})

test("estimateTokens approximates by chars", () => {
  expect(estimateTokens("a".repeat(40))).toBe(10)
})
```
Run → FAIL.

- [ ] **Step 2: Implement `lib/ai/episode-context.ts`**

```ts
import { formatTimestamp } from "@/lib/format"

type Segment = { start: number; end: number; text: string }

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function buildTranscriptContext(segments: Segment[]): string {
  return segments
    .map((s) => `[${formatTimestamp(s.start)}] ${s.text}`)
    .join("\n")
}

export const MAX_TRANSCRIPT_TOKENS = 60_000
```
Note: `formatTimestamp(0)` returns `"0:00"`.
Run the test → PASS.

- [ ] **Step 3: Use it in `app/api/chat/route.ts`** for episode conversations

Add imports:
```ts
import { eq } from "drizzle-orm"
import { transcripts } from "@/lib/db/schema"
import { buildTranscriptContext, estimateTokens, MAX_TRANSCRIPT_TOKENS } from "@/lib/ai/episode-context"
```
Replace the phase-1 retrieval block (the `searchChunks` call through `sources`) with episode-vs-library branching:
```ts
  const libraryWide = !episodeId
  let context = ""
  let sources: ChatSource[] = []

  if (episodeId) {
    const [t] = await db.select().from(transcripts).where(eq(transcripts.episodeId, episodeId)).limit(1)
    const full = t?.segments ? buildTranscriptContext(t.segments) : ""
    if (full && estimateTokens(full) <= MAX_TRANSCRIPT_TOKENS) {
      context = full // whole transcript; no sources chips in this mode
    } else {
      // Fallback: chunk RAG for very long transcripts.
      const hits = await searchChunks(db, await embedQuery(content), { limit: 10, episodeId })
      context = hits.map((h) => `[${formatTimestamp(h.startSec)}] ${h.content}`).join("\n\n")
      sources = hits.map((h) => ({ episodeId: h.episodeId, episodeTitle: h.episodeTitle, startSec: h.startSec }))
    }
  } else {
    const hits = await searchChunks(db, await embedQuery(content), { limit: 8 })
    context = hits.map((h) => `[${h.episodeTitle} — ${formatTimestamp(h.startSec)}] ${h.content}`).join("\n\n")
    sources = hits.map((h) => ({ episodeId: h.episodeId, episodeTitle: h.episodeTitle, startSec: h.startSec }))
  }
```
(Library retrieval is replaced again in Task 11. Keep the `system`/`streamText`/`onFinish`/return from Task 4 unchanged.)
Run: `pnpm test test/ai/episode-context.test.ts` → PASS; `pnpm typecheck`.

- [ ] **Step 4: Commit**
```bash
git add app/api/chat/route.ts lib/ai/episode-context.ts test/ai/episode-context.test.ts
git commit -m "feat: full-transcript context for episode chat with RAG fallback"
```

---

## Task 10: Query condensing (library follow-ups)

**Files:**
- Create: `lib/ai/condense.ts`
- Test: `test/ai/condense.test.ts`

- [ ] **Step 1: Write failing test `test/ai/condense.test.ts`**

```ts
import { expect, test } from "vitest"
import { MockLanguageModelV3 } from "ai/test"
import { condenseQuery } from "@/lib/ai/condense"

test("returns the question unchanged when there is no history", async () => {
  const model = new MockLanguageModelV3({ doGenerate: async () => { throw new Error("should not call") } })
  const out = await condenseQuery([], "What is RRF?", { model })
  expect(out).toBe("What is RRF?")
})

test("rewrites a follow-up into a standalone query using history", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
      content: [{ type: "text" as const, text: "What did Elon say about manufacturing speed?" }],
      warnings: [],
    }),
  })
  const out = await condenseQuery(
    [{ role: "user", content: "Tell me about Elon's views" }, { role: "assistant", content: "..." }],
    "what about manufacturing?",
    { model },
  )
  expect(out).toContain("manufacturing")
})
```
Run → FAIL. (If the V3 `usage` shape needs more fields, mirror the shape used by `lib/ai/insights.ts`'s test.)

- [ ] **Step 2: Implement `lib/ai/condense.ts`**

```ts
import { openai } from "@ai-sdk/openai"
import { generateText, type LanguageModel } from "ai"

type Turn = { role: "user" | "assistant"; content: string }

export async function condenseQuery(
  history: Turn[],
  question: string,
  opts: { model?: LanguageModel } = {},
): Promise<string> {
  if (history.length === 0) return question
  const transcript = history.map((m) => `${m.role}: ${m.content}`).join("\n")
  const { text } = await generateText({
    model: opts.model ?? openai("gpt-5.4-mini-2026-03-17"),
    prompt:
      "Given the conversation so far and a follow-up question, rewrite the follow-up as a standalone " +
      "search query (no preamble, just the query).\n\nConversation:\n" +
      transcript +
      "\n\nFollow-up: " +
      question +
      "\n\nStandalone query:",
  })
  return text.trim() || question
}
```
Run the test → PASS.

- [ ] **Step 3: Commit**
```bash
git add lib/ai/condense.ts test/ai/condense.test.ts
git commit -m "feat: condense follow-up questions into standalone queries"
```

---

## Task 11: Hybrid search (vector + full-text, RRF) + wiring

**Files:**
- Modify: `lib/db/search.ts`
- Modify: `app/api/chat/route.ts` (library branch)
- Modify: `app/api/search/route.ts` (adopt hybrid)
- Test: `test/db/search.test.ts` (extend)

- [ ] **Step 1: Add a failing hybrid test to `test/db/search.test.ts`**

Append:
```ts
import { hybridSearch } from "@/lib/db/search"

test("hybridSearch surfaces a keyword-only match that vectors miss", async () => {
  const ep = await repo.create({ title: "E", audioUrl: "https://a/2.mp3" })
  await db.insert(schema.chunks).values([
    { episodeId: ep.id, content: "the quokka is a small marsupial", startSec: 0, endSec: 5, embedding: Array(1536).fill(-0.05) },
    { episodeId: ep.id, content: "unrelated filler text about weather", startSec: 5, endSec: 10, embedding: Array(1536).fill(0.1) },
  ])
  // Query embedding favors the second chunk, but the keyword 'quokka' should pull the first up via RRF.
  const hits = await hybridSearch(db, Array(1536).fill(0.1), "quokka", { limit: 2 })
  expect(hits.map((h) => h.content)).toContain("the quokka is a small marsupial")
}, 30_000)
```
(Uses the existing `repo`/`db`/`vec` harness in that file.)
Run → FAIL.

- [ ] **Step 2: Add `hybridSearch` to `lib/db/search.ts`**

```ts
// Append to lib/db/search.ts
import { sql } from "drizzle-orm"

export async function hybridSearch(
  db: PostgresJsDatabase<typeof schema>,
  queryEmbedding: number[],
  queryText: string,
  opts: { limit?: number } = {},
): Promise<SearchHit[]> {
  const limit = opts.limit ?? 8
  const k = 60 // RRF constant
  const vec = `[${queryEmbedding.join(",")}]`
  const rows = await db.execute(sql`
    with vec as (
      select id, row_number() over (order by embedding <=> ${vec}::vector) as rank
      from chunks order by embedding <=> ${vec}::vector limit 50
    ),
    fts as (
      select id, row_number() over (
        order by ts_rank(content_tsv, websearch_to_tsquery('english', ${queryText})) desc
      ) as rank
      from chunks
      where content_tsv @@ websearch_to_tsquery('english', ${queryText})
      limit 50
    ),
    fused as (
      select coalesce(vec.id, fts.id) as id,
             coalesce(1.0/(${k} + vec.rank), 0) + coalesce(1.0/(${k} + fts.rank), 0) as score
      from vec full outer join fts on vec.id = fts.id
    )
    select c.id as "chunkId", c.episode_id as "episodeId", e.title as "episodeTitle",
           c.content, c.start_sec as "startSec", c.end_sec as "endSec", f.score as "similarity"
    from fused f
    join chunks c on c.id = f.id
    join episodes e on e.id = c.episode_id
    order by f.score desc
    limit ${limit}
  `)
  return rows as unknown as SearchHit[]
}
```
Note: `db.execute(sql\`…\`)` with postgres-js returns the rows array directly. If your drizzle version wraps results, unwrap accordingly (log the shape once). The `::vector` cast requires pgvector (already installed).
Run: `pnpm test test/db/search.test.ts` → PASS (existing + new).

- [ ] **Step 3: Wire hybrid + condense into the library branch of `app/api/chat/route.ts`**

Add imports:
```ts
import { hybridSearch } from "@/lib/db/search"
import { condenseQuery } from "@/lib/ai/condense"
```
Replace the `else` (library) branch body from Task 9 with:
```ts
  } else {
    const searchQuery = await condenseQuery(
      data.messages.map((m) => ({ role: m.role, content: m.content })),
      content,
    )
    const hits = await hybridSearch(db, await embedQuery(searchQuery), searchQuery, { limit: 8 })
    context = hits.map((h) => `[${h.episodeTitle} — ${formatTimestamp(h.startSec)}] ${h.content}`).join("\n\n")
    sources = hits.map((h) => ({ episodeId: h.episodeId, episodeTitle: h.episodeTitle, startSec: h.startSec }))
  }
```

- [ ] **Step 4: Adopt hybrid in `app/api/search/route.ts`**

```ts
import { db } from "@/lib/db"
import { embedQuery } from "@/lib/ai/embeddings"
import { hybridSearch } from "@/lib/db/search"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.query) return Response.json({ error: "missing query" }, { status: 400 })
  const hits = await hybridSearch(db, await embedQuery(body.query), body.query, {
    limit: Math.min(Number(body.limit) || 12, 50),
  })
  return Response.json({ hits })
}
```

- [ ] **Step 5: Verify + commit**

Run: `pnpm test`, `pnpm typecheck`, `pnpm build` (all green).
```bash
git add lib/db/search.ts app/api/chat/route.ts app/api/search/route.ts test/db/search.test.ts
git commit -m "feat: hybrid (vector+full-text RRF) retrieval for library chat and search"
```

---

## Final verification & deploy

- [ ] Run `pnpm test` (all pass), `pnpm typecheck` (clean), `pnpm build` (success).
- [ ] Manual smoke (local `pnpm dev`): episode chat answers from full transcript with clickable `[mm:ss]`; library Ask multi-turn follow-up works and shows source chips; hybrid search finds keyword-only matches; history switch/new/delete; stop/regenerate/copy; markdown formatting.
- [ ] Push `main`; confirm Railway deploy `success` via `gh api repos/jereswinnen/flux/commits/<sha>/status`. The deploy's `pnpm db:migrate` step applies the migration automatically; the migration was also pre-applied during Task 1.

---

## Notes
- Use the `shadcn` skill for the `select` component (Task 7) and `frontend-design` for the chat/markdown UI polish.
- Theme tokens only (no hardcoded colors). Markdown uses `prose` classes (Tailwind typography is available via the `prose` utilities already used elsewhere; if `prose` classes have no effect, style the message container directly with `text-sm leading-relaxed` and spacing — do not add the typography plugin unless needed).
- `react-markdown` renders untrusted-ish model text; it does not execute HTML by default (safe). Keep default settings (no `rehype-raw`).
