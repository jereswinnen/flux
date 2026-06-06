import { config } from "dotenv"
config({ path: ".env.local" })

// Route handlers use DATABASE_URL via lib/db/index.ts.
// Point them at the test DB so they share the same transactions as the test repo.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}
