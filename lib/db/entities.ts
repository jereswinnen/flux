import { and, desc, eq, ilike, or, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { entities, episodeEntities, episodes } from "./schema"
import * as schema from "./schema"

type DB = PostgresJsDatabase<typeof schema>

// Correlation is hard-qualified ("entities"."id") because drizzle renders
// single-table selects with unqualified columns, which would otherwise rely on
// episode_entities never gaining an `id` column. count(*) comes back from
// postgres-js as a bigint string, hence mapWith(Number).
const mentionCount = sql`(
  select count(*) from ${episodeEntities} ee where ee.entity_id = "entities"."id"
)`
  .mapWith(Number)
  .as("mention_count")

export async function getEntityBySlug(db: DB, slug: string) {
  const rows = await db.select().from(entities).where(eq(entities.slug, slug)).limit(1)
  return rows[0] ?? null
}

// Entities mentioned in one episode, with this episode's mention context and
// the library-wide mention count (for the hover card).
export async function entitiesForEpisode(db: DB, episodeId: string) {
  return db
    .select({
      id: entities.id,
      name: entities.name,
      slug: entities.slug,
      type: entities.type,
      description: entities.description,
      imageUrl: entities.imageUrl,
      metadata: entities.metadata,
      context: episodeEntities.context,
      approxTimestampSec: episodeEntities.approxTimestampSec,
      mentionCount,
    })
    .from(episodeEntities)
    .innerJoin(entities, eq(entities.id, episodeEntities.entityId))
    .where(eq(episodeEntities.episodeId, episodeId))
    .orderBy(entities.name)
}

// Episodes mentioning an entity, each with its own context line and timestamp.
export async function episodesMentioningEntity(db: DB, entityId: string) {
  return db
    .select({
      id: episodes.id,
      title: episodes.title,
      podcastName: episodes.podcastName,
      artworkUrl: episodes.artworkUrl,
      publishedAt: episodes.publishedAt,
      createdAt: episodes.createdAt,
      context: episodeEntities.context,
      approxTimestampSec: episodeEntities.approxTimestampSec,
    })
    .from(episodeEntities)
    .innerJoin(episodes, eq(episodes.id, episodeEntities.episodeId))
    .where(eq(episodeEntities.entityId, entityId))
    .orderBy(desc(episodes.createdAt))
}

// "Often mentioned with": entities sharing episodes with this one, by count.
// Raw SQL: drizzle's builder can't alias a self-join on episode_entities cleanly.
export async function coMentionedEntities(db: DB, entityId: string, limit = 8) {
  const result = await db.execute(sql`
    select e.id, e.name, e.slug, e.type, e.image_url as "imageUrl",
           count(*) as "sharedEpisodes"
    from episode_entities ee
    join episode_entities co on co.episode_id = ee.episode_id and co.entity_id <> ee.entity_id
    join entities e on e.id = co.entity_id
    where ee.entity_id = ${entityId}
    group by e.id
    order by count(*) desc
    limit ${limit}
  `)
  const rows = (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as {
    id: string
    name: string
    slug: string
    type: string
    imageUrl: string | null
    sharedEpisodes: number | string
  }[]
  // postgres-js returns count(*) as a bigint string; normalize for callers.
  return rows.map((r) => ({ ...r, sharedEpisodes: Number(r.sharedEpisodes) }))
}

// Entity cards for /search: simple ILIKE on name/description, most-mentioned first.
export async function searchEntities(db: DB, query: string, limit = 5) {
  const term = `%${query}%`
  return db
    .select({
      id: entities.id,
      name: entities.name,
      slug: entities.slug,
      type: entities.type,
      description: entities.description,
      imageUrl: entities.imageUrl,
      mentionCount,
    })
    .from(entities)
    .where(
      and(
        or(ilike(entities.name, term), ilike(entities.description, term)),
        // Hide orphans: entities whose mentions were all deleted shouldn't
        // surface in search.
        sql`(select count(*) from ${episodeEntities} ee where ee.entity_id = "entities"."id") > 0`,
      ),
    )
    .orderBy(desc(sql`mention_count`))
    .limit(limit)
}
