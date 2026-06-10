import { afterEach, expect, test, vi } from "vitest"
import { searchCandidates } from "@/lib/entities/sources"

afterEach(() => vi.unstubAllGlobals())

const wikiSearchBody = {
  pages: [
    {
      id: 1,
      key: "Steve_Jobs",
      title: "Steve Jobs",
      description: "American businessman (1955–2011)",
      thumbnail: { url: "//upload.wikimedia.org/jobs.jpg" },
    },
  ],
}
const wikiSummaryBody = {
  title: "Steve Jobs",
  description: "American businessman (1955–2011)",
  extract: "Steven Paul Jobs was an American businessman...",
  thumbnail: { source: "https://upload.wikimedia.org/jobs.jpg" },
  content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Steve_Jobs" } },
  wikibase_item: "Q19837",
}

test("person → Wikipedia search + summary candidates", async () => {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes("/v1/search/title")) return new Response(JSON.stringify(wikiSearchBody))
    if (url.includes("/page/summary/")) return new Response(JSON.stringify(wikiSummaryBody))
    throw new Error(`unexpected url ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)

  const out = await searchCandidates("Steve Jobs", "person")
  expect(out).toHaveLength(1)
  expect(out[0]).toMatchObject({
    source: "wikipedia",
    title: "Steve Jobs",
    description: "American businessman (1955–2011)",
    url: "https://en.wikipedia.org/wiki/Steve_Jobs",
    wikidataId: "Q19837",
    imageUrl: "https://upload.wikimedia.org/jobs.jpg",
  })
  // Wikipedia policy: identify the client.
  const init = fetchMock.mock.calls[0][1] as RequestInit | undefined
  expect((init?.headers as Record<string, string>)["User-Agent"]).toContain("flux")
})

test("book → Google Books candidates with ISBN and author", async () => {
  const body = {
    items: [
      {
        id: "abc123",
        volumeInfo: {
          title: "Sapiens",
          authors: ["Yuval Noah Harari"],
          publishedDate: "2011-06-04",
          description: "A brief history of humankind.",
          imageLinks: { thumbnail: "http://books.google.com/sapiens.jpg" },
          industryIdentifiers: [{ type: "ISBN_13", identifier: "9780062316097" }],
          canonicalVolumeLink: "https://books.google.com/books?id=abc123",
        },
      },
    ],
  }
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body))))

  const out = await searchCandidates("Sapiens", "book")
  expect(out[0]).toMatchObject({
    source: "googleBooks",
    title: "Sapiens",
    externalIds: { isbn: "9780062316097", googleBooksId: "abc123" },
    metadata: { author: "Yuval Noah Harari", publishedYear: 2011 },
  })
})

test("all sources errored → rejects (total outage)", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })))
  await expect(searchCandidates("UniqueName_TotalOutage_9876", "person")).rejects.toThrow()
})

test("summary failure drops only that candidate", async () => {
  const searchResult = {
    pages: [
      { id: 2, key: "Steve_Wozniak_A", title: "Steve Wozniak A" },
      { id: 3, key: "Steve_Wozniak_B", title: "Steve Wozniak B" },
    ],
  }
  const summaryB = {
    title: "Steve Wozniak B",
    description: "Co-founder of Apple",
    extract: "Steve Wozniak B extract",
    thumbnail: { source: "https://example.com/woz.jpg" },
    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Steve_Wozniak_B" } },
    wikibase_item: "Q12345",
  }
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes("/v1/search/title")) return new Response(JSON.stringify(searchResult))
    if (url.includes("Steve_Wozniak_A")) return new Response("error", { status: 500 })
    if (url.includes("Steve_Wozniak_B")) return new Response(JSON.stringify(summaryB))
    throw new Error(`unexpected url ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)

  const out = await searchCandidates("SteveWozniakUnique7742", "person")
  expect(out).toHaveLength(1)
  expect(out[0]).toMatchObject({ title: "Steve Wozniak B" })
})

test("product routing: wiki fails, iTunes succeeds → iTunes candidate only (no throw)", async () => {
  const itunesBody = {
    results: [
      {
        trackId: 98765,
        trackName: "UniqueApp_ProductTest_4321",
        sellerName: "Test Corp",
        artworkUrl100: "https://example.com/app.jpg",
        trackViewUrl: "https://apps.apple.com/app/unique-app",
      },
    ],
  }
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes("en.wikipedia.org")) return new Response("error", { status: 500 })
    if (url.includes("itunes.apple.com")) return new Response(JSON.stringify(itunesBody))
    throw new Error(`unexpected url ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)

  const out = await searchCandidates("UniqueApp_ProductTest_4321", "product")
  expect(out).toHaveLength(1)
  expect(out[0]).toMatchObject({ source: "itunes", title: "UniqueApp_ProductTest_4321" })
})

test("no-results: empty wiki pages → resolves []", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ pages: [] }))))
  const out = await searchCandidates("Xyzzy_NoResults_Unique_8899", "person")
  expect(out).toEqual([])
})
