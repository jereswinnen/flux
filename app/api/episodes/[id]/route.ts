import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { itemRepo } from "@/lib/db/items"
import { insights, transcripts } from "@/lib/db/schema"
import { itemToDTO } from "@/lib/api/dto"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const item = await itemRepo.getById(id)
  if (!item) return Response.json({ error: "not found" }, { status: 404 })

  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.itemId, id))
    .limit(1)
  const [insight] = await db
    .select()
    .from(insights)
    .where(eq(insights.itemId, id))
    .limit(1)

  return Response.json({ item: itemToDTO(item), transcript: transcript ?? null, insights: insight ?? null })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await itemRepo.remove(id)
  return Response.json({ status: "deleted" })
}
