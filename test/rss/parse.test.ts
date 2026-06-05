import { expect, test } from "vitest"
import { parseFeed } from "@/lib/rss/parse"

const XML = `<?xml version="1.0"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>My Show</title>
    <itunes:image href="https://img/show.jpg"/>
    <item>
      <title>Ep One</title>
      <guid>guid-1</guid>
      <pubDate>Wed, 01 Jan 2026 00:00:00 +0000</pubDate>
      <itunes:duration>00:30:00</itunes:duration>
      <enclosure url="https://cdn/ep1.mp3" type="audio/mpeg" length="123"/>
    </item>
    <item>
      <title>Ep Two</title>
      <guid isPermaLink="false">guid-2</guid>
      <enclosure url="https://cdn/ep2.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`

test("parseFeed extracts show + episodes with enclosures", () => {
  const feed = parseFeed(XML)
  expect(feed.showName).toBe("My Show")
  expect(feed.artworkUrl).toBe("https://img/show.jpg")
  expect(feed.episodes).toHaveLength(2)
  expect(feed.episodes[0]).toMatchObject({
    title: "Ep One",
    guid: "guid-1",
    audioUrl: "https://cdn/ep1.mp3",
    durationSec: 1800,
  })
  expect(feed.episodes[1].guid).toBe("guid-2")
  expect(feed.episodes[1].audioUrl).toBe("https://cdn/ep2.mp3")
})

test("parseFeed skips items with no enclosure", () => {
  const xml = `<rss><channel><title>S</title>
    <item><title>No Audio</title></item></channel></rss>`
  expect(parseFeed(xml).episodes).toHaveLength(0)
})
