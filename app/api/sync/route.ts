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
  const nowRows = await db.execute(sql<{ now: Date }>`select now()`)
  const nowList = Array.isArray(nowRows) ? nowRows : ((nowRows as { rows?: unknown[] }).rows ?? [])
  const syncedAt = (nowList[0] as { now: Date } | undefined)?.now ?? new Date()
  const [items, highlights, dels] = await Promise.all([
    itemRepo.listUpdatedSince(since),
    highlightRepo.listUpdatedSince(since),
    deletionsSince(db, since),
  ])
  return Response.json({
    items: items.map(itemToDTO),
    highlights: highlights.map(highlightToDTO),
    deletions: dels.map((d) => ({ type: d.type, id: d.entityId })),
    syncedAt: syncedAt.toISOString(),
  })
}
