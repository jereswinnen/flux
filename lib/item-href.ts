/** Link to an episode/item, deep-linking to a timestamp only when one exists.
 *  Articles (and any zero-timestamp hit) get the bare item URL. */
export function itemHref(itemId: string, startSec?: number): string {
  if (typeof startSec === "number" && startSec > 0) {
    return `/episodes/${itemId}?t=${Math.floor(startSec)}`
  }
  return `/episodes/${itemId}`
}
