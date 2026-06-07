import { formatTimestamp } from "@/lib/format"

export type ExportEpisode = {
  title: string
  podcastName: string | null
  durationSec: number | null
  publishedAt: string | null
  sourceUrl?: string | null
}
export type ExportInsights = {
  summary?: string | null
  takeaways?: string[] | null
  topics?: string[] | null
  quotes?: { text: string; approxTimestampSec: number }[] | null
  entities?: { name: string; type: string }[] | null
} | null
export type ExportTranscript = { segments: { start: number; end: number; text: string }[] } | null

export function buildEpisodeMarkdown(
  episode: ExportEpisode,
  transcript: ExportTranscript,
  insights: ExportInsights,
): string {
  const lines: string[] = [`# ${episode.title}`]

  const meta = [
    episode.podcastName,
    episode.durationSec ? formatTimestamp(episode.durationSec) : null,
    episode.publishedAt ? new Date(episode.publishedAt).toLocaleDateString() : null,
  ].filter(Boolean)
  if (meta.length) lines.push(meta.join(" · "))
  if (episode.sourceUrl) lines.push(`Source: ${episode.sourceUrl}`)

  if (insights?.summary) lines.push("", "## Summary", insights.summary)
  if (insights?.takeaways?.length) lines.push("", "## Takeaways", ...insights.takeaways.map((t) => `- ${t}`))
  if (insights?.topics?.length) lines.push("", "## Topics", insights.topics.join(", "))
  if (insights?.quotes?.length)
    lines.push(
      "",
      "## Notable quotes",
      ...insights.quotes.map((q) => `> "${q.text}" — [${formatTimestamp(q.approxTimestampSec)}]`),
    )
  if (insights?.entities?.length)
    lines.push("", "## People & entities", insights.entities.map((e) => `${e.name} (${e.type})`).join(", "))
  if (transcript?.segments?.length)
    lines.push("", "## Transcript", ...transcript.segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`))

  return `${lines.join("\n")}\n`
}
