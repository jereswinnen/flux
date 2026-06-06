import { conversationRepo } from "@/lib/db/conversations"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const conversation = await conversationRepo.create({ episodeId: body?.episodeId ?? null })
  return Response.json({ conversation }, { status: 201 })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const episodeId = searchParams.get("episodeId")
  const scope = searchParams.get("scope")
  if (!episodeId && scope !== "library") {
    return Response.json({ error: "specify episodeId or scope=library" }, { status: 400 })
  }
  const conversations = await conversationRepo.list(episodeId ?? null)
  return Response.json({ conversations })
}
