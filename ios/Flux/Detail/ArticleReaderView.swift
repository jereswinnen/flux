import SwiftUI
import SwiftData
import FluxAPI

struct ArticleReaderView: View {
    let item: Item
    let contentHtml: String

    @Environment(\.modelContext) private var context
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @Query private var highlights: [Highlight]
    @State private var pendingDelete: Highlight?

    init(item: Item, contentHtml: String) {
        self.item = item
        self.contentHtml = contentHtml
        let id = item.id
        _highlights = Query(filter: #Predicate<Highlight> { $0.itemId == id && $0.kind == "article" })
    }

    var body: some View {
        HTMLTextView(
            html: contentHtml,
            highlights: highlights.map { (id: $0.id, text: $0.text) },
            onTapHighlight: { id in
                pendingDelete = highlights.first { $0.id == id }
            },
            onCreateHighlight: { text in
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return }
                HighlightStore.create(in: context, item: item, kind: .article, text: trimmed)
                Task { await sync?.sync() }
            }
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .confirmationDialog(
            "Remove highlight?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            presenting: pendingDelete
        ) { hl in
            Button("Remove highlight", role: .destructive) {
                HighlightStore.delete(in: context, highlight: hl)
                pendingDelete = nil
                Task { await sync?.sync() }
            }
        } message: { hl in
            Text(hl.text)
        }
    }
}
