import Foundation
import SwiftData
import FluxAPI

/// Optimistic, offline-first highlight create/delete against the local SwiftData store + outbox.
/// The next `SyncEngine.sync()` flushes the outbox; callers may trigger an immediate sync for snappiness.
@MainActor
enum HighlightStore {
    /// Create a highlight optimistically. Returns the temp id of the local row.
    @discardableResult
    static func create(
        in context: ModelContext,
        item: Item,
        kind: HighlightKind,
        text: String,
        note: String? = nil,
        locator: HighlightLocator? = nil
    ) -> String {
        let tempId = "temp-" + UUID().uuidString
        let now = Date()
        let local = Highlight(
            id: tempId, itemId: item.id, kind: kind.rawValue, text: text, note: note,
            createdAt: now, updatedAt: now, jumpHref: "/items/\(item.id)",
            itemTitle: item.title, itemSource: item.source, itemArtworkUrl: item.artworkUrl,
            itemType: item.type, charStart: locator?.charStart, charEnd: locator?.charEnd
        )
        context.insert(local)
        let payload = CreateHighlightPayload(
            tempId: tempId, itemId: item.id, kind: kind.rawValue,
            text: text, note: note, locator: locator
        )
        enqueue(in: context, kind: "createHighlight", payload: payload)
        try? context.save()
        return tempId
    }

    /// Delete a highlight optimistically. If it was never synced (temp id), just drop the
    /// queued create instead of sending a delete for an id the server never saw.
    static func delete(in context: ModelContext, highlight: Highlight) {
        let id = highlight.id
        context.delete(highlight)
        if id.hasPrefix("temp-") {
            dropPendingCreate(in: context, tempId: id)
        } else {
            enqueue(in: context, kind: "deleteHighlight", payload: DeleteHighlightPayload(id: id))
        }
        try? context.save()
    }

    private static func enqueue<T: Encodable>(in context: ModelContext, kind: String, payload: T) {
        guard let data = try? JSONEncoder().encode(payload),
              let json = String(data: data, encoding: .utf8) else { return }
        context.insert(PendingChange(kind: kind, payloadJSON: json))
    }

    private static func dropPendingCreate(in context: ModelContext, tempId: String) {
        let pending = (try? context.fetch(
            FetchDescriptor<PendingChange>(predicate: #Predicate { $0.kind == "createHighlight" })
        )) ?? []
        for change in pending where change.payloadJSON.contains(tempId) {
            context.delete(change)
        }
    }
}
