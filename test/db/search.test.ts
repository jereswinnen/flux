import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeItemRepo } from "@/lib/db/items"
import { searchChunks, hybridSearch } from "@/lib/db/search"

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

function vec(fill: number) {
  return Array(1536).fill(fill)
}

test("returns the nearest chunk by cosine similarity", async () => {
  const ep = await repo.create({ type: "podcast", title: "E", audioUrl: "https://a/1.mp3" })
  await db.insert(schema.chunks).values([
    { itemId: ep.id, content: "near", startSec: 0, endSec: 5, embedding: vec(0.1) },
    { itemId: ep.id, content: "far", startSec: 5, endSec: 10, embedding: vec(-0.1) },
  ])

  const results = await searchChunks(db, vec(0.1), { limit: 1 })
  expect(results[0].content).toBe("near")
  expect(results[0].itemTitle).toBe("E")
  expect(typeof results[0].similarity).toBe("number")
}, 30_000)

test("hybridSearch surfaces a keyword-only match that vectors miss", async () => {
  const ep = await repo.create({ type: "podcast", title: "E", audioUrl: "https://a/2.mp3" })
  await db.insert(schema.chunks).values([
    { itemId: ep.id, content: "the quokka is a small marsupial", startSec: 0, endSec: 5, embedding: Array(1536).fill(-0.05) },
    { itemId: ep.id, content: "unrelated filler text about weather", startSec: 5, endSec: 10, embedding: Array(1536).fill(0.1) },
  ])
  const hits = await hybridSearch(db, Array(1536).fill(0.1), "quokka", { limit: 2 })
  expect(hits.map((h) => h.content)).toContain("the quokka is a small marsupial")
}, 30_000)
