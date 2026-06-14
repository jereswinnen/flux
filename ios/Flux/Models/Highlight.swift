import Foundation
import SwiftData
import FluxAPI

@Model
final class Highlight {
    @Attribute(.unique) var id: String
    var itemId: String
    var kind: String
    var text: String
    var note: String?
    var createdAt: Date
    var updatedAt: Date
    var jumpHref: String
    // Denormalized from HighlightDTO.item (HighlightItemRef) so the list renders without a join
    var itemTitle: String
    var itemSource: String?
    var itemArtworkUrl: String?
    // Default enables SwiftData lightweight migration for stores created before P3;
    // existing rows re-sync and get the real value.
    var itemType: String = ""
    // Article-highlight anchor: character offsets into the rendered reader text. Nil for
    // other kinds / unanchored highlights (then display falls back to text-match).
    var charStart: Int?
    var charEnd: Int?

    init(
        id: String, itemId: String, kind: String, text: String, note: String?,
        createdAt: Date, updatedAt: Date, jumpHref: String,
        itemTitle: String, itemSource: String?, itemArtworkUrl: String?, itemType: String,
        charStart: Int? = nil, charEnd: Int? = nil
    ) {
        self.id = id
        self.itemId = itemId
        self.kind = kind
        self.text = text
        self.note = note
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.jumpHref = jumpHref
        self.itemTitle = itemTitle
        self.itemSource = itemSource
        self.itemArtworkUrl = itemArtworkUrl
        self.itemType = itemType
        self.charStart = charStart
        self.charEnd = charEnd
    }

    init(from dto: HighlightDTO) {
        id = dto.id
        itemId = dto.item.id
        kind = dto.kind.rawValue
        text = dto.text
        note = dto.note
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
        jumpHref = dto.jumpHref
        itemTitle = dto.item.title
        itemSource = dto.item.source
        itemArtworkUrl = dto.item.artworkUrl
        itemType = dto.item.type.rawValue
        charStart = dto.locator?.charStart
        charEnd = dto.locator?.charEnd
    }

    func apply(_ dto: HighlightDTO) {
        itemId = dto.item.id
        kind = dto.kind.rawValue
        text = dto.text
        note = dto.note
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
        jumpHref = dto.jumpHref
        itemTitle = dto.item.title
        itemSource = dto.item.source
        itemArtworkUrl = dto.item.artworkUrl
        itemType = dto.item.type.rawValue
        charStart = dto.locator?.charStart
        charEnd = dto.locator?.charEnd
    }
}
