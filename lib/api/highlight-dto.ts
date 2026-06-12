import type { ItemType } from "@/lib/db/schema"
import type { HighlightRow } from "@/lib/db/highlights"
import { highlightJumpHref, type HighlightKind } from "@/lib/highlights/locator"

export interface HighlightDTO {
  id: string
  kind: string
  text: string
  note: string | null
  createdAt: string
  item: { id: string; type: ItemType; title: string; source: string | null; artworkUrl: string | null }
  jumpHref: string
}

export function highlightToDTO(row: HighlightRow): HighlightDTO {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    item: row.item,
    jumpHref: highlightJumpHref(row.item.id, row.kind as HighlightKind, row.locator),
  }
}
