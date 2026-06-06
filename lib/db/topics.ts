import { desc, eq, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { episodes, insights } from "./schema"
import * as schema from "./schema"

// Episodes whose insights list `name` as a topic, or mention it as a named entity.
export async function episodesMentioning(
  db: PostgresJsDatabase<typeof schema>,
  name: string,
) {
  return db
    .select({
      id: episodes.id,
      title: episodes.title,
      podcastName: episodes.podcastName,
      artworkUrl: episodes.artworkUrl,
      status: episodes.status,
      publishedAt: episodes.publishedAt,
      createdAt: episodes.createdAt,
    })
    .from(episodes)
    .innerJoin(insights, eq(insights.episodeId, episodes.id))
    .where(
      sql`jsonb_exists(${insights.topics}, ${name})
          or exists (
            select 1 from jsonb_array_elements(${insights.entities}) as e
            where e->>'name' = ${name}
          )`,
    )
    .orderBy(desc(episodes.createdAt))
}
