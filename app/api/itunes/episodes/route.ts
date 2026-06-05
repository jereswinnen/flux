import { fetchAndParseFeed } from "@/lib/rss/fetch"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const feedUrl = searchParams.get("feedUrl")
  if (!feedUrl) return Response.json({ error: "missing feedUrl" }, { status: 400 })
  try {
    const feed = await fetchAndParseFeed(feedUrl)
    return Response.json({
      showName: feed.showName,
      artworkUrl: feed.artworkUrl,
      episodes: feed.episodes.slice(0, 50),
    })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "feed fetch failed" },
      { status: 502 },
    )
  }
}
