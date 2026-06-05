import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { afterAll, beforeAll, expect, test } from "vitest"
import { episodes } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

const url = process.env.TEST_DATABASE_URL!
const client = postgres(url, { max: 1 })
const db = drizzle(client)

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./lib/db/migrations" })
})
afterAll(async () => {
  await client.end()
})

test("can insert and read an episode", async () => {
  const [row] = await db
    .insert(episodes)
    .values({ title: "Test Ep", audioUrl: "https://example.com/a.mp3" })
    .returning()
  expect(row.status).toBe("processing")
  const found = await db.select().from(episodes).where(eq(episodes.id, row.id))
  expect(found[0].title).toBe("Test Ep")
  await db.delete(episodes).where(eq(episodes.id, row.id))
})
