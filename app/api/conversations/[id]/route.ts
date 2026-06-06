import { conversationRepo } from "@/lib/db/conversations"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await conversationRepo.get(id)
  if (!data) return Response.json({ error: "not found" }, { status: 404 })
  return Response.json(data)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await conversationRepo.remove(id)
  return Response.json({ status: "deleted" })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  const title = typeof body?.title === "string" ? body.title.trim() : ""
  if (!title) return Response.json({ error: "title is required" }, { status: 400 })
  await conversationRepo.rename(id, title)
  return Response.json({ status: "renamed" })
}
