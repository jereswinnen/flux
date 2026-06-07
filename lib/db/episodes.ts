import { desc, eq, ilike, or } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { episodes, type EpisodeStatus } from "./schema"
import * as schema from "./schema"

export interface NewEpisode {
  title: string
  audioUrl: string
  podcastName?: string
  sourceUrl?: string
  artworkUrl?: string
  episodeGuid?: string
  publishedAt?: Date
  durationSec?: number
  itunesCollectionId?: number
  itunesTrackId?: number
}

type DB = PostgresJsDatabase<typeof schema>

export function makeEpisodeRepo(db: DB) {
  return {
    async create(input: NewEpisode) {
      // Dedupe: prefer guid, fall back to audioUrl.
      const existing = await db
        .select()
        .from(episodes)
        .where(
          input.episodeGuid
            ? eq(episodes.episodeGuid, input.episodeGuid)
            : eq(episodes.audioUrl, input.audioUrl),
        )
        .limit(1)
      if (existing[0]) return existing[0]

      const [row] = await db.insert(episodes).values(input).returning()
      return row
    },

    async getById(id: string) {
      const rows = await db.select().from(episodes).where(eq(episodes.id, id)).limit(1)
      return rows[0] ?? null
    },

    async list() {
      return db.select().from(episodes).orderBy(desc(episodes.createdAt))
    },

    // Local title/show search for the global ⌘K palette. Matches the episode
    // title or its podcast name, newest first.
    async search(query: string, limit = 6) {
      const term = `%${query}%`
      return db
        .select()
        .from(episodes)
        .where(or(ilike(episodes.title, term), ilike(episodes.podcastName, term)))
        .orderBy(desc(episodes.createdAt))
        .limit(limit)
    },

    async updateStatus(id: string, status: EpisodeStatus, errorMessage?: string) {
      await db
        .update(episodes)
        .set({ status, errorMessage: errorMessage ?? null })
        .where(eq(episodes.id, id))
    },

    async remove(id: string) {
      await db.delete(episodes).where(eq(episodes.id, id))
    },
  }
}

import { db } from "./index"
export const episodeRepo = makeEpisodeRepo(db)
