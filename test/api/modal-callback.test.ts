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
  vi.doMock("@/lib/pipeline/process-transcript", () => ({
    processTranscript: vi.fn(async () => {}),
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
