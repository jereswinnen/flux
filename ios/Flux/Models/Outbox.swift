import Foundation
import SwiftData

@Model
final class PendingChange {
    @Attribute(.unique) var id: UUID
    /// "setReadState" | "createHighlight" | "deleteHighlight"
    var kind: String
    var payloadJSON: String
    var createdAt: Date

    init(kind: String, payloadJSON: String) {
        id = UUID()
        self.kind = kind
        self.payloadJSON = payloadJSON
        createdAt = Date()
    }
}
