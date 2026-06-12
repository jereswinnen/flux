import { afterEach, expect, test, vi } from "vitest"

vi.mock("@/lib/modal/client", () => ({
  triggerTranscription: vi.fn(async () => {}),
  triggerYoutubeTranscription: vi.fn(async () => {}),
}))

const created: Record<string, unknown>[] = []
vi.mock("@/lib/db/items", () => ({
  itemRepo: {
    create: vi.fn(async (v: Record<string, unknown>) => {
      const row = { id: "new-id", status: "processing", ...v }
      created.push(row)
      return row
    }),
    updateStatus: vi.fn(async () => {}),
    list: vi.fn(async () => []),
  },
}))

afterEach(() => {
  created.length = 0
  vi.clearAllMocks()
})

test("ingests a youtube url via the registry", async () => {
  const { POST } = await import("@/app/api/items/route")
  const res = await POST(
    new Request("http://t/api/items", {
      method: "POST",
      body: JSON.stringify({ url: "https://youtu.be/dQw4w9WgXcQ" }),
    }),
  )
  expect(res.status).toBe(201)
  expect(created[0]).toMatchObject({ type: "youtube", sourceMetadata: { videoId: "dQw4w9WgXcQ" } })
  const { triggerYoutubeTranscription } = await import("@/lib/modal/client")
  // startProcessing runs fire-and-forget; allow the microtask to flush
  await new Promise((r) => setTimeout(r, 0))
  expect(triggerYoutubeTranscription).toHaveBeenCalledWith("new-id", expect.stringContaining("dQw4w9WgXcQ"))
})

test("ingests a podcast payload by explicit type", async () => {
  const { POST } = await import("@/app/api/items/route")
  const res = await POST(
    new Request("http://t/api/items", {
      method: "POST",
      body: JSON.stringify({ type: "podcast", title: "Ep", audioUrl: "https://x/1.mp3" }),
    }),
  )
  expect(res.status).toBe(201)
  expect(created[0]).toMatchObject({ type: "podcast", title: "Ep", audioUrl: "https://x/1.mp3" })
})

test("rejects an unrecognized url", async () => {
  const { POST } = await import("@/app/api/items/route")
  const res = await POST(
    new Request("http://t/api/items", { method: "POST", body: JSON.stringify({ url: "https://example.com" }) }),
  )
  expect(res.status).toBe(400)
})
