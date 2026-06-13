import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeItemRepo } from "@/lib/db/items"
import { makeHighlightRepo } from "@/lib/db/highlights"
import { deletionsSince } from "@/lib/db/deletions"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const itemRepo = makeItemRepo(db)
const highlightRepo = makeHighlightRepo(db)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
beforeEach(async () => {
  await db.delete(schema.deletions)
  await db.delete(schema.highlights)
  await db.delete(schema.items)
})
afterAll(async () => {
  await client.end()
})

test("updating an item bumps updatedAt (trigger works)", async () => {
  const item = await itemRepo.create({ type: "podcast", title: "Ep", audioUrl: "https://a/1.mp3" })
  const before = item.updatedAt
  // Small wait to ensure clock advances
  await new Promise((r) => setTimeout(r, 10))
  await itemRepo.updateStatus(item.id, "ready")
  const updated = await itemRepo.getById(item.id)
  expect(updated!.updatedAt.getTime()).toBeGreaterThan(before.getTime())
})

test("listUpdatedSince returns only items updated after cursor", async () => {
  const item = await itemRepo.create({ type: "podcast", title: "Ep", audioUrl: "https://a/1.mp3" })
  const cursor = new Date()
  await new Promise((r) => setTimeout(r, 10))
  await itemRepo.updateStatus(item.id, "ready")
  const results = await itemRepo.listUpdatedSince(cursor)
  expect(results.map((r) => r.id)).toContain(item.id)
  // Nothing before creation
  const empty = await itemRepo.listUpdatedSince(new Date())
  expect(empty).toHaveLength(0)
})

test("itemRepo.remove writes a deletion tombstone", async () => {
  const item = await itemRepo.create({ type: "podcast", title: "Ep", audioUrl: "https://a/1.mp3" })
  const before = new Date(Date.now() - 1)
  await itemRepo.remove(item.id)
  const dels = await deletionsSince(db, before)
  expect(dels).toHaveLength(1)
  expect(dels[0].type).toBe("item")
  expect(dels[0].entityId).toBe(item.id)
})

test("highlightRepo.remove writes a deletion tombstone", async () => {
  const item = await itemRepo.create({ type: "podcast", title: "Ep", audioUrl: "https://a/1.mp3" })
  const h = await highlightRepo.create({ itemId: item.id, kind: "transcript", text: "x" })
  const before = new Date(Date.now() - 1)
  await highlightRepo.remove(h.id)
  const dels = await deletionsSince(db, before)
  expect(dels).toHaveLength(1)
  expect(dels[0].type).toBe("highlight")
  expect(dels[0].entityId).toBe(h.id)
})

test("deletionsSince filters by timestamp", async () => {
  const item = await itemRepo.create({ type: "podcast", title: "Ep", audioUrl: "https://a/1.mp3" })
  await itemRepo.remove(item.id)
  const future = new Date(Date.now() + 60_000)
  const dels = await deletionsSince(db, future)
  expect(dels).toHaveLength(0)
})
