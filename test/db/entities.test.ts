import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeEpisodeRepo } from "@/lib/db/episodes"
import {
  coMentionedEntities,
  entitiesForEpisode,
  episodesMentioningEntity,
  getEntityBySlug,
  searchEntities,
} from "@/lib/db/entities"

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
  const chunksAfter = await db
    .select()
    .from(schema.chunks)
    .where(eq(schema.chunks.episodeId, ep.id))
  expect(chunksAfter).toHaveLength(0)
}, 30_000)

async function seedKnowledgeBase() {
  const ep1 = await repo.create({ title: "EP One", audioUrl: "https://a/kb1.mp3" })
  const ep2 = await repo.create({ title: "EP Two", audioUrl: "https://a/kb2.mp3" })
  const [jobs] = await db
    .insert(schema.entities)
    .values({
      name: "Steve Jobs",
      slug: "steve-jobs",
      type: "person",
      description: "American businessman",
      enrichmentStatus: "enriched",
    })
    .returning()
  const [apple] = await db
    .insert(schema.entities)
    .values({
      name: "Apple",
      slug: "apple",
      type: "company",
      description: "Consumer electronics company",
      enrichmentStatus: "enriched",
    })
    .returning()
  await db.insert(schema.episodeEntities).values([
    { episodeId: ep1.id, entityId: jobs.id, context: "design philosophy", approxTimestampSec: 60 },
    { episodeId: ep1.id, entityId: apple.id, context: "the Mac story" },
    { episodeId: ep2.id, entityId: jobs.id, context: "hiring" },
  ])
  return { ep1, ep2, jobs, apple }
}

test("getEntityBySlug and entitiesForEpisode return enriched rows with mention counts", async () => {
  const { ep1, jobs } = await seedKnowledgeBase()

  expect((await getEntityBySlug(db, "steve-jobs"))?.id).toBe(jobs.id)
  expect(await getEntityBySlug(db, "nope")).toBeNull()

  const forEp = await entitiesForEpisode(db, ep1.id)
  expect(forEp).toHaveLength(2)
  const jobsRow = forEp.find((e) => e.slug === "steve-jobs")!
  expect(jobsRow.context).toBe("design philosophy")
  expect(jobsRow.approxTimestampSec).toBe(60)
  expect(Number(jobsRow.mentionCount)).toBe(2)
}, 30_000)

test("episodesMentioningEntity returns episodes with per-episode context", async () => {
  const { jobs } = await seedKnowledgeBase()
  const eps = await episodesMentioningEntity(db, jobs.id)
  expect(eps).toHaveLength(2)
  expect(eps.map((e) => e.title).sort()).toEqual(["EP One", "EP Two"])
  expect(eps.find((e) => e.title === "EP One")?.context).toBe("design philosophy")
}, 30_000)

test("coMentionedEntities surfaces entities sharing episodes", async () => {
  const { jobs, apple } = await seedKnowledgeBase()
  const co = await coMentionedEntities(db, jobs.id, 5)
  expect(co).toHaveLength(1)
  expect(co[0].id).toBe(apple.id)
  expect(Number(co[0].sharedEpisodes)).toBe(1)
}, 30_000)

test("searchEntities matches name or description, case-insensitively", async () => {
  await seedKnowledgeBase()
  const byName = await searchEntities(db, "steve", 5)
  expect(byName.map((e) => e.slug)).toContain("steve-jobs")
  const byDescription = await searchEntities(db, "electronics", 5)
  expect(byDescription.map((e) => e.slug)).toContain("apple")
}, 30_000)

test("searchEntities hides entities with zero mentions", async () => {
  await seedKnowledgeBase()
  await db.insert(schema.entities).values({
    name: "Steve Orphan",
    slug: "steve-orphan",
    type: "person",
    description: "No longer mentioned anywhere",
    enrichmentStatus: "enriched",
  })

  const out = await searchEntities(db, "steve", 5)
  expect(out.map((e) => e.slug)).toContain("steve-jobs")
  expect(out.map((e) => e.slug)).not.toContain("steve-orphan")
}, 30_000)
