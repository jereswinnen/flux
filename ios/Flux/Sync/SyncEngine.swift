import Foundation
import Observation
import SwiftData
import FluxAPI

// Shared Codable payload for "setReadState" outbox entries.
// Top-level (not nested) so LibraryView can reference it for JSONEncoder encoding.
struct ReadStatePayload: Codable {
    let id: String
    let readState: String
}

@MainActor @Observable
final class SyncEngine {
    private let context: ModelContext
    private let config: AppConfig

    var isSyncing = false
    var lastError: String?

    init(context: ModelContext, config: AppConfig) {
        self.context = context
        self.config = config
    }

    // MARK: - Cursor

    private var cursor: Date? {
        get { UserDefaults.standard.object(forKey: "syncCursor") as? Date }
        set { UserDefaults.standard.set(newValue, forKey: "syncCursor") }
    }

    // MARK: - Sync

    func sync() async {
        guard let client = config.makeClient(), !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            try await flushOutbox(client)
            let res = try await client.sync(since: cursor)
            for dto in res.items { upsertItem(dto) }
            for dto in res.highlights { upsertHighlight(dto) }
            for del in res.deletions { applyDeletion(del) }
            try context.save()
            cursor = res.syncedAt
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: - Upsert helpers

    private func upsertItem(_ dto: ItemDTO) {
        let id = dto.id
        let existing = try? context.fetch(
            FetchDescriptor<Item>(predicate: #Predicate { $0.id == id })
        ).first
        if let item = existing {
            item.apply(dto)
        } else {
            context.insert(Item(from: dto))
        }
    }

    private func upsertHighlight(_ dto: HighlightDTO) {
        let id = dto.id
        let existing = try? context.fetch(
            FetchDescriptor<Highlight>(predicate: #Predicate { $0.id == id })
        ).first
        if let highlight = existing {
            highlight.apply(dto)
        } else {
            context.insert(Highlight(from: dto))
        }
    }

    private func applyDeletion(_ del: Deletion) {
        let id = del.id
        if del.type == "item" {
            // Delete the item itself
            let items = (try? context.fetch(
                FetchDescriptor<Item>(predicate: #Predicate { $0.id == id })
            )) ?? []
            items.forEach(context.delete)
            // Cascade-delete associated highlights
            let highlights = (try? context.fetch(
                FetchDescriptor<Highlight>(predicate: #Predicate { $0.itemId == id })
            )) ?? []
            highlights.forEach(context.delete)
        } else if del.type == "highlight" {
            let highlights = (try? context.fetch(
                FetchDescriptor<Highlight>(predicate: #Predicate { $0.id == id })
            )) ?? []
            highlights.forEach(context.delete)
        }
    }

    // MARK: - Outbox flush

    func flushOutbox(_ client: FluxClient) async throws {
        let pending = (try? context.fetch(
            FetchDescriptor<PendingChange>(sortBy: [SortDescriptor(\.createdAt)])
        )) ?? []

        for change in pending {
            switch change.kind {
            case "setReadState":
                if let p = decode(change.payloadJSON, as: ReadStatePayload.self),
                   let state = ItemReadState(rawValue: p.readState) {
                    _ = try await client.setReadState(id: p.id, state)
                }
            // P2: createHighlight, deleteHighlight, updateNote
            default:
                break
            }
            context.delete(change)
        }
        if !pending.isEmpty {
            try context.save()
        }
    }

    // MARK: - Helpers

    private func decode<T: Decodable>(_ json: String, as type: T.Type) -> T? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
