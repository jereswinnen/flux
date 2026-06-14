import type { ItemType } from "@/lib/db/schema"
import type { HighlightRow } from "@/lib/db/highlights"
import { highlightJumpHref, type HighlightKind, type HighlightLocator } from "@/lib/highlights/locator"

export interface HighlightDTO {
  id: string
  kind: string
  text: string
  note: string | null
  createdAt: string
  updatedAt: string
  item: { id: string; type: ItemType; title: string; source: string | null; artworkUrl: string | null }
  jumpHref: string
  // Position metadata (e.g. charStart/charEnd for article highlights); null when unanchored.
  locator: HighlightLocator | null
}

export function highlightToDTO(row: HighlightRow): HighlightDTO {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    item: row.item,
    jumpHref: highlightJumpHref(row.item.id, row.kind as HighlightKind, row.locator),
    locator: row.locator ?? null,
  }
}
