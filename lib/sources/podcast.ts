import type { ItemRow } from "@/lib/api/dto"
import type { NewItem } from "@/lib/db/items"
import { triggerTranscription } from "@/lib/modal/client"
import type { SourceAdapter } from "./types"

export interface PodcastInput {
  title: string
  audioUrl: string
  podcastName?: string
  sourceUrl?: string
  artworkUrl?: string
  publishedAt?: string
  durationSec?: number
  episodeGuid?: string
  itunesCollectionId?: number
  itunesTrackId?: number
}

export function podcastInputToNewItem(input: PodcastInput): NewItem {
  const sourceMetadata = {
    guid: input.episodeGuid,
    itunesCollectionId: input.itunesCollectionId,
    itunesTrackId: input.itunesTrackId,
  }
  const hasMeta = Object.values(sourceMetadata).some((v) => v !== undefined && v !== null)
  return {
    type: "podcast",
    title: input.title,
    audioUrl: input.audioUrl,
    podcastName: input.podcastName,
    sourceUrl: input.sourceUrl,
    artworkUrl: input.artworkUrl,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
    durationSec: input.durationSec,
    sourceMetadata: hasMeta ? sourceMetadata : undefined,
  }
}

export const podcastAdapter: SourceAdapter = {
  type: "podcast",
  detect: () => false, // podcasts dispatch by explicit type, not URL sniffing
  async resolve() {
    throw new Error("podcastAdapter.resolve is unused; use podcastInputToNewItem")
  },
  async startProcessing(item: ItemRow) {
    if (item.audioUrl) await triggerTranscription(item.id, item.audioUrl)
  },
}
