export type SourceKind = "item" | "highlight" | "web"

export interface SourceInput {
  itemId: string
  itemTitle: string
  startSec: number
  podcastName?: string | null
  artworkUrl?: string | null
  audioUrl?: string | null
  videoId?: string | null
  url?: string | null
  snippet?: string | null
  content?: string | null
  isHighlight?: boolean
  isWeb?: boolean
}

export interface SourceDTO extends SourceInput {
  kind: SourceKind
  source: string | null
}

/** Additive: keeps every input field, adds a `kind` discriminator + `source` alias. */
export function toSourceDTO(s: SourceInput): SourceDTO {
  const kind: SourceKind = s.isWeb ? "web" : s.isHighlight ? "highlight" : "item"
  return { ...s, kind, source: s.podcastName ?? null }
}
