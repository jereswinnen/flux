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
