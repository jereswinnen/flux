export interface TimedSegment {
  start: number
  end: number
  text: string
}

/**
 * Index of the segment "active" at `currentSec`: the last segment whose `start`
 * is <= currentSec (binary search). Returns -1 before the first segment or for an
 * empty list. Robust to gaps (a time in a gap belongs to the preceding segment)
 * and clamps to the last segment past the end.
 */
export function findActiveSegmentIndex(segments: TimedSegment[], currentSec: number): number {
  const n = segments.length
  if (n === 0 || currentSec < segments[0].start) return -1
  let lo = 0
  let hi = n - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segments[mid].start <= currentSec) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
