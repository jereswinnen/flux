import { XMLParser } from "fast-xml-parser"
import { parseItunesDuration } from "./duration"

export interface FeedEpisode {
  title: string
  guid?: string
  audioUrl: string
  audioType?: string
  publishedAt?: string
  durationSec?: number
  description?: string
}

export interface ParsedFeed {
  showName?: string
  artworkUrl?: string
  episodes: FeedEpisode[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
})

function text(node: unknown): string | undefined {
  if (node == null) return undefined
  if (typeof node === "object" && "#text" in (node as any)) {
    return String((node as any)["#text"])
  }
  return String(node)
}

export function parseFeed(xml: string): ParsedFeed {
  const doc = parser.parse(xml)
  const channel = doc?.rss?.channel ?? {}
  const rawItems = channel.item
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : []

  const episodes: FeedEpisode[] = []
  for (const item of items) {
    const enclosure = item.enclosure
    const url = enclosure?.["@_url"]
    if (!url) continue
    episodes.push({
      title: text(item.title) ?? "Untitled",
      guid: text(item.guid),
      audioUrl: url,
      audioType: enclosure?.["@_type"],
      publishedAt: text(item.pubDate),
      durationSec: parseItunesDuration(text(item["itunes:duration"])),
      description: text(item.description),
    })
  }

  return {
    showName: text(channel.title),
    artworkUrl: channel["itunes:image"]?.["@_href"],
    episodes,
  }
}
