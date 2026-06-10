import { and, eq, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { embedTexts as defaultEmbedTexts } from "@/lib/ai/embeddings"
import * as schema from "@/lib/db/schema"
import { searchCandidates as defaultSearchCandidates, type Candidate } from "@/lib/entities/sources"
import { verifyCandidate as defaultVerifyCandidate } from "@/lib/entities/verify"

type DB = PostgresJsDatabase<typeof schema>

export interface ExtractedEntity {
  name: string
  type: string
  context?: string
  approxTimestampSec?: number
}

export interface ResolveDeps {
  db: DB
  searchCandidates?: typeof defaultSearchCandidates
  verifyCandidate?: typeof defaultVerifyCandidate
  embedTexts?: (texts: string[]) => Promise<number[][]>
}

const ENTITY_TYPES: schema.EntityType[] = ["person", "company", "book", "product", "place", "other"]

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

async function uniqueSlug(db: DB, name: string): Promise<string> {
  const root = slugify(name) || "entity"
  let candidate = root
  for (let n = 2; ; n++) {
    const [hit] = await db
      .select({ id: schema.entities.id })
      .from(schema.entities)
      .where(eq(schema.entities.slug, candidate))
      .limit(1)
    if (!hit) return candidate
    candidate = `${root}-${n}`
  }
}

function entityValues(
  name: string,
  type: schema.EntityType,
  picked: Candidate | null,
): Omit<typeof schema.entities.$inferInsert, "slug"> {
  if (!picked) return { name, type, enrichmentStatus: "unmatched" }
  return {
    name,
    type,
    description: picked.description ?? null,
    summary: picked.summary ?? null,
    imageUrl: picked.imageUrl ?? null,
    wikipediaUrl: picked.source === "wikipedia" ? picked.url ?? null : null,
    wikidataId: picked.wikidataId ?? null,
    externalIds: picked.externalIds ?? null,
    metadata: picked.metadata ?? null,
    enrichmentStatus: "enriched",
  }
}

// The text embedded for Ask: entity identity + this episode's mention context.
function entityChunkText(
  entity: { name: string; type: string; description: string | null },
  context: string | undefined,
): string {
  const base = `${entity.name} (${entity.type}): ${entity.description ?? "mentioned in a podcast episode"}`
  return context ? `${base}. Mentioned in this episode: ${context}` : base
}

// Resolve one episode's extracted entities: reuse existing rows by normalized
// name + type, enrich new ones (candidates + LLM verification), link them via
// episode_entities, and write one entity chunk per link for RAG retrieval.
// Enrichment cost is once per *unique* entity across the library.
export async function resolveEpisodeEntities(
  episodeId: string,
  extracted: ExtractedEntity[],
  deps: ResolveDeps,
  opts: { episodeTitle?: string } = {},
): Promise<void> {
  const { db } = deps
  const search = deps.searchCandidates ?? defaultSearchCandidates
  const verify = deps.verifyCandidate ?? defaultVerifyCandidate
  const embed = deps.embedTexts ?? defaultEmbedTexts

  const chunkQueue: { entityId: string; content: string; startSec: number }[] = []

  for (const mention of extracted) {
    const name = mention.name.trim()
    if (!name) continue
    const type = (ENTITY_TYPES as string[]).includes(mention.type)
      ? (mention.type as schema.EntityType)
      : "other"

    // 1. Reuse an existing canonical entity (no API or LLM cost).
    let [entity] = await db
      .select()
      .from(schema.entities)
      .where(
        and(
          sql`lower(${schema.entities.name}) = ${name.toLowerCase()}`,
          eq(schema.entities.type, type),
        ),
      )
      .limit(1)

    // 2. New entity: enrich, degrading to unmatched/failed instead of throwing.
    if (!entity) {
      let values: Omit<typeof schema.entities.$inferInsert, "slug">
      try {
        const candidates = await search(name, type)
        const idx =
          candidates.length > 0
            ? await verify({ name, type, context: mention.context }, candidates, {
                episodeTitle: opts.episodeTitle,
              })
            : -1
        values = entityValues(name, type, idx >= 0 ? candidates[idx] : null)
      } catch {
        values = { name, type, enrichmentStatus: "failed" }
      }
      ;[entity] = await db
        .insert(schema.entities)
        .values({ ...values, slug: await uniqueSlug(db, name) })
        .returning()
    }

    // 3. Link (duplicate mentions in one episode collapse onto the PK).
    const inserted = await db
      .insert(schema.episodeEntities)
      .values({
        episodeId,
        entityId: entity.id,
        context: mention.context ?? null,
        approxTimestampSec:
          mention.approxTimestampSec != null ? Math.floor(mention.approxTimestampSec) : null,
      })
      .onConflictDoNothing()
      .returning()

    // 4. One entity chunk per link, embedded in a single batch below.
    if (inserted.length > 0) {
      chunkQueue.push({
        entityId: entity.id,
        content: entityChunkText(entity, mention.context),
        startSec: Math.floor(mention.approxTimestampSec ?? 0),
      })
    }
  }

  if (chunkQueue.length > 0) {
    const vectors = await embed(chunkQueue.map((c) => c.content))
    await db.insert(schema.chunks).values(
      chunkQueue.map((c, i) => ({
        episodeId,
        entityId: c.entityId,
        content: c.content,
        startSec: c.startSec,
        endSec: c.startSec,
        embedding: vectors[i],
      })),
    )
  }
}
