export const HIGHLIGHT_KINDS = ["transcript", "takeaway", "quote", "article", "kindle"] as const
export type HighlightKind = (typeof HIGHLIGHT_KINDS)[number]

export type HighlightLocator = {
  sec?: number
  segmentStart?: number
  index?: number
  charStart?: number
  charEnd?: number
  location?: string
}

function num(v: string | undefined): number | undefined {
  if (v == null || v === "") return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Build a locator from a highlightable element's data attributes, per kind. */
export function buildLocator(
  kind: HighlightKind,
  data: Record<string, string | undefined>,
): HighlightLocator {
  switch (kind) {
    case "transcript":
      return strip({ sec: num(data.hlSec) })
    case "quote":
      return strip({ index: num(data.hlIndex), sec: num(data.hlSec) })
    case "takeaway":
      return strip({ index: num(data.hlIndex) })
    default:
      return {}
  }
}

function strip(o: HighlightLocator): HighlightLocator {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
}

/** Where clicking a highlight navigates — the read-side per-kind seam. */
export function highlightJumpHref(
  itemId: string,
  kind: HighlightKind,
  locator: HighlightLocator | null,
): string {
  const sec = locator?.sec
  if ((kind === "transcript" || kind === "quote") && typeof sec === "number" && sec > 0) {
    return `/items/${itemId}?t=${Math.floor(sec)}`
  }
  return `/items/${itemId}`
}
