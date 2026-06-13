import { sql } from "drizzle-orm"
import type { HighlightLocator } from "@/lib/highlights/locator"
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core"

export type ItemStatus =
  | "processing"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "failed"

export type ItemType = "podcast" | "youtube" | "article"
export type ItemReadState = "unread" | "read" | "archived"

// Source-specific identifiers. Callers must populate the fields relevant to the
// item's `type` (e.g. youtube items set `videoId`). The display "source name"
// (show / channel / author) lives in the top-level `podcastName` column, not here.
export type SourceMetadata = {
  // podcast — `guid` is the RSS <guid>. iTunes ids are opaque identifiers; they
  // sit comfortably within JSON's safe-integer range (currently ~10 digits).
  guid?: string
  itunesCollectionId?: number
  itunesTrackId?: number
  // youtube
  videoId?: string
  channelId?: string
  // article — reserved; no fields yet
}

export const items = pgTable("items", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type").$type<ItemType>().notNull().default("podcast"),
  title: text("title").notNull(),
  // Generic source name: podcast show, YouTube channel, or article author.
  podcastName: text("podcast_name"),
  audioUrl: text("audio_url"),
  sourceUrl: text("source_url"),
  artworkUrl: text("artwork_url"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  durationSec: integer("duration_sec"),
  status: text("status").$type<ItemStatus>().notNull().default("processing"),
  errorMessage: text("error_message"),
  readState: text("read_state").$type<ItemReadState>().notNull().default("unread"),
  sourceMetadata: jsonb("source_metadata").$type<SourceMetadata>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const highlights = pgTable(
  "highlights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    note: text("note"),
    locator: jsonb("locator").$type<HighlightLocator>(),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("highlights_item_idx").on(t.itemId),
    index("highlights_created_idx").on(t.createdAt),
    index("highlights_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
)

export const transcripts = pgTable(
  "transcripts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    fullText: text("full_text").notNull(),
    segments: jsonb("segments").$type<TranscriptSegment[]>(),
    contentHtml: text("content_html"),
  },
  (t) => [uniqueIndex("transcripts_item_unique").on(t.itemId)],
)

export type TranscriptWord = { start: number; end: number; word: string }
export type TranscriptSegment = {
  start: number
  end: number
  text: string
  // Per-word timing (YouTube items, for the live-transcript word highlight).
  words?: TranscriptWord[]
}

export const insights = pgTable("insights", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
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

export const itemEntities = pgTable(
  "item_entities",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    context: text("context"),
    approxTimestampSec: integer("approx_timestamp_sec"),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.entityId] }),
    index("item_entities_entity_idx").on(t.entityId),
  ],
)

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    // Entity-derived chunks (one per item_entities link) carry the entity id;
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
    itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("conversations_item_updated_idx").on(t.itemId, t.updatedAt)],
)

export type MessageRole = "user" | "assistant"
export type ChatSource = {
  itemId: string
  itemTitle: string
  startSec: number
  podcastName?: string | null
  artworkUrl?: string | null
  audioUrl?: string | null
  videoId?: string | null
  isHighlight?: boolean
  snippet?: string | null
  isWeb?: boolean
  url?: string | null
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

export const deletions = pgTable(
  "deletions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").notNull(),
    entityId: uuid("entity_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("deletions_deleted_at_idx").on(t.deletedAt)],
)
