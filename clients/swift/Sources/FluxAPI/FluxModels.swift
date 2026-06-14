// FluxModels.swift
// Codable models mirroring the Flux API JSON DTOs.
//
// Usage: configure JSONDecoder.dateDecodingStrategy = .iso8601 (FluxClient does this
// automatically). All nullable JSON fields map to Swift optionals.
//
// Field names are 1-to-1 with the JSON — the API already uses camelCase, so no
// CodingKeys remapping is needed. Key subtleties:
//   • ItemDTO.source  — the JSON key IS "source" (maps from DB `podcast_name`; not "podcastName")
//   • ItemDTO.videoId — only non-nil for youtube items (from sourceMetadata.videoId)
//   • SourceDTO.source — alias for podcastName, added by toSourceDTO(); BOTH fields are present
//   • SourceDTO.kind   — discriminator computed from isHighlight/isWeb; "item"|"highlight"|"web"
//   • POST /api/highlights returns RawHighlight (not HighlightDTO); no `item` or `jumpHref`

import Foundation

// MARK: - Enumerations

public enum ItemType: String, Codable {
    case podcast
    case youtube
    case article
}

public enum ItemStatus: String, Codable {
    case processing
    case transcribing
    case analyzing
    case ready
    case failed
}

public enum ItemReadState: String, Codable {
    case unread
    case read
    case archived
}

public enum HighlightKind: String, Codable {
    case transcript
    case takeaway
    case quote
    case article
    case kindle
}

public enum SourceKind: String, Codable {
    case item
    case highlight
    case web
}

// MARK: - ItemDTO

public struct ItemDTO: Codable {
    public let id: String
    public let type: ItemType
    public let title: String
    /// Show / channel / author name. JSON key is "source" (maps from DB `podcast_name`).
    public let source: String?
    public let audioUrl: String?
    public let sourceUrl: String?
    public let artworkUrl: String?
    /// Duration in seconds; nil if unknown.
    public let durationSec: Int?
    /// Original publish date. Nil if unavailable.
    public let publishedAt: Date?
    /// When the item was added to the library.
    public let createdAt: Date
    public let status: ItemStatus
    /// YouTube video ID (from sourceMetadata.videoId). Nil for podcasts and articles.
    public let videoId: String?
    public let readState: ItemReadState
    public let updatedAt: Date
}

// MARK: - HighlightDTO

/// Minimal item snapshot embedded inside HighlightDTO.
public struct HighlightItemRef: Codable {
    public let id: String
    public let type: ItemType
    public let title: String
    /// Show / channel / author name (same "source" key as ItemDTO).
    public let source: String?
    public let artworkUrl: String?
}

public struct HighlightDTO: Codable {
    public let id: String
    public let kind: HighlightKind
    public let text: String
    public let note: String?
    public let createdAt: Date
    public let updatedAt: Date
    public let item: HighlightItemRef
    /// Relative URL for deep-linking in the web app (e.g. `/items/{id}?t=120`).
    public let jumpHref: String
}

// MARK: - SourceDTO

/// Cited source returned by /api/answer.
/// Additive over SourceInput: all input fields are present plus `kind` (discriminator)
/// and `source` (alias for podcastName). Both `source` and `podcastName` carry the same value.
public struct SourceDTO: Codable {
    /// Discriminator: "item" | "highlight" | "web".
    public let kind: SourceKind
    /// Alias for podcastName; always present (may be nil when podcastName is nil).
    public let source: String?
    public let itemId: String
    public let itemTitle: String
    public let startSec: Double
    public let podcastName: String?
    public let artworkUrl: String?
    public let audioUrl: String?
    public let videoId: String?
    /// URL for web sources (kind == .web).
    public let url: String?
    public let snippet: String?
    public let content: String?
    public let isHighlight: Bool?
    public let isWeb: Bool?

    public init(
        kind: SourceKind,
        source: String?,
        itemId: String,
        itemTitle: String,
        startSec: Double,
        podcastName: String?,
        artworkUrl: String?,
        audioUrl: String?,
        videoId: String?,
        url: String?,
        snippet: String?,
        content: String?,
        isHighlight: Bool?,
        isWeb: Bool?
    ) {
        self.kind = kind
        self.source = source
        self.itemId = itemId
        self.itemTitle = itemTitle
        self.startSec = startSec
        self.podcastName = podcastName
        self.artworkUrl = artworkUrl
        self.audioUrl = audioUrl
        self.videoId = videoId
        self.url = url
        self.snippet = snippet
        self.content = content
        self.isHighlight = isHighlight
        self.isWeb = isWeb
    }
}

