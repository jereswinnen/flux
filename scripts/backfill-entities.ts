// One-off backfill: run every existing episode's extracted entities through the
// resolver. Idempotent — episodes that already have entity links are skipped,
// so it can be re-run safely after a partial failure.
//
// Usage: npx tsx scripts/backfill-entities.ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "@/lib/db/schema"
import { resolveEpisodeEntities } from "@/lib/entities/resolve"

async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 })
  const db = drizzle(client, { schema })

  const rows = await db
    .select({
      episodeId: schema.insights.episodeId,
      entities: schema.insights.entities,
      title: schema.episodes.title,
    })
    .from(schema.insights)
    .innerJoin(schema.episodes, eq(schema.episodes.id, schema.insights.episodeId))

  let done = 0
  for (const row of rows) {
    const extracted = row.entities ?? []
    const [existing] = await db
      .select({ episodeId: schema.episodeEntities.episodeId })
      .from(schema.episodeEntities)
      .where(eq(schema.episodeEntities.episodeId, row.episodeId))
      .limit(1)
    if (existing || extracted.length === 0) {
      console.log(`skip  ${row.title}`)
      continue
    }
    // Old insights rows predate per-entity context; the verifier falls back to
    // the episode title. One bad episode shouldn't abandon the rest of the queue.
    try {
      await resolveEpisodeEntities(row.episodeId, extracted, { db }, { episodeTitle: row.title })
      done++
      console.log(`done  ${row.title} (${extracted.length} entities)`)
    } catch (e) {
      console.error(`error ${row.title}`, e)
    }
  }

  console.log(`backfilled ${done}/${rows.length} episodes`)
  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
