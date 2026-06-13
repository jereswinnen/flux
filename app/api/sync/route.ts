import { sql } from "drizzle-orm"
import { itemRepo } from "@/lib/db/items"
import { highlightRepo } from "@/lib/db/highlights"
import { deletionsSince } from "@/lib/db/deletions"
import { db } from "@/lib/db"
import { itemToDTO } from "@/lib/api/dto"
import { highlightToDTO } from "@/lib/api/highlight-dto"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const sinceParam = url.searchParams.get("since")
  const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(sinceParam) : new Date(0)
  // Cursor must come from the DB clock (the same clock the BEFORE UPDATE trigger
  // stamps `updated_at` with) — using the app clock risks skew that permanently
  // drops changes. Captured before the reads, so a write landing mid-request is
  // re-sent next pull (a harmless duplicate) rather than missed.
  // Strict ISO-8601 (UTC, millisecond precision) straight from Postgres — `db.execute`
  // returns timestamps as raw strings, so format it in SQL to match every other date
  // field (JS `.toISOString()`) and give the client one consistent shape to decode.
  const nowRows = await db.execute(
    sql`select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now`,
  )
  const nowList = Array.isArray(nowRows) ? nowRows : ((nowRows as { rows?: unknown[] }).rows ?? [])
  const syncedAt = (nowList[0] as { now?: string } | undefined)?.now ?? new Date().toISOString()
  const [items, highlights, dels] = await Promise.all([
    itemRepo.listUpdatedSince(since),
    highlightRepo.listUpdatedSince(since),
    deletionsSince(db, since),
  ])
  return Response.json({
    items: items.map(itemToDTO),
    highlights: highlights.map(highlightToDTO),
    deletions: dels.map((d) => ({ type: d.type, id: d.entityId })),
    syncedAt,
  })
}
