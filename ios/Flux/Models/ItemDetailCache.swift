import Foundation
import SwiftData
import FluxAPI

/// On-open cache of an item's full detail bundle (GET /api/items/{id}).
/// Nested DTOs are stored as JSON strings so the SwiftData model stays flat;
/// the decoded accessors rehydrate the typed FluxAPI DTOs.
@Model
final class ItemDetailCache {
    @Attribute(.unique) var itemId: String
    var contentHtml: String?
    var transcriptJSON: String?
    var insightsJSON: String?
    var entitiesJSON: String?
    var fetchedAt: Date

    init(
        itemId: String,
        contentHtml: String?,
        transcriptJSON: String?,
        insightsJSON: String?,
        entitiesJSON: String?,
        fetchedAt: Date
    ) {
        self.itemId = itemId
        self.contentHtml = contentHtml
        self.transcriptJSON = transcriptJSON
        self.insightsJSON = insightsJSON
        self.entitiesJSON = entitiesJSON
        self.fetchedAt = fetchedAt
    }

    // MARK: - Decoded accessors

    var transcript: TranscriptDTO? { Self.decode(transcriptJSON) }
    var insights: InsightsDTO? { Self.decode(insightsJSON) }
    var entities: [MentionedEntity] { Self.decode(entitiesJSON) ?? [] }

    private static func decode<T: Decodable>(_ json: String?) -> T? {
        guard let json, let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
