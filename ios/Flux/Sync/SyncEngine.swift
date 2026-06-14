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

struct CreateHighlightPayload: Codable {
    let tempId: String       // the optimistic local Highlight.id
    let itemId: String
    let kind: String
    let text: String
    let note: String?
    let locator: HighlightLocator?
}

struct DeleteHighlightPayload: Codable {
    let id: String
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
                guard let p = decode(change.payloadJSON, as: ReadStatePayload.self),
                      let state = ItemReadState(rawValue: p.readState) else { break }
                _ = try await client.setReadState(id: p.id, state)

            case "createHighlight":
                guard let p = decode(change.payloadJSON, as: CreateHighlightPayload.self),
                      let kind = HighlightKind(rawValue: p.kind) else { break }
                let raw = try await client.createHighlight(
                    itemId: p.itemId, kind: kind, text: p.text,
                    note: p.note, locator: p.locator
                )
                reconcileCreatedHighlight(tempId: p.tempId, serverId: raw.id)

            case "deleteHighlight":
                guard let p = decode(change.payloadJSON, as: DeleteHighlightPayload.self) else { break }
                try await client.deleteHighlight(id: p.id)

            default:
                break
            }
            // Reached only when the API call above succeeded. Save immediately so a later
            // failure (which exits the loop) can't cause this already-sent, non-idempotent
            // change (e.g. createHighlight) to be re-sent — and re-duplicated — next launch.
            context.delete(change)
            try context.save()
        }
    }

    /// Re-key an optimistic highlight from its temp id to the server-assigned id,
    /// so the next delta-sync upsert matches it instead of inserting a duplicate.
    private func reconcileCreatedHighlight(tempId: String, serverId: String) {
        let existing = try? context.fetch(
            FetchDescriptor<Highlight>(predicate: #Predicate { $0.id == tempId })
        ).first
        existing?.id = serverId
    }

    // MARK: - Helpers

    private func decode<T: Decodable>(_ json: String, as type: T.Type) -> T? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
