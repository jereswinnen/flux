import { and, desc, eq, ilike, or, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { entities, itemEntities, items } from "./schema"
import * as schema from "./schema"

type DB = PostgresJsDatabase<typeof schema>

// Correlation is hard-qualified ("entities"."id") because drizzle renders
// single-table selects with unqualified columns, which would otherwise rely on
// episode_entities never gaining an `id` column. count(*) comes back from
// postgres-js as a bigint string, hence mapWith(Number).
const mentionCount = sql`(
  select count(*) from ${itemEntities} ee where ee.entity_id = "entities"."id"
)`
  .mapWith(Number)
  .as("mention_count")

export async function getEntityBySlug(db: DB, slug: string) {
  const rows = await db.select().from(entities).where(eq(entities.slug, slug)).limit(1)
  return rows[0] ?? null
}

// Entities mentioned in one episode, with this episode's mention context and
// the library-wide mention count (for the hover card).
export async function entitiesForEpisode(db: DB, itemId: string) {
  return db
    .select({
      id: entities.id,
      name: entities.name,
      slug: entities.slug,
      type: entities.type,
      description: entities.description,
      imageUrl: entities.imageUrl,
      metadata: entities.metadata,
      context: itemEntities.context,
      approxTimestampSec: itemEntities.approxTimestampSec,
      mentionCount,
    })
    .from(itemEntities)
    .innerJoin(entities, eq(entities.id, itemEntities.entityId))
    .where(eq(itemEntities.itemId, itemId))
    .orderBy(entities.name)
}

// Episodes mentioning an entity, each with its own context line and timestamp.
export async function episodesMentioningEntity(db: DB, entityId: string) {
  return db
    .select({
      id: items.id,
      title: items.title,
      podcastName: items.podcastName,
      artworkUrl: items.artworkUrl,
      publishedAt: items.publishedAt,
      createdAt: items.createdAt,
      context: itemEntities.context,
      approxTimestampSec: itemEntities.approxTimestampSec,
    })
    .from(itemEntities)
    .innerJoin(items, eq(items.id, itemEntities.itemId))
    .where(eq(itemEntities.entityId, entityId))
    .orderBy(desc(items.createdAt))
}

// "Often mentioned with": entities sharing episodes with this one, by count.
// Raw SQL: drizzle's builder can't alias a self-join on episode_entities cleanly.
export async function coMentionedEntities(db: DB, entityId: string, limit = 8) {
  const result = await db.execute(sql`
    select e.id, e.name, e.slug, e.type, e.image_url as "imageUrl",
           count(*) as "sharedEpisodes"
    from item_entities ee
    join item_entities co on co.item_id = ee.item_id and co.entity_id <> ee.entity_id
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
        sql`(select count(*) from ${itemEntities} ee where ee.entity_id = "entities"."id") > 0`,
      ),
    )
    .orderBy(desc(sql`mention_count`))
    .limit(limit)
}
