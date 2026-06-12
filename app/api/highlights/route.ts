import { highlightRepo } from "@/lib/db/highlights"
import { highlightToDTO } from "@/lib/api/highlight-dto"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const type = url.searchParams.get("type") ?? undefined
  const q = url.searchParams.get("q") ?? undefined
  const rows = await highlightRepo.list({ type, q })
  return Response.json({ highlights: rows.map(highlightToDTO) })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const text = typeof body?.text === "string" ? body.text.trim() : ""
  if (!body?.itemId || !body?.kind || !text) {
    return Response.json({ error: "itemId, kind and text are required" }, { status: 400 })
  }
  const row = await highlightRepo.create({
    itemId: body.itemId,
    kind: body.kind,
    text,
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined,
    locator: body.locator ?? undefined,
  })
  return Response.json({ highlight: row }, { status: 201 })
}
