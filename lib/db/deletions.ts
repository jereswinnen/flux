import { gt } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { deletions } from "./schema"
import * as schema from "./schema"
import { db } from "./index"

type DB = PostgresJsDatabase<typeof schema>

export async function deletionsSince(dbConn: DB, since: Date) {
  return dbConn
    .select({
      type: deletions.type,
      entityId: deletions.entityId,
      deletedAt: deletions.deletedAt,
    })
    .from(deletions)
    .where(gt(deletions.deletedAt, since))
}

// Singleton for use in route handlers
export const deletionRepo = { since: (since: Date) => deletionsSince(db, since) }
