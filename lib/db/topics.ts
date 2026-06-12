import { desc, eq, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { insights, items } from "./schema"
import * as schema from "./schema"

// Episodes whose insights list `name` as a topic, or mention it as a named entity.
export async function episodesMentioning(
  db: PostgresJsDatabase<typeof schema>,
  name: string,
) {
  return db
    .select({
      id: items.id,
      title: items.title,
      podcastName: items.podcastName,
      artworkUrl: items.artworkUrl,
      status: items.status,
      publishedAt: items.publishedAt,
      createdAt: items.createdAt,
    })
    .from(items)
    .innerJoin(insights, eq(insights.itemId, items.id))
    .where(
      sql`jsonb_exists(${insights.topics}, ${name})
          or exists (
            select 1 from jsonb_array_elements(${insights.entities}) as e
            where e->>'name' = ${name}
          )`,
    )
    .orderBy(desc(items.createdAt))
}
