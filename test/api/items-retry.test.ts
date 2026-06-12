import { afterEach, expect, test, vi } from "vitest"

vi.mock("@/lib/modal/client", () => ({
  triggerTranscription: vi.fn(async () => {}),
  triggerYoutubeTranscription: vi.fn(async () => {}),
}))
vi.mock("@/lib/pipeline/process-content", () => ({ processContent: vi.fn(async () => {}) }))

let item: any
let transcriptRows: any[] = []
vi.mock("@/lib/db/items", () => ({
  itemRepo: { getById: vi.fn(async () => item), updateStatus: vi.fn(async () => {}) },
}))
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => transcriptRows }) }) }) },
}))

afterEach(() => {
  vi.clearAllMocks()
  transcriptRows = []
})

test("youtube item with no transcript re-triggers youtube", async () => {
  item = { id: "y1", type: "youtube", audioUrl: null, status: "failed", sourceMetadata: { videoId: "dQw4w9WgXcQ" } }
  const { POST } = await import("@/app/api/items/[id]/retry/route")
  const res = await POST(new Request("http://t"), { params: Promise.resolve({ id: "y1" }) })
  expect(res.status).toBe(202)
  await new Promise((r) => setTimeout(r, 0))
  const { triggerYoutubeTranscription } = await import("@/lib/modal/client")
  expect(triggerYoutubeTranscription).toHaveBeenCalledWith("y1", expect.stringContaining("dQw4w9WgXcQ"))
})

test("item with existing transcript resumes analysis", async () => {
  item = { id: "p1", type: "podcast", audioUrl: "https://x/1.mp3", status: "failed" }
  transcriptRows = [{ itemId: "p1", fullText: "hello", segments: [] }]
  const { POST } = await import("@/app/api/items/[id]/retry/route")
  const res = await POST(new Request("http://t"), { params: Promise.resolve({ id: "p1" }) })
  expect(res.status).toBe(202)
  await new Promise((r) => setTimeout(r, 0))
  const { processContent } = await import("@/lib/pipeline/process-content")
  expect(processContent).toHaveBeenCalledWith(
    expect.objectContaining({ itemId: "p1", transcript: "hello" }),
    expect.anything(),
  )
})

test("404 for missing item", async () => {
  item = null
  const { POST } = await import("@/app/api/items/[id]/retry/route")
  const res = await POST(new Request("http://t"), { params: Promise.resolve({ id: "nope" }) })
  expect(res.status).toBe(404)
})
