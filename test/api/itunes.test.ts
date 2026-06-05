import { afterEach, expect, test, vi } from "vitest"

afterEach(() => vi.restoreAllMocks())

test("GET /api/itunes/search returns mapped shows", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [{ collectionId: 1, collectionName: "S", artistName: "A" }],
        }),
      ),
    ),
  )
  const { GET } = await import("@/app/api/itunes/search/route")
  const res = await GET(
    new Request("http://x/api/itunes/search?q=test&type=podcast"),
  )
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.results[0].name).toBe("S")
})

test("GET /api/itunes/search 400s without q", async () => {
  const { GET } = await import("@/app/api/itunes/search/route")
  const res = await GET(new Request("http://x/api/itunes/search"))
  expect(res.status).toBe(400)
})
