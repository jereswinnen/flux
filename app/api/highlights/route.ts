import { highlightRepo } from "@/lib/db/highlights"
import { highlightToDTO } from "@/lib/api/highlight-dto"
import { HIGHLIGHT_KINDS } from "@/lib/highlights/locator"
import { embedQuery } from "@/lib/ai/embeddings"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const type = url.searchParams.get("type") ?? undefined
  const q = url.searchParams.get("q") ?? undefined
  const itemId = url.searchParams.get("itemId") ?? undefined
  const rows = await highlightRepo.list({ type, q, itemId })
  return Response.json({ highlights: rows.map(highlightToDTO) })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const text = typeof body?.text === "string" ? body.text.trim() : ""
  if (!body?.itemId || !body?.kind || !text) {
    return Response.json({ error: "itemId, kind and text are required" }, { status: 400 })
  }
  if (!HIGHLIGHT_KINDS.includes(body.kind)) {
    return Response.json({ error: "invalid kind" }, { status: 400 })
  }
  let embedding: number[] | undefined
  try {
    embedding = await embedQuery(text)
  } catch (e) {
    console.error("highlight embedding failed", e)
  }
  const row = await highlightRepo.create({
    itemId: body.itemId,
    kind: body.kind,
    text,
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined,
    locator: body.locator ?? undefined,
    embedding,
  })
  return Response.json({ highlight: row }, { status: 201 })
}
