import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeItemRepo } from "@/lib/db/items"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const repo = makeItemRepo(db)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
beforeEach(async () => {
  await db.delete(schema.items)
})
afterAll(async () => {
  await client.end()
})

test("create returns a processing podcast item", async () => {
  const item = await repo.create({
    type: "podcast",
    title: "E",
    audioUrl: "https://a/1.mp3",
    sourceMetadata: { guid: "g1" },
  })
  expect(item.status).toBe("processing")
  expect(item.type).toBe("podcast")
})

test("dedupes podcasts by sourceMetadata.guid", async () => {
  const a = await repo.create({
    type: "podcast",
    title: "Ep 1",
    audioUrl: "https://x/1.mp3",
    sourceMetadata: { guid: "guid-1" },
  })
  const b = await repo.create({
    type: "podcast",
    title: "Ep 1 (dupe)",
    audioUrl: "https://x/1-other.mp3",
    sourceMetadata: { guid: "guid-1" },
  })
  expect(b.id).toBe(a.id)
})

test("dedupes on audioUrl when guid absent", async () => {
  const a = await repo.create({ type: "podcast", title: "E", audioUrl: "https://a/1.mp3" })
  const b = await repo.create({ type: "podcast", title: "E2", audioUrl: "https://a/1.mp3" })
  expect(b.id).toBe(a.id)
})

test("updateStatus changes status and error", async () => {
  const item = await repo.create({ type: "podcast", title: "E", audioUrl: "https://a/1.mp3" })
  await repo.updateStatus(item.id, "failed", "boom")
  const got = await repo.getById(item.id)
  expect(got?.status).toBe("failed")
  expect(got?.errorMessage).toBe("boom")
})
