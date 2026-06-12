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
  const c = await repo.create({ itemId: null })
  expect(c.title).toBe("New chat")
  const list = await repo.list(null)
  expect(list.map((x) => x.id)).toContain(c.id)
})

test("addMessage, get returns ordered messages, title set from first user msg", async () => {
  const c = await repo.create({ itemId: null })
  await repo.addMessage({ conversationId: c.id, role: "user", content: "What is RRF?" })
  await repo.setTitleFromFirstMessage(c.id, "What is RRF?")
  await repo.addMessage({
    conversationId: c.id,
    role: "assistant",
    content: "Reciprocal rank fusion.",
    sources: [{ itemId: "e1", itemTitle: "E", startSec: 10 }],
  })
  const got = await repo.get(c.id)
  expect(got?.conversation.title).toBe("What is RRF?")
  expect(got?.messages.map((m) => m.role)).toEqual(["user", "assistant"])
  expect(got?.messages[1].sources?.[0].startSec).toBe(10)
})

test("remove cascades to messages", async () => {
  const c = await repo.create({ itemId: null })
  await repo.addMessage({ conversationId: c.id, role: "user", content: "hi" })
  await repo.remove(c.id)
  expect(await repo.get(c.id)).toBeNull()
})

test("rename updates the title", async () => {
  const c = await repo.create({ itemId: null })
  await repo.rename(c.id, "  My renamed thread  ")
  const got = await repo.get(c.id)
  expect(got?.conversation.title).toBe("My renamed thread")
})

test("truncateFrom deletes the target message and everything after it", async () => {
  const c = await repo.create({ itemId: null })
  const m1 = await repo.addMessage({ conversationId: c.id, role: "user", content: "q1" })
  await new Promise((r) => setTimeout(r, 5))
  const m2 = await repo.addMessage({ conversationId: c.id, role: "assistant", content: "a1" })
  await new Promise((r) => setTimeout(r, 5))
  await repo.addMessage({ conversationId: c.id, role: "user", content: "q2" })
  await repo.truncateFrom(c.id, m2.id)
  const got = await repo.get(c.id)
  expect(got?.messages.map((m) => m.content)).toEqual(["q1"])
  expect(m1.id).toBeTruthy()
})
