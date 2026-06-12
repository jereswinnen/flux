import { afterEach, beforeEach, expect, test, vi } from "vitest"

beforeEach(() => {
  process.env.MODAL_WEBHOOK_SECRET = "s3cret"
  vi.resetModules()
})
afterEach(() => vi.restoreAllMocks())

test("rejects wrong secret with 401", async () => {
  const { POST } = await import("@/app/api/modal/callback/route")
  const res = await POST(
    new Request("http://x/api/modal/callback", {
      method: "POST",
      body: JSON.stringify({ episode_id: "e", secret: "wrong", transcript: "t", segments: [] }),
    }),
  )
  expect(res.status).toBe(401)
})

test("accepts valid secret and kicks off processing", async () => {
  vi.doMock("@/lib/pipeline/process-content", () => ({
    processContent: vi.fn(async () => {}),
  }))
  const { POST } = await import("@/app/api/modal/callback/route")
  const res = await POST(
    new Request("http://x/api/modal/callback", {
      method: "POST",
      body: JSON.stringify({
        episode_id: "e",
        secret: "s3cret",
        transcript: "t",
        segments: [],
      }),
    }),
  )
  expect(res.status).toBe(202)
})

test("rejects with 401 when MODAL_WEBHOOK_SECRET is unset and secret is omitted (fail-closed)", async () => {
  delete process.env.MODAL_WEBHOOK_SECRET
  vi.resetModules()
  const { POST } = await import("@/app/api/modal/callback/route")
  const res = await POST(
    new Request("http://x/api/modal/callback", {
      method: "POST",
      body: JSON.stringify({ episode_id: "e", transcript: "t", segments: [] }),
    }),
  )
  expect(res.status).toBe(401)
  // Restore for subsequent tests
  process.env.MODAL_WEBHOOK_SECRET = "s3cret"
})

test("returns 400 when episode_id is missing", async () => {
  vi.resetModules()
  const { POST } = await import("@/app/api/modal/callback/route")
  const res = await POST(
    new Request("http://x/api/modal/callback", {
      method: "POST",
      body: JSON.stringify({ secret: "s3cret", transcript: "t", segments: [] }),
    }),
  )
  expect(res.status).toBe(400)
})

test("accepts item_id, calls updateMeta with mapped fields, returns 202", async () => {
  const updateMeta = vi.fn(async () => {})
  vi.doMock("@/lib/db/items", () => ({
    itemRepo: {
      updateStatus: vi.fn(async () => {}),
      updateMeta,
    },
  }))
  vi.doMock("@/lib/pipeline/process-content", () => ({
    processContent: vi.fn(async () => {}),
  }))
  const { POST } = await import("@/app/api/modal/callback/route")
  const res = await POST(
    new Request("http://x/api/modal/callback", {
      method: "POST",
      body: JSON.stringify({
        item_id: "y1",
        secret: "s3cret",
        metadata: {
          title: "Real Title",
          channelName: "Chan",
          thumbnailUrl: "https://t/.jpg",
          durationSec: 1200,
        },
        transcript: "t",
        segments: [],
      }),
    }),
  )
  expect(res.status).toBe(202)
  expect(updateMeta).toHaveBeenCalledWith("y1", {
    title: "Real Title",
    podcastName: "Chan",
    artworkUrl: "https://t/.jpg",
    durationSec: 1200,
  })
})

test("podcast episode_id path: updateMeta is NOT called when no metadata", async () => {
  const updateMeta = vi.fn(async () => {})
  vi.doMock("@/lib/db/items", () => ({
    itemRepo: {
      updateStatus: vi.fn(async () => {}),
      updateMeta,
    },
  }))
  vi.doMock("@/lib/pipeline/process-content", () => ({
    processContent: vi.fn(async () => {}),
  }))
  const { POST } = await import("@/app/api/modal/callback/route")
  const res = await POST(
    new Request("http://x/api/modal/callback", {
      method: "POST",
      body: JSON.stringify({
        episode_id: "pod1",
        secret: "s3cret",
        transcript: "t",
        segments: [],
      }),
    }),
  )
  expect(res.status).toBe(202)
  expect(updateMeta).not.toHaveBeenCalled()
})
