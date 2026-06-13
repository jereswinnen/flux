import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { itemRepo } from "@/lib/db/items"
import { transcripts } from "@/lib/db/schema"
import { getAdapter } from "@/lib/sources/registry"
import { processContent } from "@/lib/pipeline/process-content"

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await itemRepo.getById(id)
  if (!item) return Response.json({ error: "not found" }, { status: 404 })

  const [transcript] = await db.select().from(transcripts).where(eq(transcripts.itemId, id)).limit(1)

  if (transcript) {
    await itemRepo.updateStatus(id, "analyzing")
    processContent(
      { itemId: id, transcript: transcript.fullText, segments: transcript.segments ?? [], contentHtml: transcript.contentHtml ?? undefined },
      { db },
    ).catch(() => {})
  } else {
    await itemRepo.updateStatus(id, "processing")
    getAdapter(item.type)
      .startProcessing(item)
      .then(async () => {
        const cur = await itemRepo.getById(id)
        if (cur?.status === "processing") await itemRepo.updateStatus(id, "transcribing")
      })
      .catch((e: unknown) =>
        itemRepo.updateStatus(id, "failed", e instanceof Error ? e.message : String(e)),
      )
      .catch(() => {})
  }
  return Response.json({ status: "retrying" }, { status: 202 })
}
