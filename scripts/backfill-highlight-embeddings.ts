import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { eq, isNull } from "drizzle-orm"
import postgres from "postgres"
import * as schema from "../lib/db/schema"
import { embedTexts } from "../lib/ai/embeddings"

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  const client = postgres(url, { max: 1 })
  const db = drizzle(client, { schema })

  const rows = await db
    .select({ id: schema.highlights.id, text: schema.highlights.text })
    .from(schema.highlights)
    .where(isNull(schema.highlights.embedding))

  console.log(`backfilling ${rows.length} highlight(s)`)
  const BATCH = 50
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const vectors = await embedTexts(batch.map((r) => r.text))
    for (let j = 0; j < batch.length; j++) {
      await db.update(schema.highlights).set({ embedding: vectors[j] }).where(eq(schema.highlights.id, batch[j].id))
    }
    console.log(`  embedded ${Math.min(i + BATCH, rows.length)}/${rows.length}`)
  }

  await client.end()
  console.log("backfill complete")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
