import { sql } from "drizzle-orm"
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
  entities: jsonb("entities").$type<
    { name: string; type: string; context?: string; approxTimestampSec?: number }[]
  >(),
})

export type EntityType = "person" | "company" | "book" | "product" | "place" | "other"
export type EnrichmentStatus = "pending" | "enriched" | "unmatched" | "failed"

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    type: text("type").$type<EntityType>().notNull(),
    description: text("description"),
    summary: text("summary"),
    imageUrl: text("image_url"),
    wikipediaUrl: text("wikipedia_url"),
    wikidataId: text("wikidata_id"),
    externalIds: jsonb("external_ids").$type<{
      itunesId?: number
      isbn?: string
      googleBooksId?: string
    }>(),
    metadata: jsonb("metadata").$type<{ author?: string; publishedYear?: number }>(),
    enrichmentStatus: text("enrichment_status")
      .$type<EnrichmentStatus>()
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("entities_lower_name_type_idx").on(sql`lower(${t.name})`, t.type)],
)

export const episodeEntities = pgTable(
  "episode_entities",
  {
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    context: text("context"),
    approxTimestampSec: integer("approx_timestamp_sec"),
  },
  (t) => [
    primaryKey({ columns: [t.episodeId, t.entityId] }),
    index("episode_entities_entity_idx").on(t.entityId),
  ],
)

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    // Entity-derived chunks (one per episode_entities link) carry the entity id;
    // transcript chunks leave it null.
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "cascade" }),
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
    index("chunks_entity_idx").on(t.entityId),
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
export type ChatSource = {
  episodeId: string
  episodeTitle: string
  startSec: number
  podcastName?: string | null
  artworkUrl?: string | null
  audioUrl?: string | null
}

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
