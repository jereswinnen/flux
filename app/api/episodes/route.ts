import { itemRepo } from "@/lib/db/items"
import { triggerTranscription } from "@/lib/modal/client"

export async function GET() {
  const list = await itemRepo.list()
  return Response.json({ episodes: list })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.title || !body?.audioUrl) {
    return Response.json({ error: "title and audioUrl are required" }, { status: 400 })
  }

  const sourceMetadata = {
    guid: body.episodeGuid,
    itunesCollectionId: body.itunesCollectionId,
    itunesTrackId: body.itunesTrackId,
  }
  const hasMeta = Object.values(sourceMetadata).some((v) => v !== undefined && v !== null)

  const item = await itemRepo.create({
    type: "podcast",
    title: body.title,
    audioUrl: body.audioUrl,
    podcastName: body.podcastName,
    sourceUrl: body.sourceUrl,
    artworkUrl: body.artworkUrl,
    publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined,
    durationSec: body.durationSec,
    sourceMetadata: hasMeta ? sourceMetadata : undefined,
  })

  if (item.status === "processing" && item.audioUrl) {
    triggerTranscription(item.id, item.audioUrl)
      .then(() => itemRepo.updateStatus(item.id, "transcribing"))
      .catch((e) => itemRepo.updateStatus(item.id, "failed", String(e?.message ?? e)))
  }

  return Response.json({ episode: item }, { status: 201 })
}
