export interface ShowResult {
  collectionId: number
  name: string
  artistName: string
  artworkUrl?: string
  feedUrl?: string
}

export interface EpisodeResult {
  trackId: number
  collectionId: number
  title: string
  podcastName: string
  audioUrl?: string // episodeUrl from iTunes
  artworkUrl?: string
  feedUrl?: string
  releaseDate?: string
  durationSec?: number
}
