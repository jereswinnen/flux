import { conversationRepo } from "@/lib/db/conversations"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const conversation = await conversationRepo.create({ itemId: body?.itemId ?? null })
  return Response.json({ conversation }, { status: 201 })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const itemId = searchParams.get("itemId")
  const scope = searchParams.get("scope")
  if (!itemId && scope !== "library") {
    return Response.json({ error: "specify itemId or scope=library" }, { status: 400 })
  }
  const conversations = await conversationRepo.list(itemId ?? null)
  return Response.json({ conversations })
}
