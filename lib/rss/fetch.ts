import { parseFeed, type ParsedFeed } from "./parse"

export async function fetchAndParseFeed(feedUrl: string): Promise<ParsedFeed> {
  const res = await fetch(feedUrl, {
    headers: { "user-agent": "podcast-kb/1.0" },
  })
  if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status}`)
  const xml = await res.text()
  return parseFeed(xml)
}
