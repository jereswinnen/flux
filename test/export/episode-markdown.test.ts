import { expect, test } from "vitest"
import { buildEpisodeMarkdown } from "@/lib/export/episode-markdown"
import { slugify } from "@/lib/export/slug"

const episode = {
  title: "#415 How Elon Thinks",
  podcastName: "Founders",
  durationSec: 3085,
  publishedAt: "2026-02-01T00:00:00Z",
  sourceUrl: "https://example.com/feed.xml",
}
const insights = {
  summary: "A talk about first principles.",
  takeaways: ["Think from first principles", "Move fast"],
  topics: ["First principles", "Manufacturing"],
  quotes: [{ text: "Question every requirement", approxTimestampSec: 75 }],
  entities: [{ name: "Elon Musk", type: "person" }],
}
const transcript = { segments: [{ start: 0, end: 5, text: "hello" }, { start: 65, end: 70, text: "world" }] }

test("builds full markdown with timestamped transcript", () => {
  const md = buildEpisodeMarkdown(episode, transcript, insights)
  expect(md).toContain("# #415 How Elon Thinks")
  expect(md).toContain("Founders · 51:25")
  expect(md).toContain("Source: https://example.com/feed.xml")
  expect(md).toContain("## Summary\nA talk about first principles.")
  expect(md).toContain("- Think from first principles")
  expect(md).toContain("First principles, Manufacturing")
  expect(md).toContain('> "Question every requirement" — [1:15]')
  expect(md).toContain("Elon Musk (person)")
  expect(md).toContain("## Transcript")
  expect(md).toContain("[0:00] hello")
  expect(md).toContain("[1:05] world")
})

test("omits sections with no data", () => {
  const md = buildEpisodeMarkdown(
    { title: "Bare", podcastName: null, durationSec: null, publishedAt: null },
    null,
    null,
  )
  expect(md).toContain("# Bare")
  expect(md).not.toContain("## Summary")
  expect(md).not.toContain("## Transcript")
})

test("slugify makes a filesystem-safe slug", () => {
  expect(slugify("#415 How Elon Thinks!")).toBe("415-how-elon-thinks")
  expect(slugify("   ")).toBe("episode")
})
