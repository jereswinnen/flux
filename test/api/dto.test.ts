import { describe, expect, it } from "vitest"
import { itemToDTO } from "@/lib/api/dto"

describe("itemToDTO", () => {
  it("maps a podcast row to a stable DTO", () => {
    const dto = itemToDTO({
      id: "i1",
      type: "podcast",
      title: "Ep 1",
      podcastName: "My Show",
      audioUrl: "https://x/1.mp3",
      sourceUrl: "https://x/ep1",
      artworkUrl: "https://x/art.jpg",
      publishedAt: new Date("2026-01-02T03:04:05Z"),
      durationSec: 3600,
      status: "ready",
      errorMessage: null,
      readState: "unread",
      sourceMetadata: { guid: "g1", itunesCollectionId: 99 },
      createdAt: new Date("2026-01-01T00:00:00Z"),
    })
    expect(dto).toMatchObject({
      id: "i1",
      type: "podcast",
      title: "Ep 1",
      source: "My Show",
      audioUrl: "https://x/1.mp3",
      artworkUrl: "https://x/art.jpg",
      durationSec: 3600,
      status: "ready",
      videoId: null,
      publishedAt: "2026-01-02T03:04:05.000Z",
      readState: "unread",
    })
  })

  it("exposes youtube videoId from sourceMetadata", () => {
    const dto = itemToDTO({
      id: "i2",
      type: "youtube",
      title: "Vid",
      podcastName: "Some Channel",
      audioUrl: null,
      sourceUrl: "https://youtube.com/watch?v=abc",
      artworkUrl: "https://x/thumb.jpg",
      publishedAt: null,
      durationSec: null,
      status: "processing",
      errorMessage: null,
      readState: "unread",
      sourceMetadata: { videoId: "abc", channelId: "c1" },
      createdAt: new Date("2026-01-01T00:00:00Z"),
    })
    expect(dto.videoId).toBe("abc")
    expect(dto.publishedAt).toBeNull()
    expect(dto.audioUrl).toBeNull()
  })
})
