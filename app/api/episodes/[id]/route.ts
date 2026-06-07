import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { episodeRepo } from "@/lib/db/episodes"
import { insights, transcripts } from "@/lib/db/schema"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const episode = await episodeRepo.getById(id)
  if (!episode) return Response.json({ error: "not found" }, { status: 404 })

  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.episodeId, id))
    .limit(1)
  const [insight] = await db
    .select()
    .from(insights)
    .where(eq(insights.episodeId, id))
    .limit(1)

  return Response.json({ episode, transcript: transcript ?? null, insights: insight ?? null })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await episodeRepo.remove(id)
  return Response.json({ status: "deleted" })
}
