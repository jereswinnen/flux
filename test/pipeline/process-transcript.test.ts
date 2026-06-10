import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest"
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
  await db.delete(schema.entities)
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

test("processTranscript resolves entities after insights, and a resolver failure does not fail the episode", async () => {
  const ep = await repo.create({ title: "Entity EP", audioUrl: "https://a/ent.mp3" })
  const insightsValue = {
    summary: "s",
    takeaways: [],
    topics: [],
    chapters: [],
    quotes: [],
    entities: [
      { name: "Steve Jobs", type: "person" as const, context: "design talk", approxTimestampSec: 10 },
    ],
  }
  const resolveEntities = vi.fn(async () => {})

  await processTranscript(
    { episodeId: ep.id, transcript: "hello world", segments: [{ start: 0, end: 5, text: "hello world" }] },
    {
      db,
      generateInsights: async () => insightsValue,
      embedTexts: async (texts: string[]) => texts.map(() => Array(1536).fill(0.1)),
      resolveEntities,
    },
  )

  expect(resolveEntities).toHaveBeenCalledWith(
    ep.id,
    insightsValue.entities,
    expect.objectContaining({ episodeTitle: "Entity EP" }),
  )
  expect((await repo.getById(ep.id))?.status).toBe("ready")

  // A resolver crash is logged, not fatal: episode still reaches "ready".
  const ep2 = await repo.create({ title: "Entity EP 2", audioUrl: "https://a/ent2.mp3" })
  await processTranscript(
    { episodeId: ep2.id, transcript: "hi", segments: [{ start: 0, end: 2, text: "hi" }] },
    {
      db,
      generateInsights: async () => insightsValue,
      embedTexts: async (texts: string[]) => texts.map(() => Array(1536).fill(0.1)),
      resolveEntities: async () => {
        throw new Error("resolver down")
      },
    },
  )
  expect((await repo.getById(ep2.id))?.status).toBe("ready")
}, 60_000)

test("re-running processTranscript deletes prior episode_entities links (step 0 idempotency)", async () => {
  const ep = await repo.create({ title: "Idem EP", audioUrl: "https://a/idem.mp3" })

  // Simulate a previous run's leftovers: a canonical entity + a link row.
  const [entity] = await db
    .insert(schema.entities)
    .values({ name: "Steve Jobs", slug: "steve-jobs-idem", type: "person" })
    .returning()
  await db
    .insert(schema.episodeEntities)
    .values({ episodeId: ep.id, entityId: entity.id, context: "old run" })

  await processTranscript(
    { episodeId: ep.id, transcript: "hi", segments: [{ start: 0, end: 2, text: "hi" }] },
    {
      db,
      generateInsights: async () => ({
        summary: "s",
        takeaways: [],
        topics: [],
        chapters: [],
        quotes: [],
        entities: [],
      }),
      embedTexts: async (texts: string[]) => texts.map(() => Array(1536).fill(0.1)),
      resolveEntities: async () => {},
    },
  )

  // Step 0 wiped the stale links; the stub resolver created none.
  const links = await db
    .select()
    .from(schema.episodeEntities)
    .where(eq(schema.episodeEntities.episodeId, ep.id))
  expect(links).toHaveLength(0)
  expect((await repo.getById(ep.id))?.status).toBe("ready")
}, 30_000)
