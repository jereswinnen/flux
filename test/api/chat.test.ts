import { afterEach, expect, test, vi } from "vitest"

afterEach(() => vi.restoreAllMocks())

test("returns 400 without a question", async () => {
  const { POST } = await import("@/app/api/chat/route")
  const res = await POST(
    new Request("http://x/api/chat", { method: "POST", body: JSON.stringify({}) }),
  )
  expect(res.status).toBe(400)
})

test.skipIf(!process.env.OPENAI_API_KEY)(
  "retrieves context and streams an answer",
  async () => {
    vi.doMock("@/lib/ai/embeddings", () => ({
      embedQuery: vi.fn(async () => Array(1536).fill(0.1)),
    }))
    vi.doMock("@/lib/db/search", () => ({
      searchChunks: vi.fn(async () => [
        { chunkId: "c1", episodeId: "e1", episodeTitle: "E", content: "ctx", startSec: 0, endSec: 5, similarity: 0.9 },
      ]),
    }))

    vi.resetModules()
    const { POST } = await import("@/app/api/chat/route")
    const res = await POST(
      new Request("http://x/api/chat", {
        method: "POST",
        body: JSON.stringify({ question: "what about X?", episodeId: "e1" }),
      }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.length).toBeGreaterThan(0)
  },
)
