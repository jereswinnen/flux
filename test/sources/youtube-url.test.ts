import { describe, expect, it } from "vitest"
import { parseYouTubeId, isYouTubeUrl } from "@/lib/sources/youtube-url"

describe("parseYouTubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"],
    ["https://youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("extracts id from %s", (url, id) => {
    expect(parseYouTubeId(url)).toBe(id)
  })
  it("returns null for non-YouTube urls", () => {
    expect(parseYouTubeId("https://example.com/watch?v=x")).toBeNull()
    expect(parseYouTubeId("https://anchor.fm/ep.mp3")).toBeNull()
  })
})

describe("isYouTubeUrl", () => {
  it("is true only when an id can be parsed", () => {
    expect(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true)
    expect(isYouTubeUrl("https://example.com")).toBe(false)
  })
})
