import SwiftUI
import FluxAPI

struct EntitiesSection: View {
    let entities: [MentionedEntity]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Mentioned").font(.headline)
            ForEach(entities, id: \.id) { entity in
                HStack(alignment: .top, spacing: 12) {
                    AsyncImage(url: entity.imageUrl.flatMap(URL.init)) { img in
                        img.resizable().scaledToFill()
                    } placeholder: {
                        Color.secondary.opacity(0.15)
                    }
                    .frame(width: 40, height: 40)
                    .clipShape(RoundedRectangle(cornerRadius: 6))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(entity.name).font(.callout.bold())
                        Text(entity.type).font(.caption2).foregroundStyle(.secondary)
                        if let desc = entity.description, !desc.isEmpty {
                            Text(desc).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
        }
    }
}
