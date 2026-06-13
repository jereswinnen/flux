import { desc, eq, ilike, or, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { items, type ItemReadState, type ItemStatus, type ItemType, type SourceMetadata } from "./schema"
import * as schema from "./schema"

export interface NewItem {
  type: ItemType
  title: string
  audioUrl?: string
  podcastName?: string
  sourceUrl?: string
  artworkUrl?: string
  publishedAt?: Date
  durationSec?: number
  sourceMetadata?: SourceMetadata
}

type DB = PostgresJsDatabase<typeof schema>

export function makeItemRepo(db: DB) {
  return {
    async create(input: NewItem) {
      // Dedupe: prefer sourceMetadata.guid, fall back to audioUrl (podcasts),
      // then sourceUrl (everything else).
      const guid = input.sourceMetadata?.guid
      const existing = guid
        ? await db
            .select()
            .from(items)
            .where(sql`${items.sourceMetadata}->>'guid' = ${guid}`)
            .limit(1)
        : input.audioUrl
          ? await db.select().from(items).where(eq(items.audioUrl, input.audioUrl)).limit(1)
          : input.sourceUrl
            ? await db.select().from(items).where(eq(items.sourceUrl, input.sourceUrl)).limit(1)
            : []
      if (existing[0]) return existing[0]

      const [row] = await db.insert(items).values(input).returning()
      return row
    },

    async getById(id: string) {
      const rows = await db.select().from(items).where(eq(items.id, id)).limit(1)
      return rows[0] ?? null
    },

    async list() {
      return db.select().from(items).orderBy(desc(items.createdAt))
    },

    async search(query: string, limit = 6) {
      const term = `%${query}%`
      return db
        .select()
        .from(items)
        .where(or(ilike(items.title, term), ilike(items.podcastName, term)))
        .orderBy(desc(items.createdAt))
        .limit(limit)
    },

    async setReadState(id: string, readState: ItemReadState) {
      await db.update(items).set({ readState }).where(eq(items.id, id))
    },

    async updateStatus(id: string, status: ItemStatus, errorMessage?: string) {
      await db
        .update(items)
        .set({ status, errorMessage: errorMessage ?? null })
        .where(eq(items.id, id))
    },

    async updateMeta(
      id: string,
      fields: Partial<
        Pick<NewItem, "title" | "podcastName" | "artworkUrl" | "durationSec"> & {
          publishedAt: Date
        }
      >,
    ) {
      if (Object.keys(fields).length === 0) return
      await db.update(items).set(fields).where(eq(items.id, id))
    },

    async remove(id: string) {
      await db.delete(items).where(eq(items.id, id))
    },
  }
}

import { db } from "./index"
export const itemRepo = makeItemRepo(db)
