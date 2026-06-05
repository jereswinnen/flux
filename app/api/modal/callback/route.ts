import { db } from "@/lib/db"
import { episodeRepo } from "@/lib/db/episodes"
import { processTranscript } from "@/lib/pipeline/process-transcript"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || body.secret !== process.env.MODAL_WEBHOOK_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const episodeId = body.episode_id as string

  // Transcription itself failed inside Modal.
  if (body.error) {
    await episodeRepo.updateStatus(episodeId, "failed", String(body.error))
    return Response.json({ status: "recorded" }, { status: 202 })
  }

  // Run the rest of the pipeline without blocking the webhook response.
  processTranscript(
    { episodeId, transcript: body.transcript, segments: body.segments ?? [] },
    { db },
  ).catch(() => {
    // processTranscript already records the failure status.
  })

  return Response.json({ status: "accepted" }, { status: 202 })
}
