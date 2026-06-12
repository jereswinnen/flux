import type { InferSelectModel } from "drizzle-orm"
import type { items, ItemStatus, ItemType } from "@/lib/db/schema"

export type ItemRow = InferSelectModel<typeof items>

export interface ItemDTO {
  id: string
  type: ItemType
  title: string
  source: string | null // show / channel / author (podcastName today)
  audioUrl: string | null
  sourceUrl: string | null
  artworkUrl: string | null
  durationSec: number | null
  publishedAt: string | null // ISO 8601
  status: ItemStatus
  videoId: string | null // youtube only, from sourceMetadata
}

export function itemToDTO(row: ItemRow): ItemDTO {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    source: row.podcastName ?? null,
    audioUrl: row.audioUrl ?? null,
    sourceUrl: row.sourceUrl ?? null,
    artworkUrl: row.artworkUrl ?? null,
    durationSec: row.durationSec ?? null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    status: row.status,
    videoId: row.sourceMetadata?.videoId ?? null,
  }
}
