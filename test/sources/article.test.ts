import { describe, expect, it } from "vitest"
import { articleAdapter } from "@/lib/sources/article"

describe("articleAdapter.detect", () => {
  it("accepts a normal web article URL", () => {
    expect(articleAdapter.detect("https://example.com/2026/the-story")).toBe(true)
    expect(articleAdapter.detect("http://blog.example.org/posts/hello")).toBe(true)
  })
  it("rejects youtube, feeds, audio files, and non-URLs", () => {
    expect(articleAdapter.detect("https://youtu.be/dQw4w9WgXcQ")).toBe(false)
    expect(articleAdapter.detect("https://example.com/feed")).toBe(false)
    expect(articleAdapter.detect("https://example.com/podcast.rss")).toBe(false)
    expect(articleAdapter.detect("https://cdn.example.com/ep/12.mp3")).toBe(false)
    expect(articleAdapter.detect("not a url")).toBe(false)
  })
})
