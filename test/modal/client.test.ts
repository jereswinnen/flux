import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { triggerTranscription } from "@/lib/modal/client"

beforeEach(() => {
  process.env.MODAL_TRANSCRIBE_URL = "https://modal.run/transcribe"
  process.env.MODAL_WEBHOOK_SECRET = "s3cret"
  process.env.APP_URL = "https://app.test"
})
afterEach(() => vi.restoreAllMocks())

test("POSTs audio + callback + secret to the Modal endpoint", async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)

  await triggerTranscription("ep-1", "https://cdn/a.mp3")

  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe("https://modal.run/transcribe")
  const body = JSON.parse((init as RequestInit).body as string)
  expect(body).toEqual({
    episode_id: "ep-1",
    audio_url: "https://cdn/a.mp3",
    callback_url: "https://app.test/api/modal/callback",
    secret: "s3cret",
  })
})

test("throws if Modal responds non-2xx", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, _init?: RequestInit) => new Response("no", { status: 500 })))
  await expect(triggerTranscription("ep-1", "https://cdn/a.mp3")).rejects.toThrow()
})
