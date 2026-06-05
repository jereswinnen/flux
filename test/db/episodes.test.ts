import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeEpisodeRepo } from "@/lib/db/episodes"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const repo = makeEpisodeRepo(db)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
beforeEach(async () => {
  await db.delete(schema.episodes)
})
afterAll(async () => {
  await client.end()
})

test("create returns a processing episode", async () => {
  const ep = await repo.create({
    title: "E",
    audioUrl: "https://a/1.mp3",
    episodeGuid: "g1",
  })
  expect(ep.status).toBe("processing")
})

test("create dedupes on guid", async () => {
  const a = await repo.create({ title: "E", audioUrl: "https://a/1.mp3", episodeGuid: "g1" })
  const b = await repo.create({ title: "E again", audioUrl: "https://a/2.mp3", episodeGuid: "g1" })
  expect(b.id).toBe(a.id)
})

test("create dedupes on audioUrl when guid absent", async () => {
  const a = await repo.create({ title: "E", audioUrl: "https://a/1.mp3" })
  const b = await repo.create({ title: "E2", audioUrl: "https://a/1.mp3" })
  expect(b.id).toBe(a.id)
})

test("updateStatus changes status and error", async () => {
  const ep = await repo.create({ title: "E", audioUrl: "https://a/1.mp3" })
  await repo.updateStatus(ep.id, "failed", "boom")
  const got = await repo.getById(ep.id)
  expect(got?.status).toBe("failed")
  expect(got?.errorMessage).toBe("boom")
})
