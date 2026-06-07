import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeEpisodeRepo } from "@/lib/db/episodes"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const repo = makeEpisodeRepo(db)

beforeAll(async () => { await migrate(db, { migrationsFolder: "./lib/db/migrations" }) })
beforeEach(async () => { await db.delete(schema.episodes) })
afterAll(async () => { await client.end() })

test("remove deletes the episode and cascades transcript/insights/chunks", async () => {
  const ep = await repo.create({ title: "E", audioUrl: "https://a/1.mp3" })
  await db.insert(schema.transcripts).values({ episodeId: ep.id, fullText: "t", segments: [] })
  await db.insert(schema.insights).values({ episodeId: ep.id, summary: "s" })
  await db.insert(schema.chunks).values({ episodeId: ep.id, content: "c", startSec: 0, endSec: 1, embedding: Array(1536).fill(0.1) })
  await repo.remove(ep.id)
  expect(await repo.getById(ep.id)).toBeNull()
  expect(await db.select().from(schema.transcripts).where(eq(schema.transcripts.episodeId, ep.id))).toHaveLength(0)
  expect(await db.select().from(schema.chunks).where(eq(schema.chunks.episodeId, ep.id))).toHaveLength(0)
})
