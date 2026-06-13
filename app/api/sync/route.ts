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
  const syncedAt = new Date()
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
