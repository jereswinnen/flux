import type { NewItem } from "@/lib/db/items"
import { podcastAdapter } from "./podcast"
import type { SourceAdapter } from "./types"
import { youtubeAdapter } from "./youtube"

// URL-based adapters checked in order by detect().
const URL_ADAPTERS: SourceAdapter[] = [youtubeAdapter]
// Only implemented types are registered; `getAdapter` throws for the rest so an
// unimplemented source (e.g. "article") fails loudly instead of silently
// proxying to the wrong adapter.
const BY_TYPE: Partial<Record<NewItem["type"], SourceAdapter>> = {
  podcast: podcastAdapter,
  youtube: youtubeAdapter,
}

/** Find the URL-based adapter for a raw input, or null. */
export function detectAdapter(input: string): SourceAdapter | null {
  return URL_ADAPTERS.find((a) => a.detect(input)) ?? null
}

export function getAdapter(type: NewItem["type"]): SourceAdapter {
  const adapter = BY_TYPE[type]
  if (!adapter) throw new Error(`no source adapter for type: ${type}`)
  return adapter
}
