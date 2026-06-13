import type { InferSelectModel } from "drizzle-orm"
import type { items, ItemReadState, ItemStatus, ItemType } from "@/lib/db/schema"

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
  createdAt: string // ISO 8601 — when it was added to the library
  status: ItemStatus
  videoId: string | null // youtube only, from sourceMetadata
  readState: ItemReadState
  updatedAt: string
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
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    videoId: row.sourceMetadata?.videoId ?? null,
    readState: row.readState,
    updatedAt: row.updatedAt.toISOString(),
  }
}
