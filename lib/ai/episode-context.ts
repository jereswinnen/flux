import { formatTimestamp } from "@/lib/format"

type Segment = { start: number; end: number; text: string }

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function buildTranscriptContext(segments: Segment[]): string {
  return segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`).join("\n")
}

export const MAX_TRANSCRIPT_TOKENS = 60_000
