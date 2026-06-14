import SwiftUI
import SwiftData
import UIKit
import FluxAPI

struct ArticleReaderView: View {
    let item: Item
    let contentHtml: String

    @Environment(\.modelContext) private var context
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @Query private var highlights: [Highlight]
    @State private var pendingDelete: Highlight?
    /// Built off the navigation transition so pushing into the article is instant; the
    /// (main-thread, WebKit-backed) HTML conversion runs once the ProgressView has painted.
    @State private var attributed: NSAttributedString?

    init(item: Item, contentHtml: String) {
        self.item = item
        self.contentHtml = contentHtml
        let id = item.id
        _highlights = Query(filter: #Predicate<Highlight> { $0.itemId == id && $0.kind == "article" })
    }

    var body: some View {
        Group {
            if let attributed {
                HTMLTextView(
                    attributed: attributed,
                    highlights: highlights.map { (id: $0.id, text: $0.text, charStart: $0.charStart, charEnd: $0.charEnd) },
                    onTapHighlight: { id in pendingDelete = highlights.first { $0.id == id } },
                    onCreateHighlight: { selected, range in createHighlight(selected, range) }
                )
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
            }
        }
        .task(id: contentHtml) {
            await Task.yield()   // let the ProgressView paint before the synchronous convert
            attributed = Self.render(contentHtml)
        }
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

    private func createHighlight(_ selected: String, _ range: NSRange) {
        // Trim whitespace and shift the range to match the trimmed text, so the stored
        // char offsets line up with the server-trimmed `text` (NSRange is UTF-16-based).
        let leadingWS = selected.prefix { $0.isWhitespace || $0.isNewline }.utf16.count
        let trimmed = selected.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let start = range.location + leadingWS
        let end = start + trimmed.utf16.count
        HighlightStore.create(
            in: context, item: item, kind: .article, text: trimmed,
            locator: HighlightLocator(charStart: start, charEnd: end)
        )
        Task { await sync?.sync() }
    }

    /// Convert sanitized HTML to a styled attributed string (serif body, label color, spacing).
    @MainActor private static func render(_ html: String) -> NSAttributedString {
        let data = Data(html.utf8)
        let base = (try? NSAttributedString(
            data: data,
            options: [
                .documentType: NSAttributedString.DocumentType.html,
                .characterEncoding: String.Encoding.utf8.rawValue
            ],
            documentAttributes: nil
        )) ?? NSAttributedString(string: html)

        let styled = NSMutableAttributedString(attributedString: base)
        let full = NSRange(location: 0, length: styled.length)
        let body = UIFont.preferredFont(forTextStyle: .body)
        let serif = UIFont(descriptor: body.fontDescriptor.withDesign(.serif) ?? body.fontDescriptor, size: body.pointSize)
        let para = NSMutableParagraphStyle()
        para.lineSpacing = 4
        para.paragraphSpacing = 12
        styled.addAttribute(.font, value: serif, range: full)
        styled.addAttribute(.foregroundColor, value: UIColor.label, range: full)
        styled.addAttribute(.paragraphStyle, value: para, range: full)
        return styled
    }
}
