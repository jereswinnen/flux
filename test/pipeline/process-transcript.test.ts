import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeEpisodeRepo } from "@/lib/db/episodes"
import { processTranscript } from "@/lib/pipeline/process-transcript"

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

test("stores transcript, insights, chunks and marks ready", async () => {
  const ep = await repo.create({ title: "E", audioUrl: "https://a/1.mp3" })

  await processTranscript(
    {
      episodeId: ep.id,
      transcript: "hello world ".repeat(200),
      segments: [
        { start: 0, end: 5, text: "hello world ".repeat(50) },
        { start: 5, end: 10, text: "hello world ".repeat(50) },
      ],
    },
    {
      db,
      generateInsights: async () => ({
        summary: "s",
        takeaways: ["t"],
        topics: ["x"],
        chapters: [],
        quotes: [],
        entities: [],
      }),
      embedTexts: async (texts) => texts.map(() => Array(1536).fill(0.1)),
    },
  )

  const got = await repo.getById(ep.id)
  expect(got?.status).toBe("ready")

  const t = await db.select().from(schema.transcripts).where(eq(schema.transcripts.episodeId, ep.id))
  expect(t).toHaveLength(1)
  const ins = await db.select().from(schema.insights).where(eq(schema.insights.episodeId, ep.id))
  expect(ins[0].summary).toBe("s")
  const ch = await db.select().from(schema.chunks).where(eq(schema.chunks.episodeId, ep.id))
  expect(ch.length).toBeGreaterThan(0)
}, 30_000)
