import crypto from "node:crypto"
import { db } from "@/lib/db"
import { itemRepo } from "@/lib/db/items"
import { processContent } from "@/lib/pipeline/process-content"

function secretValid(provided: unknown): boolean {
  const expected = process.env.MODAL_WEBHOOK_SECRET
  if (!expected) return false // fail closed if not configured
  if (typeof provided !== "string" || provided.length === 0) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || !secretValid(body.secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const itemId = body.episode_id
  if (typeof itemId !== "string" || itemId.length === 0) {
    return Response.json({ error: "missing episode_id" }, { status: 400 })
  }

  // Transcription itself failed inside Modal.
  if (body.error) {
    await itemRepo.updateStatus(itemId, "failed", String(body.error))
    return Response.json({ status: "recorded" }, { status: 202 })
  }

  // Run the rest of the pipeline without blocking the webhook response.
  processContent(
    { itemId, transcript: body.transcript, segments: body.segments ?? [] },
    { db },
  ).catch(() => {})

  return Response.json({ status: "accepted" }, { status: 202 })
}
