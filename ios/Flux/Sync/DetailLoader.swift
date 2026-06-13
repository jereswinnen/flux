import Foundation
import Observation
import SwiftData
import FluxAPI

@MainActor @Observable
final class DetailLoader {
    private let context: ModelContext
    private let config: AppConfig

    /// Item ids whose detail fetch is currently in flight (drives per-item spinners).
    var loading: Set<String> = []
    var lastError: String?

    init(context: ModelContext, config: AppConfig) {
        self.context = context
        self.config = config
    }

    /// Fetch + cache the detail bundle. Safe to call repeatedly; the view shows any
    /// existing cache immediately, and this refreshes it in the background.
    func load(itemId: String) async {
        guard let client = config.makeClient(), !loading.contains(itemId) else { return }
        loading.insert(itemId)
        defer { loading.remove(itemId) }
        do {
            let detail = try await client.item(id: itemId)
            upsertCache(itemId: itemId, detail: detail)
            for dto in detail.highlights { upsertHighlight(dto) }
            try context.save()
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func upsertCache(itemId: String, detail: ItemDetail) {
        let enc = JSONEncoder()
        func encode<T: Encodable>(_ value: T?) -> String? {
            guard let value, let data = try? enc.encode(value) else { return nil }
            return String(data: data, encoding: .utf8)
        }
        let contentHtml = detail.transcript?.contentHtml
        let transcriptJSON = encode(detail.transcript)
        let insightsJSON = encode(detail.insights)
        let entitiesJSON = encode(detail.entities)

        let existing = try? context.fetch(
            FetchDescriptor<ItemDetailCache>(predicate: #Predicate { $0.itemId == itemId })
        ).first
        if let row = existing {
            row.contentHtml = contentHtml
            row.transcriptJSON = transcriptJSON
            row.insightsJSON = insightsJSON
            row.entitiesJSON = entitiesJSON
            row.fetchedAt = Date()
        } else {
            context.insert(ItemDetailCache(
                itemId: itemId,
                contentHtml: contentHtml,
                transcriptJSON: transcriptJSON,
                insightsJSON: insightsJSON,
                entitiesJSON: entitiesJSON,
                fetchedAt: Date()
            ))
        }
    }

    private func upsertHighlight(_ dto: HighlightDTO) {
        let id = dto.id
        let existing = try? context.fetch(
            FetchDescriptor<Highlight>(predicate: #Predicate { $0.id == id })
        ).first
        if let h = existing { h.apply(dto) } else { context.insert(Highlight(from: dto)) }
    }
}
