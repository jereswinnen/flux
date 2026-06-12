import type { NewItem } from "@/lib/db/items"
import { podcastAdapter } from "./podcast"
import type { SourceAdapter } from "./types"
import { youtubeAdapter } from "./youtube"

// URL-based adapters checked in order by detect().
const URL_ADAPTERS: SourceAdapter[] = [youtubeAdapter]
const BY_TYPE: Record<NewItem["type"], SourceAdapter> = {
  podcast: podcastAdapter,
  youtube: youtubeAdapter,
  article: youtubeAdapter, // placeholder; never invoked in Phase 2
}

/** Find the URL-based adapter for a raw input, or null. */
export function detectAdapter(input: string): SourceAdapter | null {
  return URL_ADAPTERS.find((a) => a.detect(input)) ?? null
}

export function getAdapter(type: NewItem["type"]): SourceAdapter {
  return BY_TYPE[type]
}
