import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { itemRepo } from "@/lib/db/items"
import { highlightRepo } from "@/lib/db/highlights"
import { entitiesForEpisode as entitiesForItem } from "@/lib/db/entities"
import { insights as insightsTable, transcripts as transcriptsTable } from "@/lib/db/schema"
import { itemToDTO } from "@/lib/api/dto"
import { highlightToDTO } from "@/lib/api/highlight-dto"

const READ_STATES = ["unread", "read", "archived"] as const

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await itemRepo.getById(id)
  if (!item) return Response.json({ error: "not found" }, { status: 404 })
  const [transcript] = await db.select().from(transcriptsTable).where(eq(transcriptsTable.itemId, id)).limit(1)
  const [insight] = await db.select().from(insightsTable).where(eq(insightsTable.itemId, id)).limit(1)
  const [entities, highlights] = await Promise.all([
    entitiesForItem(db, id),
    highlightRepo.list({ itemId: id }),
  ])
  return Response.json({
    item: itemToDTO(item),
    transcript: transcript ? { fullText: transcript.fullText, segments: transcript.segments ?? [], contentHtml: transcript.contentHtml ?? null } : null,
    insights: insight ?? null,
    entities,
    highlights: highlights.map(highlightToDTO),
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await itemRepo.getById(id)
  if (!item) return Response.json({ error: "not found" }, { status: 404 })
  await itemRepo.remove(id)
  return new Response(null, { status: 204 })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const readState = body?.readState
  if (!READ_STATES.includes(readState)) {
    return Response.json({ error: "invalid readState" }, { status: 400 })
  }
  const item = await itemRepo.getById(id)
  if (!item) return Response.json({ error: "not found" }, { status: 404 })
  await itemRepo.setReadState(id, readState)
  return Response.json({ item: itemToDTO({ ...item, readState }) })
}
