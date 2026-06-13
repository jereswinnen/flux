import { and, desc, eq, ilike, or } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { highlights, items, type ItemType } from "./schema"
import * as schema from "./schema"
import type { HighlightKind, HighlightLocator } from "@/lib/highlights/locator"

export interface NewHighlight {
  itemId: string
  kind: HighlightKind
  text: string
  note?: string
  locator?: HighlightLocator
  embedding?: number[]
}

export interface HighlightRow {
  id: string
  kind: string
  text: string
  note: string | null
  locator: HighlightLocator | null
  createdAt: Date
  item: { id: string; type: ItemType; title: string; source: string | null; artworkUrl: string | null }
}

type DB = PostgresJsDatabase<typeof schema>

export function makeHighlightRepo(db: DB) {
  return {
    async create(input: NewHighlight) {
      const [row] = await db
        .insert(highlights)
        .values({
          itemId: input.itemId,
          kind: input.kind,
          text: input.text,
          note: input.note ?? null,
          locator: input.locator,
          embedding: input.embedding,
        })
        .returning()
      return row
    },

    async list(opts: { type?: string; q?: string; itemId?: string }): Promise<HighlightRow[]> {
      const filters = []
      if (opts.itemId) filters.push(eq(highlights.itemId, opts.itemId))
      if (opts.type) filters.push(eq(items.type, opts.type as ItemType))
      if (opts.q && opts.q.trim()) {
        const term = `%${opts.q.trim()}%`
        filters.push(or(ilike(highlights.text, term), ilike(highlights.note, term)))
      }
      const rows = await db
        .select({
          id: highlights.id,
          kind: highlights.kind,
          text: highlights.text,
          note: highlights.note,
          locator: highlights.locator,
          createdAt: highlights.createdAt,
          itemId: items.id,
          itemType: items.type,
          itemTitle: items.title,
          source: items.podcastName,
          artworkUrl: items.artworkUrl,
        })
        .from(highlights)
        .innerJoin(items, eq(highlights.itemId, items.id))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(highlights.createdAt))
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        text: r.text,
        note: r.note,
        locator: r.locator,
        createdAt: r.createdAt,
        item: {
          id: r.itemId,
          type: r.itemType,
          title: r.itemTitle,
          source: r.source,
          artworkUrl: r.artworkUrl,
        },
      }))
    },

    async updateNote(id: string, note: string | null) {
      await db.update(highlights).set({ note }).where(eq(highlights.id, id))
    },

    async remove(id: string) {
      await db.delete(highlights).where(eq(highlights.id, id))
    },
  }
}

import { db } from "./index"
export const highlightRepo = makeHighlightRepo(db)
