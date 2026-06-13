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
    }
}
