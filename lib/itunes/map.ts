import type { EpisodeResult, ShowResult } from "./types"

export function mapShow(raw: any): ShowResult {
  return {
    collectionId: raw.collectionId,
    name: raw.collectionName,
    artistName: raw.artistName,
    artworkUrl: raw.artworkUrl600 ?? raw.artworkUrl100,
    feedUrl: raw.feedUrl,
  }
}

export function mapEpisode(raw: any): EpisodeResult {
  return {
    trackId: raw.trackId,
    collectionId: raw.collectionId,
    title: raw.trackName,
    podcastName: raw.collectionName,
    audioUrl: raw.episodeUrl,
    artworkUrl: raw.artworkUrl160 ?? raw.artworkUrl600 ?? raw.artworkUrl100,
    feedUrl: raw.feedUrl,
    releaseDate: raw.releaseDate,
    durationSec: raw.trackTimeMillis
      ? Math.round(raw.trackTimeMillis / 1000)
      : undefined,
  }
}
