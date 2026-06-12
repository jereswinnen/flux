import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeItemRepo } from "@/lib/db/items"
import { makeHighlightRepo } from "@/lib/db/highlights"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const items = makeItemRepo(db)
const repo = makeHighlightRepo(db)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
beforeEach(async () => {
  await db.delete(schema.highlights)
  await db.delete(schema.items)
})
afterAll(async () => {
  await client.end()
})

test("create + list newest-first with item context", async () => {
  const item = await items.create({ type: "podcast", title: "Ep", audioUrl: "https://a/1.mp3" })
  await repo.create({ itemId: item.id, kind: "transcript", text: "first", locator: { sec: 10 } })
  await repo.create({ itemId: item.id, kind: "takeaway", text: "second", locator: { index: 0 } })
  const rows = await repo.list({})
  expect(rows.map((r) => r.text)).toEqual(["second", "first"])
  expect(rows[0].item.title).toBe("Ep")
  expect(rows[0].item.type).toBe("podcast")
})

test("filters by source type and searches text/note", async () => {
  const pod = await items.create({ type: "podcast", title: "P", audioUrl: "https://a/p.mp3" })
  const vid = await items.create({ type: "youtube", title: "V", sourceMetadata: { videoId: "x" } })
  await repo.create({ itemId: pod.id, kind: "quote", text: "alpha", note: "keep" })
  await repo.create({ itemId: vid.id, kind: "transcript", text: "beta" })
  expect((await repo.list({ type: "youtube" })).map((r) => r.text)).toEqual(["beta"])
  expect((await repo.list({ q: "alph" })).map((r) => r.text)).toEqual(["alpha"])
  expect((await repo.list({ q: "keep" })).map((r) => r.text)).toEqual(["alpha"])
})

test("updateNote + remove", async () => {
  const item = await items.create({ type: "podcast", title: "Ep", audioUrl: "https://a/1.mp3" })
  const h = await repo.create({ itemId: item.id, kind: "transcript", text: "x" })
  await repo.updateNote(h.id, "my note")
  expect((await repo.list({}))[0].note).toBe("my note")
  await repo.remove(h.id)
  expect(await repo.list({})).toEqual([])
})
