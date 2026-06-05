export interface Segment {
  start: number
  end: number
  text: string
}

export interface Chunk {
  content: string
  startSec: number
  endSec: number
}

export interface ChunkOptions {
  targetTokens: number
  overlapSegments: number
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function chunkSegments(segments: Segment[], opts: ChunkOptions): Chunk[] {
  if (segments.length === 0) return []
  const chunks: Chunk[] = []
  let i = 0

  while (i < segments.length) {
    let tokens = 0
    let j = i
    while (j < segments.length) {
      const t = estimateTokens(segments[j].text)
      if (j > i && tokens + t > opts.targetTokens) break
      tokens += t
      j++
    }
    const group = segments.slice(i, j)
    chunks.push({
      content: group.map((s) => s.text).join(" ").trim(),
      startSec: Math.floor(group[0].start),
      endSec: Math.ceil(group[group.length - 1].end),
    })
    if (j >= segments.length) break
    i = Math.max(j - opts.overlapSegments, i + 1)
  }

  return chunks
}
