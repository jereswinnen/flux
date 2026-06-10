import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeEpisodeRepo } from "@/lib/db/episodes"
import { resolveEpisodeEntities } from "@/lib/entities/resolve"
import type { Candidate } from "@/lib/entities/sources"

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

const jobsCandidate: Candidate = {
  source: "wikipedia",
  title: "Steve Jobs",
  description: "American businessman (1955–2011)",
  summary: "Steven Paul Jobs was...",
  imageUrl: "https://upload.wikimedia.org/jobs.jpg",
  url: "https://en.wikipedia.org/wiki/Steve_Jobs",
  wikidataId: "Q19837",
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    db,
    searchCandidates: vi.fn(async () => [jobsCandidate]),
    verifyCandidate: vi.fn(async () => 0),
    embedTexts: vi.fn(async (texts: string[]) => texts.map(() => Array(1536).fill(0.1))),
    ...overrides,
  }
}

test("new entity is enriched, linked, and gets an entity chunk", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  const d = deps()

  await resolveEpisodeEntities(
    ep.id,
    [{ name: "Steve Jobs", type: "person", context: "discussed re: design", approxTimestampSec: 90 }],
    d,
  )

  const [entity] = await db.select().from(schema.entities)
  expect(entity).toMatchObject({
    name: "Steve Jobs",
    slug: "steve-jobs",
    type: "person",
    description: "American businessman (1955–2011)",
    wikidataId: "Q19837",
    enrichmentStatus: "enriched",
  })

  const [link] = await db.select().from(schema.episodeEntities)
  expect(link).toMatchObject({
    episodeId: ep.id,
    entityId: entity.id,
    context: "discussed re: design",
    approxTimestampSec: 90,
  })

  const [chunk] = await db
    .select()
    .from(schema.chunks)
    .where(eq(schema.chunks.entityId, entity.id))
  expect(chunk.content).toContain("Steve Jobs (person)")
  expect(chunk.content).toContain("discussed re: design")
  expect(chunk.startSec).toBe(90)
}, 30_000)

test("existing entity is reused: no candidate search, no verify, just a link", async () => {
  const ep1 = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  const ep2 = await repo.create({ title: "E2", audioUrl: "https://a/2.mp3" })
  const d1 = deps()
  await resolveEpisodeEntities(ep1.id, [{ name: "Steve Jobs", type: "person" }], d1)

  const d2 = deps()
  // Different casing must still match.
  await resolveEpisodeEntities(
    ep2.id,
    [{ name: "steve jobs", type: "person", context: "hiring philosophy" }],
    d2,
  )

  expect(d2.searchCandidates).not.toHaveBeenCalled()
  expect(d2.verifyCandidate).not.toHaveBeenCalled()
  expect(await db.select().from(schema.entities)).toHaveLength(1)
  expect(await db.select().from(schema.episodeEntities)).toHaveLength(2)

  // The second episode still gets its own entity chunk, built from the stored
  // description plus this episode's mention context.
  const chunks = await db.select().from(schema.chunks)
  expect(chunks).toHaveLength(2)
  const ep2Chunk = chunks.find((c) => c.episodeId === ep2.id)
  expect(ep2Chunk?.content).toContain("American businessman")
  expect(ep2Chunk?.content).toContain("hiring philosophy")
}, 30_000)

test("a failed entity is re-enriched on next encounter", async () => {
  const ep1 = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  const ep2 = await repo.create({ title: "E2", audioUrl: "https://a/2.mp3" })

  const d1 = deps({ searchCandidates: vi.fn().mockRejectedValue(new Error("boom")) })
  await resolveEpisodeEntities(ep1.id, [{ name: "Steve Jobs", type: "person" }], d1)

  const [failed] = await db.select().from(schema.entities)
  expect(failed.enrichmentStatus).toBe("failed")

  const d2 = deps()
  await resolveEpisodeEntities(ep2.id, [{ name: "Steve Jobs", type: "person" }], d2)

  expect(d2.searchCandidates).toHaveBeenCalled()
  const rows = await db.select().from(schema.entities)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    id: failed.id,
    slug: failed.slug,
    enrichmentStatus: "enriched",
    description: "American businessman (1955–2011)",
  })
  expect(await db.select().from(schema.episodeEntities)).toHaveLength(2)
}, 30_000)

test("verifier rejection stores an unmatched entity that is still linked", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  const d = deps({ verifyCandidate: vi.fn(async () => -1) })

  await resolveEpisodeEntities(ep.id, [{ name: "Obscure Startup", type: "company" }], d)

  const [entity] = await db.select().from(schema.entities)
  expect(entity.enrichmentStatus).toBe("unmatched")
  expect(entity.description).toBeNull()
  expect(await db.select().from(schema.episodeEntities)).toHaveLength(1)
}, 30_000)

test("a throwing source still produces a linked 'failed' entity and other entities proceed", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  const search = vi
    .fn()
    .mockRejectedValueOnce(new Error("boom"))
    .mockResolvedValueOnce([jobsCandidate])
  const d = deps({ searchCandidates: search })

  await resolveEpisodeEntities(
    ep.id,
    [
      { name: "Broken One", type: "company" },
      { name: "Steve Jobs", type: "person" },
    ],
    d,
  )

  const rows = await db.select().from(schema.entities).orderBy(schema.entities.name)
  expect(rows).toHaveLength(2)
  expect(rows.find((r) => r.name === "Broken One")?.enrichmentStatus).toBe("failed")
  expect(rows.find((r) => r.name === "Steve Jobs")?.enrichmentStatus).toBe("enriched")
  expect(await db.select().from(schema.episodeEntities)).toHaveLength(2)
}, 30_000)

test("duplicate mentions in one episode create a single link", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  await resolveEpisodeEntities(
    ep.id,
    [
      { name: "Steve Jobs", type: "person" },
      { name: "Steve Jobs", type: "person" },
    ],
    deps(),
  )
  expect(await db.select().from(schema.entities)).toHaveLength(1)
  expect(await db.select().from(schema.episodeEntities)).toHaveLength(1)
}, 30_000)

test("empty extracted array does nothing", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  const d = deps()

  await resolveEpisodeEntities(ep.id, [], d)

  expect(await db.select().from(schema.entities)).toHaveLength(0)
  expect(await db.select().from(schema.episodeEntities)).toHaveLength(0)
  expect(d.embedTexts).not.toHaveBeenCalled()
}, 30_000)

test("no-signal mention skips the chunk", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  const d = deps({ verifyCandidate: vi.fn(async () => -1) })

  await resolveEpisodeEntities(ep.id, [{ name: "Obscure Startup", type: "company" }], d)

  const [entity] = await db.select().from(schema.entities)
  expect(entity.enrichmentStatus).toBe("unmatched")
  expect(await db.select().from(schema.episodeEntities)).toHaveLength(1)
  expect(
    await db.select().from(schema.chunks).where(eq(schema.chunks.entityId, entity.id)),
  ).toHaveLength(0)
}, 30_000)

test("slug collisions get a numeric suffix", async () => {
  const ep = await repo.create({ title: "E1", audioUrl: "https://a/1.mp3" })
  await db.insert(schema.entities).values({
    name: "Mercury (planet)",
    slug: "mercury",
    type: "other",
    enrichmentStatus: "unmatched",
  })
  const d = deps({ verifyCandidate: vi.fn(async () => -1) })
  await resolveEpisodeEntities(ep.id, [{ name: "Mercury", type: "company" }], d)

  const rows = await db.select().from(schema.entities)
  expect(rows.map((r) => r.slug).sort()).toEqual(["mercury", "mercury-2"])
}, 30_000)
