import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import * as schema from "@/lib/db/schema"
import { makeItemRepo } from "@/lib/db/items"
import { processContent } from "@/lib/pipeline/process-content"

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
const db = drizzle(client, { schema })
const items = makeItemRepo(db)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
beforeEach(async () => {
  await db.delete(schema.transcripts)
  await db.delete(schema.items)
})
afterAll(async () => {
  await client.end()
})

test("persists content_html and marks the item ready", async () => {
  const item = await items.create({ type: "article", title: "A", sourceUrl: "https://x/y" })
  await processContent(
    {
      itemId: item.id,
      transcript: "hello world body text",
      segments: [{ start: 0, end: 0, text: "hello world body text" }],
      contentHtml: "<p>hello world</p>",
    },
    {
      db,
      generateInsights: async () => ({
        summary: "s", takeaways: [], topics: [], chapters: [], quotes: [], entities: [],
      }),
      embedTexts: async (texts) => texts.map(() => Array(1536).fill(0)),
      resolveEntities: async () => {},
    },
  )
  const [t] = await db.select().from(schema.transcripts).where(eq(schema.transcripts.itemId, item.id))
  expect(t.contentHtml).toBe("<p>hello world</p>")
  const after = await items.getById(item.id)
  expect(after?.status).toBe("ready")
}, 30_000)

test("re-processing replaces the transcript row, not duplicates it", async () => {
  const item = await items.create({ type: "article", title: "A", sourceUrl: "https://x/y" })
  const run = (html: string) =>
    processContent(
      { itemId: item.id, transcript: "body", segments: [{ start: 0, end: 0, text: "body" }], contentHtml: html },
      {
        db,
        generateInsights: async () => ({ summary: "s", takeaways: [], topics: [], chapters: [], quotes: [], entities: [] }),
        embedTexts: async (t) => t.map(() => Array(1536).fill(0)),
        resolveEntities: async () => {},
      },
    )
  await run("<p>one</p>")
  await run("<p>two</p>")
  const rows = await db.select().from(schema.transcripts).where(eq(schema.transcripts.itemId, item.id))
  expect(rows).toHaveLength(1)
  expect(rows[0].contentHtml).toBe("<p>two</p>")
}, 30_000)
