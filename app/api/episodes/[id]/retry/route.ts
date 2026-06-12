import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { itemRepo } from "@/lib/db/items"
import { transcripts } from "@/lib/db/schema"
import { triggerTranscription } from "@/lib/modal/client"
import { processContent } from "@/lib/pipeline/process-content"

export async function POST(
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

  if (transcript) {
    // Transcript already exists; resume from analysis (processContent is idempotent).
    await itemRepo.updateStatus(id, "analyzing")
    processContent(
      { itemId: id, transcript: transcript.fullText, segments: transcript.segments ?? [] },
      { db },
    ).catch(() => {})
  } else {
    // Re-run from transcription.
    await itemRepo.updateStatus(id, "processing")
    if (item.audioUrl) {
      triggerTranscription(id, item.audioUrl)
        .then(() => itemRepo.updateStatus(id, "transcribing"))
        .catch((e) => itemRepo.updateStatus(id, "failed", String(e?.message ?? e)))
    } else {
      // No audio source to transcribe — don't leave the item stuck in "processing".
      await itemRepo.updateStatus(id, "failed", "No audio URL to transcribe")
    }
  }

  return Response.json({ status: "retrying" }, { status: 202 })
}
