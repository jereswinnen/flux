import { afterEach, expect, test, vi } from "vitest"

const item = { id: "i1", type: "podcast", title: "Ep", podcastName: "Show", audioUrl: "a", sourceUrl: null, artworkUrl: null, durationSec: null, publishedAt: null, createdAt: new Date(), status: "ready", readState: "unread", sourceMetadata: null }
vi.mock("@/lib/db/items", () => ({
  itemRepo: {
    getById: vi.fn(async (id: string) => (id === "i1" ? item : null)),
    remove: vi.fn(async () => {}),
    setReadState: vi.fn(async () => {}),
  },
}))
vi.mock("@/lib/db/highlights", () => ({ highlightRepo: { list: vi.fn(async () => []) } }))
vi.mock("@/lib/db/entities", () => ({ entitiesForEpisode: vi.fn(async () => []) }))
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) } }))

afterEach(() => vi.clearAllMocks())

test("GET returns the item bundle", async () => {
  const { GET } = await import("@/app/api/items/[id]/route")
  const res = await GET(new Request("http://t/api/items/i1"), { params: Promise.resolve({ id: "i1" }) })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.item).toMatchObject({ id: "i1", source: "Show", readState: "unread" })
})
test("GET 404 for missing", async () => {
  const { GET } = await import("@/app/api/items/[id]/route")
  const res = await GET(new Request("http://t/api/items/x"), { params: Promise.resolve({ id: "x" }) })
  expect(res.status).toBe(404)
})
test("DELETE 204 for existing, 404 for missing", async () => {
  const { DELETE } = await import("@/app/api/items/[id]/route")
  expect((await DELETE(new Request("http://t"), { params: Promise.resolve({ id: "i1" }) })).status).toBe(204)
  expect((await DELETE(new Request("http://t"), { params: Promise.resolve({ id: "x" }) })).status).toBe(404)
})
test("PATCH rejects an invalid readState", async () => {
  const { PATCH } = await import("@/app/api/items/[id]/route")
  const res = await PATCH(new Request("http://t", { method: "PATCH", body: JSON.stringify({ readState: "bogus" }) }), { params: Promise.resolve({ id: "i1" }) })
  expect(res.status).toBe(400)
})
