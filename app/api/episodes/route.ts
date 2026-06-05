import { episodeRepo } from "@/lib/db/episodes"
import { triggerTranscription } from "@/lib/modal/client"

export async function GET() {
  const list = await episodeRepo.list()
  return Response.json({ episodes: list })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.title || !body?.audioUrl) {
    return Response.json({ error: "title and audioUrl are required" }, { status: 400 })
  }

  const episode = await episodeRepo.create({
    title: body.title,
    audioUrl: body.audioUrl,
    podcastName: body.podcastName,
    sourceUrl: body.sourceUrl,
    artworkUrl: body.artworkUrl,
    episodeGuid: body.episodeGuid,
    publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined,
    durationSec: body.durationSec,
    itunesCollectionId: body.itunesCollectionId,
    itunesTrackId: body.itunesTrackId,
  })

  // Fire transcription async; don't block the response.
  if (episode.status === "processing") {
    triggerTranscription(episode.id, episode.audioUrl)
      .then(() => episodeRepo.updateStatus(episode.id, "transcribing"))
      .catch((e) =>
        episodeRepo.updateStatus(episode.id, "failed", String(e?.message ?? e)),
      )
  }

  return Response.json({ episode }, { status: 201 })
}
