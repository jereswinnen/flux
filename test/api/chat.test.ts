import { config } from "dotenv"
config({ path: ".env.local" })

import { afterAll, beforeEach, expect, test } from "vitest"
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
}, 30_000)

test.skipIf(!process.env.OPENAI_API_KEY)("regenerate replaces the assistant turn without duplicating the user turn", async () => {
  const c = await repo.create({ episodeId: null })
  const { POST } = await import("@/app/api/chat/route")
  await (await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ conversationId: c.id, content: "Say hi." }) }))).text()
  let got = await repo.get(c.id)
  expect(got?.messages.filter((m) => m.role === "user").length).toBe(1)
  await (await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ conversationId: c.id, regenerate: true }) }))).text()
  got = await repo.get(c.id)
  expect(got?.messages.filter((m) => m.role === "user").length).toBe(1)
  expect(got?.messages.filter((m) => m.role === "assistant").length).toBe(1)
}, 60_000)

test("regenerate with no messages returns 400", async () => {
  const c = await repo.create({ episodeId: null })
  const { POST } = await import("@/app/api/chat/route")
  const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ conversationId: c.id, regenerate: true }) }))
  expect(res.status).toBe(400)
})