// MARK: - TranscriptDTO

public struct TranscriptWord: Codable {
    public let start: Double
    public let end: Double
    public let word: String
}

public struct TranscriptSegment: Codable {
    public let start: Double
    public let end: Double
    public let text: String
    /// Per-word timing; present for YouTube items only.
    public let words: [TranscriptWord]?
}

public struct TranscriptDTO: Codable {
    public let fullText: String
    /// Empty array when segments are unavailable (never nil).
    public let segments: [TranscriptSegment]
    /// HTML-rendered transcript for articles; nil for audio/video items.
    public let contentHtml: String?
}

// MARK: - InsightsDTO

public struct Chapter: Codable {
    public let title: String
    public let startSec: Double
}

public struct Quote: Codable {
    public let text: String
    public let approxTimestampSec: Double
}

/// Raw entity mention from the LLM analysis pass (stored in insights.entities JSONB).
/// Distinct from MentionedEntity (enriched records from the entities table).
public struct InsightEntityMention: Codable {
    public let name: String
    public let type: String
    public let context: String?
    public let approxTimestampSec: Double?
}

/// AI-generated analysis row from the `insights` table.
public struct InsightsDTO: Codable {
    public let id: String
    public let itemId: String
    public let summary: String?
    public let takeaways: [String]?
    public let topics: [String]?
    public let chapters: [Chapter]?
    public let quotes: [Quote]?
    /// Raw entity mentions from the LLM. NOT the same as ItemDetail.entities (enriched records).
    public let entities: [InsightEntityMention]?
}

// MARK: - MentionedEntity

public struct EntityMetadata: Codable {
    public let author: String?
    public let publishedYear: Int?
}

/// Enriched entity record from the `entities` table, as linked to a specific item.
/// Returned in ItemDetail.entities (not to be confused with InsightsDTO.entities).
public struct MentionedEntity: Codable {
    public let id: String
    public let name: String
    /// URL-safe unique identifier (e.g. "alan-turing").
    public let slug: String
    /// EntityType string: "person" | "company" | "book" | "product" | "place" | "other"
    public let type: String
    public let description: String?
    public let imageUrl: String?
    public let metadata: EntityMetadata?
    /// Sentence from the item where this entity is mentioned.
    public let context: String?
    /// Approximate timestamp (seconds) of the mention within the item.
    public let approxTimestampSec: Int?
    /// Library-wide count of items mentioning this entity.
    public let mentionCount: Int
}

/// Entity card returned alongside answers by /api/answer.
public struct EntitySearchResult: Codable {
    public let id: String
    public let name: String
    public let slug: String
    public let type: String
    public let description: String?
    public let imageUrl: String?
    public let mentionCount: Int
}

// MARK: - ItemDetail

/// Full bundle returned by GET /api/items/{id}.
public struct ItemDetail: Codable {
    public let item: ItemDTO
    /// Nil until the item has been transcribed.
    public let transcript: TranscriptDTO?
    /// Nil until the analysis pipeline completes.
    public let insights: InsightsDTO?
    /// Enriched entity records linked to this item.
    public let entities: [MentionedEntity]
    public let highlights: [HighlightDTO]
}

// MARK: - Sync

/// Tombstone record for incremental sync.
public struct Deletion: Codable {
    /// "item" or "highlight".
    public let type: String
    /// ID of the deleted entity.
    public let id: String
}

public struct SyncResponse: Codable {
    /// Items updated (created or modified) since `since`.
    public let items: [ItemDTO]
    /// Highlights updated since `since`.
    public let highlights: [HighlightDTO]
    public let deletions: [Deletion]
    /// DB-clock timestamp; use as `since` on the next sync call (never use the client clock).
    public let syncedAt: Date
}

// MARK: - Library Search

/// A relevant transcript chunk returned by POST /api/library/search.
public struct SearchMoment: Codable {
    public let chunkId: String
    public let itemId: String
    public let itemTitle: String
    public let podcastName: String?
    public let artworkUrl: String?
    public let audioUrl: String?
    public let videoId: String?
    /// Matching transcript chunk text (~600 tokens).
    public let content: String
    /// Refined start timestamp within the item (seconds).
    public let startSec: Int
    /// End of the chunk window (seconds).
    public let endSec: Int
    // Note: the API also returns a `similarity` RRF score, but as a Postgres numeric
    // *string* (e.g. "0.0304…"), not a JSON number. Clients don't need it and moments
    // arrive pre-sorted by it, so it's intentionally omitted — Codable ignores the extra key.
}

