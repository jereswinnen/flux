import { and, asc, desc, eq, isNull } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { conversations, messages, type ChatSource, type MessageRole } from "./schema"
import * as schema from "./schema"
import { db as appDb } from "./index"

type DB = PostgresJsDatabase<typeof schema>

export function makeConversationRepo(db: DB) {
  return {
    async create(input: { episodeId?: string | null }) {
      const [row] = await db
        .insert(conversations)
        .values({ episodeId: input.episodeId ?? null })
        .returning()
      return row
    },

    async list(episodeId: string | null) {
      return db
        .select()
        .from(conversations)
        .where(episodeId === null ? isNull(conversations.episodeId) : eq(conversations.episodeId, episodeId))
        .orderBy(desc(conversations.updatedAt))
    },

    async get(id: string) {
      const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1)
      if (!conversation) return null
      const msgs = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, id))
        .orderBy(asc(messages.createdAt))
      return { conversation, messages: msgs }
    },

    async addMessage(input: {
      conversationId: string
      role: MessageRole
      content: string
      sources?: ChatSource[]
    }) {
      const [row] = await db
        .insert(messages)
        .values({
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          sources: input.sources ?? null,
        })
        .returning()
      return row
    },

    async touch(id: string) {
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, id))
    },

    async setTitleFromFirstMessage(id: string, content: string) {
      const title = content.trim().slice(0, 60) || "New chat"
      await db
        .update(conversations)
        .set({ title })
        .where(and(eq(conversations.id, id), eq(conversations.title, "New chat")))
    },

    async remove(id: string) {
      await db.delete(conversations).where(eq(conversations.id, id))
    },
  }
}

export const conversationRepo = makeConversationRepo(appDb)
