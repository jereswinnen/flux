import type { ItemRow } from "@/lib/api/dto"
import type { NewItem } from "@/lib/db/items"
import { triggerYoutubeTranscription } from "@/lib/modal/client"
import type { SourceAdapter } from "./types"
import { parseYouTubeId, isYouTubeUrl } from "./youtube-url"

export const youtubeAdapter: SourceAdapter = {
  type: "youtube",
  detect: (input) => isYouTubeUrl(input),
  async resolve(input): Promise<NewItem> {
    const videoId = parseYouTubeId(input)
    if (!videoId) throw new Error("not a YouTube URL")
    return {
      type: "youtube",
      title: "YouTube video", // backfilled on callback (Phase 3)
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      sourceMetadata: { videoId },
    }
  },
  async startProcessing(item: ItemRow) {
    const videoId = item.sourceMetadata?.videoId
    if (!videoId) throw new Error("youtube item missing videoId")
    await triggerYoutubeTranscription(item.id, `https://www.youtube.com/watch?v=${videoId}`)
  },
}
