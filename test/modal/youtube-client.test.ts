import { afterEach, expect, test, vi } from "vitest"
import { triggerYoutubeTranscription } from "@/lib/modal/client"

afterEach(() => vi.unstubAllGlobals())

test("posts video_url + item_id + callback to the youtube endpoint", async () => {
  process.env.MODAL_TRANSCRIBE_YOUTUBE_URL = "https://modal.test/yt"
  process.env.MODAL_WEBHOOK_SECRET = "s3cr3t"
  process.env.APP_URL = "https://app.test"
  const calls: { url: string; body: unknown }[] = []
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return new Response(null, { status: 200 })
  })
  await triggerYoutubeTranscription("it-1", "https://youtu.be/dQw4w9WgXcQ")
  expect(calls[0].url).toBe("https://modal.test/yt")
  expect(calls[0].body).toMatchObject({
    item_id: "it-1",
    video_url: "https://youtu.be/dQw4w9WgXcQ",
    callback_url: "https://app.test/api/modal/callback",
    secret: "s3cr3t",
  })
})
