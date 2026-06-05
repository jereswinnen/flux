import { expect, test } from "vitest"
import { mapShow, mapEpisode } from "@/lib/itunes/map"

test("mapShow normalizes a podcast result", () => {
  const raw = {
    collectionId: 123,
    collectionName: "My Show",
    artistName: "Jane",
    artworkUrl600: "https://img/600.jpg",
    feedUrl: "https://feed.xml",
  }
  expect(mapShow(raw)).toEqual({
    collectionId: 123,
    name: "My Show",
    artistName: "Jane",
    artworkUrl: "https://img/600.jpg",
    feedUrl: "https://feed.xml",
  })
})

test("mapEpisode normalizes a podcastEpisode result", () => {
  const raw = {
    trackId: 9,
    collectionId: 123,
    trackName: "Ep 1",
    collectionName: "My Show",
    episodeUrl: "https://cdn/ep1.mp3",
    artworkUrl160: "https://img/160.jpg",
    feedUrl: "https://feed.xml",
    releaseDate: "2026-01-01T00:00:00Z",
    trackTimeMillis: 1800000,
  }
  expect(mapEpisode(raw)).toEqual({
    trackId: 9,
    collectionId: 123,
    title: "Ep 1",
    podcastName: "My Show",
    audioUrl: "https://cdn/ep1.mp3",
    artworkUrl: "https://img/160.jpg",
    feedUrl: "https://feed.xml",
    releaseDate: "2026-01-01T00:00:00Z",
    durationSec: 1800,
  })
})
