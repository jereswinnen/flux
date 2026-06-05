import { mapEpisode, mapShow } from "./map"
import type { EpisodeResult, ShowResult } from "./types"

const BASE = "https://itunes.apple.com/search"

// Light in-memory TTL cache to stay under Apple's ~20 req/min limit.
const cache = new Map<string, { at: number; data: unknown }>()
const TTL_MS = 60_000

async function getJson(url: string): Promise<any> {
  const hit = cache.get(url)
  const now = Date.now()
  if (hit && now - hit.at < TTL_MS) return hit.data
  const res = await fetch(url)
  if (!res.ok) throw new Error(`iTunes request failed: ${res.status}`)
  const data = await res.json()
  cache.set(url, { at: now, data })
  return data
}

export async function searchShows(term: string): Promise<ShowResult[]> {
  const url = `${BASE}?media=podcast&entity=podcast&limit=25&term=${encodeURIComponent(term)}`
  const data = await getJson(url)
  return (data.results ?? []).map(mapShow)
}

export async function searchEpisodes(term: string): Promise<EpisodeResult[]> {
  const url = `${BASE}?media=podcast&entity=podcastEpisode&limit=25&term=${encodeURIComponent(term)}`
  const data = await getJson(url)
  return (data.results ?? []).map(mapEpisode)
}
