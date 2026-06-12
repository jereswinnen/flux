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

  const itemId = body.item_id ?? body.episode_id
  if (typeof itemId !== "string" || itemId.length === 0) {
    return Response.json({ error: "missing episode_id" }, { status: 400 })
  }

  // Transcription itself failed inside Modal.
  if (body.error) {
    await itemRepo.updateStatus(itemId, "failed", String(body.error))
    return Response.json({ status: "recorded" }, { status: 202 })
  }

  // Backfill placeholder item metadata when provided (e.g. from YouTube job).
  if (body.metadata !== null && typeof body.metadata === "object") {
    const m = body.metadata as Record<string, unknown>
    const mapped: Parameters<typeof itemRepo.updateMeta>[1] = {}
    if (typeof m.title === "string") mapped.title = m.title
    const podcastName = m.channelName ?? m.podcastName
    if (typeof podcastName === "string") mapped.podcastName = podcastName
    const artworkUrl = m.thumbnailUrl ?? m.artworkUrl
    if (typeof artworkUrl === "string") mapped.artworkUrl = artworkUrl
    if (typeof m.durationSec === "number") mapped.durationSec = m.durationSec
    if (m.publishedAt != null) mapped.publishedAt = new Date(m.publishedAt as string)
    await itemRepo.updateMeta(itemId, mapped)
  }

  // Run the rest of the pipeline without blocking the webhook response.
  processContent(
    { itemId, transcript: body.transcript, segments: body.segments ?? [] },
    { db },
  ).catch(() => {})

  return Response.json({ status: "accepted" }, { status: 202 })
}