// MARK: - Raw Highlight (POST /api/highlights response)

/// Position locator within the item. All fields optional; which fields are set depends on `kind`.
public struct HighlightLocator: Codable {
    /// Audio/video timestamp (seconds). Used by `transcript` and `quote` kinds.
    public let sec: Double?
    public let segmentStart: Double?
    /// Zero-based index within takeaways/quotes lists.
    public let index: Int?
    public let charStart: Int?
    public let charEnd: Int?
    /// Kindle location string (for `kindle` kind).
    public let location: String?

    public init(
        sec: Double? = nil,
        segmentStart: Double? = nil,
        index: Int? = nil,
        charStart: Int? = nil,
        charEnd: Int? = nil,
        location: String? = nil
    ) {
        self.sec = sec
        self.segmentStart = segmentStart
        self.index = index
        self.charStart = charStart
        self.charEnd = charEnd
        self.location = location
    }
}

/// Raw DB row returned by POST /api/highlights (drizzle .returning()).
/// Unlike HighlightDTO, this does NOT include `item` or `jumpHref`.
/// The `embedding` field (1536-element pgvector) is present but typically ignored by clients.
/// Refetch from GET /api/highlights?itemId= to get full HighlightDTO objects.
public struct RawHighlight: Codable {
    public let id: String
    public let itemId: String
    public let kind: HighlightKind
    public let text: String
    public let note: String?
    public let locator: HighlightLocator?
    /// 1536-element pgvector embedding. Large; typically ignored by clients.
    public let embedding: [Double]?
    public let createdAt: Date
    public let updatedAt: Date
}

// MARK: - Conversations

public struct ConversationRow: Codable {
    public let id: String
    /// Nil for library-wide conversations.
    public let itemId: String?
    /// Defaults to "New chat"; auto-updated from first message.
    public let title: String
    public let createdAt: Date
    public let updatedAt: Date
}

public struct MessageRow: Codable {
    public let id: String
    public let conversationId: String
    /// "user" or "assistant"
    public let role: String
    public let content: String
    /// Sources cited in assistant messages (mapped through toSourceDTO — includes `kind` and `source`).
    public let sources: [SourceDTO]?
    public let createdAt: Date
}

public struct ConversationDetail: Codable {
    public let conversation: ConversationRow
    /// Messages in chronological order.
    public let messages: [MessageRow]
}

// MARK: - Input / Response types for FluxClient

/// Input for adding a podcast episode using explicit metadata (iTunes-driven flow).
public struct PodcastItemInput: Encodable {
    public let type: String = "podcast"
    public let title: String
    public let audioUrl: String
    public let podcastName: String?
    public let sourceUrl: String?
    public let artworkUrl: String?
    /// ISO 8601 string (e.g. "2024-01-15T00:00:00Z").
    public let publishedAt: String?
    public let durationSec: Int?
    public let episodeGuid: String?
    public let itunesCollectionId: Int?
    public let itunesTrackId: Int?

    public init(
        title: String,
        audioUrl: String,
        podcastName: String? = nil,
        sourceUrl: String? = nil,
        artworkUrl: String? = nil,
        publishedAt: String? = nil,
        durationSec: Int? = nil,
        episodeGuid: String? = nil,
        itunesCollectionId: Int? = nil,
        itunesTrackId: Int? = nil
    ) {
        self.title = title
        self.audioUrl = audioUrl
        self.podcastName = podcastName
        self.sourceUrl = sourceUrl
        self.artworkUrl = artworkUrl
        self.publishedAt = publishedAt
        self.durationSec = durationSec
        self.episodeGuid = episodeGuid
        self.itunesCollectionId = itunesCollectionId
        self.itunesTrackId = itunesTrackId
    }
}

/// Response from POST /api/answer.
public struct AskResponse: Decodable {
    /// Generated answer text; nil if no sources were found or query was too short.
    public let answer: String?
    /// Cited sources in citation order ([1], [2], … matching inline citations in `answer`).
    public let sources: [SourceDTO]
    /// Entity cards matching the query.
    public let entities: [EntitySearchResult]
}

/// Response from POST /api/library/search.
public struct SearchResponse: Decodable {
    /// Matching items (up to 6).
    public let items: [ItemDTO]
    /// Matching transcript moments (up to 6).
    public let moments: [SearchMoment]
}
