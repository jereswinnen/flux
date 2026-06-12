import { highlightRepo } from "@/lib/db/highlights"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null
  await highlightRepo.updateNote(id, note)
  return Response.json({ status: "ok" })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await highlightRepo.remove(id)
  return Response.json({ status: "ok" })
}
