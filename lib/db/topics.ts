import { desc, eq, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { insights, items } from "./schema"
import * as schema from "./schema"

// Items whose insights list `name` as a topic, or mention it as a named entity.
export async function itemsMentioning(
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
