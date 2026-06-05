import { expect, test } from "vitest"
import { isUrl, looksLikeFeedUrl } from "@/lib/url"

test("isUrl detects http(s) URLs", () => {
  expect(isUrl("https://example.com/a.mp3")).toBe(true)
  expect(isUrl("http://x.io")).toBe(true)
  expect(isUrl("  https://x.io  ")).toBe(true)
  expect(isUrl("the daily")).toBe(false)
  expect(isUrl("example.com")).toBe(false)
})

test("looksLikeFeedUrl detects feed-ish URLs", () => {
  expect(looksLikeFeedUrl("https://feeds.megaphone.fm/the-daily")).toBe(true)
  expect(looksLikeFeedUrl("https://example.com/podcast.xml")).toBe(true)
  expect(looksLikeFeedUrl("https://example.com/rss")).toBe(true)
  expect(looksLikeFeedUrl("https://cdn.example.com/ep1.mp3")).toBe(false)
  expect(looksLikeFeedUrl("not a url")).toBe(false)
})
