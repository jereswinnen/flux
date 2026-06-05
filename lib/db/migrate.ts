import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  const client = postgres(url, { max: 1 })
  await migrate(drizzle(client), { migrationsFolder: "./lib/db/migrations" })
  await client.end()
  console.log("migrations applied")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
