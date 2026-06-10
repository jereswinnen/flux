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

test("entities + episode_entities round-trip, and chunks accept an entityId", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })

  const [entity] = await db
    .insert(schema.entities)
    .values({
      name: "Steve Jobs",
      slug: "steve-jobs",
      type: "person",
      description: "Co-founder of Apple",
      enrichmentStatus: "enriched",
    })
    .returning()
  expect(entity.slug).toBe("steve-jobs")

  await db.insert(schema.episodeEntities).values({
    episodeId: ep.id,
    entityId: entity.id,
    context: "discussed re: product design",
    approxTimestampSec: 120,
  })
  const links = await db
    .select()
    .from(schema.episodeEntities)
    .where(eq(schema.episodeEntities.entityId, entity.id))
  expect(links).toHaveLength(1)
  expect(links[0].context).toBe("discussed re: product design")

  await db.insert(schema.chunks).values({
    episodeId: ep.id,
    entityId: entity.id,
    content: "Steve Jobs (person): Co-founder of Apple",
    startSec: 120,
    endSec: 120,
    embedding: Array(1536).fill(0.1),
  })
  const [chunk] = await db
    .select()
    .from(schema.chunks)
    .where(eq(schema.chunks.entityId, entity.id))
  expect(chunk.content).toContain("Steve Jobs")

  // Cascade: deleting the entity removes links and entity chunks.
  await db.delete(schema.entities).where(eq(schema.entities.id, entity.id))
  const after = await db
    .select()
    .from(schema.episodeEntities)
    .where(eq(schema.episodeEntities.entityId, entity.id))
  expect(after).toHaveLength(0)
}, 30_000)
