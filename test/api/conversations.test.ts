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
