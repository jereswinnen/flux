import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core"

export type EpisodeStatus =
  | "processing"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "failed"

export const episodes = pgTable("episodes", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  podcastName: text("podcast_name"),
  audioUrl: text("audio_url").notNull(),
  sourceUrl: text("source_url"),
  artworkUrl: text("artwork_url"),
  episodeGuid: text("episode_guid"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  durationSec: integer("duration_sec"),
  itunesCollectionId: bigint("itunes_collection_id", { mode: "number" }),
  itunesTrackId: bigint("itunes_track_id", { mode: "number" }),
  status: text("status").$type<EpisodeStatus>().notNull().default("processing"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const transcripts = pgTable("transcripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  episodeId: uuid("episode_id")
    .notNull()
    .references(() => episodes.id, { onDelete: "cascade" }),
  fullText: text("full_text").notNull(),
  segments: jsonb("segments").$type<{ start: number; end: number; text: string }[]>(),
})

export const insights = pgTable("insights", {
  id: uuid("id").defaultRandom().primaryKey(),
  episodeId: uuid("episode_id")
    .notNull()
    .references(() => episodes.id, { onDelete: "cascade" }),
  summary: text("summary"),
  takeaways: jsonb("takeaways").$type<string[]>(),
  topics: jsonb("topics").$type<string[]>(),
  chapters: jsonb("chapters").$type<{ title: string; startSec: number }[]>(),
  quotes: jsonb("quotes").$type<{ text: string; approxTimestampSec: number }[]>(),
  entities: jsonb("entities").$type<{ name: string; type: string }[]>(),
})

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    startSec: integer("start_sec").notNull(),
    endSec: integer("end_sec").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  },
  (t) => [
    index("chunks_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
)

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("conversations_episode_updated_idx").on(t.episodeId, t.updatedAt)],
)

export type MessageRole = "user" | "assistant"
export type ChatSource = { episodeId: string; episodeTitle: string; startSec: number }

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").$type<MessageRole>().notNull(),
    content: text("content").notNull(),
    sources: jsonb("sources").$type<ChatSource[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("messages_conversation_created_idx").on(t.conversationId, t.createdAt)],
)
