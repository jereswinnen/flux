import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { episodeRepo } from "@/lib/db/episodes"
import { transcripts } from "@/lib/db/schema"
import { triggerTranscription } from "@/lib/modal/client"
import { processTranscript } from "@/lib/pipeline/process-transcript"

export async function POST(
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

  if (transcript) {
    // Transcript already exists; resume from analysis (processTranscript is idempotent).
    await episodeRepo.updateStatus(id, "analyzing")
    processTranscript(
      { episodeId: id, transcript: transcript.fullText, segments: transcript.segments ?? [] },
      { db },
    ).catch(() => {})
  } else {
    // Re-run from transcription.
    await episodeRepo.updateStatus(id, "processing")
    triggerTranscription(id, episode.audioUrl)
      .then(() => episodeRepo.updateStatus(id, "transcribing"))
      .catch((e) => episodeRepo.updateStatus(id, "failed", String(e?.message ?? e)))
  }

  return Response.json({ status: "retrying" }, { status: 202 })
}
