import Foundation
import SwiftData
import FluxAPI

@Model
final class Item {
    @Attribute(.unique) var id: String
    var type: String
    var title: String
    var source: String?
    var audioUrl: String?
    var sourceUrl: String?
    var artworkUrl: String?
    var durationSec: Int?
    var publishedAt: Date?
    var createdAt: Date
    var updatedAt: Date
    var status: String
    var videoId: String?
    var readState: String

    init(from dto: ItemDTO) {
        id = dto.id
        type = dto.type.rawValue
        title = dto.title
        source = dto.source
        audioUrl = dto.audioUrl
        sourceUrl = dto.sourceUrl
        artworkUrl = dto.artworkUrl
        durationSec = dto.durationSec
        publishedAt = dto.publishedAt
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
        status = dto.status.rawValue
        videoId = dto.videoId
        readState = dto.readState.rawValue
    }

    func apply(_ dto: ItemDTO) {
        type = dto.type.rawValue
        title = dto.title
        source = dto.source
        audioUrl = dto.audioUrl
        sourceUrl = dto.sourceUrl
        artworkUrl = dto.artworkUrl
        durationSec = dto.durationSec
        publishedAt = dto.publishedAt
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
        status = dto.status.rawValue
        videoId = dto.videoId
        readState = dto.readState.rawValue
    }
}
