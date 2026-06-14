import SwiftUI
import FluxAPI

struct EntitiesSection: View {
    let entities: [MentionedEntity]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Mentioned").font(.headline)
            ForEach(entities, id: \.id) { entity in
                NavigationLink(value: EntityRoute(slug: entity.slug)) {
                    HStack(alignment: .top, spacing: 12) {
                        Artwork(url: entity.imageUrl, size: 40, cornerRadius: 6)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(entity.name).font(.callout.bold())
                            Text(entity.type).font(.caption2).foregroundStyle(.secondary)
                            if let desc = entity.description, !desc.isEmpty {
                                Text(desc).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }
}
