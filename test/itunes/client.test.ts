import { afterEach, expect, test, vi } from "vitest"
import { searchShows, searchEpisodes } from "@/lib/itunes/client"

afterEach(() => vi.restoreAllMocks())

test("searchShows hits the podcast entity and maps results", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        results: [
          { collectionId: 1, collectionName: "S", artistName: "A", feedUrl: "f" },
        ],
      }),
    ),
  )
  vi.stubGlobal("fetch", fetchMock)

  const out = await searchShows("test")
  expect(out[0].name).toBe("S")
  const url = fetchMock.mock.calls[0][0] as string
  expect(url).toContain("entity=podcast")
  expect(url).toContain("term=test")
})

test("searchEpisodes hits the podcastEpisode entity", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ results: [] })),
  )
  vi.stubGlobal("fetch", fetchMock)
  await searchEpisodes("hello world")
  const url = fetchMock.mock.calls[0][0] as string
  expect(url).toContain("entity=podcastEpisode")
  expect(url).toContain("term=hello%20world")
})
