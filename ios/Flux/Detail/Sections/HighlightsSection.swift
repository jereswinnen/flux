import SwiftUI
import SwiftData
import FluxAPI

struct HighlightsSection: View {
    let itemId: String

    @Environment(\.modelContext) private var context
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @Query private var highlights: [Highlight]

    init(itemId: String) {
        self.itemId = itemId
        _highlights = Query(
            filter: #Predicate<Highlight> { $0.itemId == itemId },
            sort: \Highlight.createdAt, order: .reverse
        )
    }

    var body: some View {
        if !highlights.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Highlights").font(.headline)
                ForEach(highlights, id: \.id) { hl in
                    HStack(alignment: .top, spacing: 8) {
                        Rectangle().frame(width: 3).foregroundStyle(.yellow)
                        Text(hl.text).font(.callout)
                        Spacer(minLength: 0)
                        Button(role: .destructive) {
                            HighlightStore.delete(in: context, highlight: hl)
                            Task { await sync?.sync() }
                        } label: {
                            Image(systemName: "trash").font(.caption)
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
        }
    }
}
