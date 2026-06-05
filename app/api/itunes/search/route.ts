import { searchEpisodes, searchShows } from "@/lib/itunes/client"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")
  const type = searchParams.get("type") ?? "podcast"
  if (!q) return Response.json({ error: "missing q" }, { status: 400 })
  try {
    const results =
      type === "episode" ? await searchEpisodes(q) : await searchShows(q)
    return Response.json({ results })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "search failed" },
      { status: 502 },
    )
  }
}
