import { itemToDTO } from "@/lib/api/dto"
import { itemRepo } from "@/lib/db/items"
import { podcastInputToNewItem, type PodcastInput } from "@/lib/sources/podcast"
import { detectAdapter, getAdapter } from "@/lib/sources/registry"
import type { SourceAdapter } from "@/lib/sources/types"
import type { ItemRow } from "@/lib/api/dto"

export async function GET() {
  const list = await itemRepo.list()
  return Response.json({ items: list.map(itemToDTO) })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) return Response.json({ error: "invalid body" }, { status: 400 })

  // Explicit podcast payload (iTunes-driven UI) vs. URL-based source (youtube).
  if (body.type === "podcast" || (body.audioUrl && !body.url)) {
    if (!body.title || !body.audioUrl) {
      return Response.json({ error: "title and audioUrl required" }, { status: 400 })
    }
    const item = await itemRepo.create(podcastInputToNewItem(body as PodcastInput))
    fireProcessing(getAdapter("podcast"), item)
    return Response.json({ item: itemToDTO(item) }, { status: 201 })
  }

  const url: unknown = body.url
  if (typeof url !== "string" || !url) {
    return Response.json({ error: "url required" }, { status: 400 })
  }
  const adapter = detectAdapter(url)
  if (!adapter) {
    return Response.json({ error: "unrecognized source URL" }, { status: 400 })
  }
  const item = await itemRepo.create(await adapter.resolve(url))
  fireProcessing(adapter, item)
  return Response.json({ item: itemToDTO(item) }, { status: 201 })
}

// Fire-and-forget; record failure without blocking the response.
function fireProcessing(adapter: SourceAdapter, item: ItemRow) {
  if (item.status !== "processing") return
  adapter
    .startProcessing(item)
    .then(() => itemRepo.updateStatus(item.id, "transcribing"))
    .catch((e: unknown) =>
      itemRepo.updateStatus(item.id, "failed", e instanceof Error ? e.message : String(e)),
    )
    .catch(() => {}) // never let a failure-path DB write surface as an unhandled rejection
}
