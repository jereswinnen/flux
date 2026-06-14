import SwiftUI
import SwiftData

struct HighlightsView: View {
    @State private var typeFilter: String? = nil
    @State private var searchText = ""

    var body: some View {
        NavigationStack {
            HighlightsList(typeFilter: typeFilter, searchText: searchText)
                .navigationTitle("Highlights")
                .searchable(text: $searchText, prompt: "Search highlights")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            typeButton("All", value: nil)
                            typeButton("Podcasts", value: "podcast")
                            typeButton("Videos", value: "youtube")
                            typeButton("Articles", value: "article")
                        } label: {
                            Label("Filter", systemImage: typeFilter == nil
                                ? "line.3.horizontal.decrease.circle"
                                : "line.3.horizontal.decrease.circle.fill")
                        }
                    }
                }
                .navigationDestination(for: ItemRoute.self) { ItemRouteDestination(route: $0) }
                .navigationDestination(for: EntityRoute.self) { EntityDetailView(slug: $0.slug) }
        }
    }

    @ViewBuilder private func typeButton(_ label: String, value: String?) -> some View {
        Button { typeFilter = value } label: {
            if typeFilter == value { Label(label, systemImage: "checkmark") } else { Text(label) }
        }
    }
}

private struct HighlightsList: View {
    @Query private var highlights: [Highlight]

    init(typeFilter: String?, searchText: String) {
        let sort = [SortDescriptor(\Highlight.createdAt, order: .reverse)]
        let q = searchText
        if let type = typeFilter, !q.isEmpty {
            _highlights = Query(filter: #Predicate<Highlight> {
                $0.itemType == type && ($0.text.localizedStandardContains(q) || ($0.note ?? "").localizedStandardContains(q))
            }, sort: sort)
        } else if let type = typeFilter {
            _highlights = Query(filter: #Predicate<Highlight> { $0.itemType == type }, sort: sort)
        } else if !q.isEmpty {
            _highlights = Query(filter: #Predicate<Highlight> {
                $0.text.localizedStandardContains(q) || ($0.note ?? "").localizedStandardContains(q)
            }, sort: sort)
        } else {
            _highlights = Query(sort: sort)
        }
    }

    var body: some View {
        List(highlights, id: \.id) { hl in
            NavigationLink(value: ItemRoute(itemId: hl.itemId, seekSec: seekSeconds(hl))) {
                HighlightRow(highlight: hl)
            }
        }
        .listStyle(.plain)
        .overlay {
            if highlights.isEmpty {
                ContentUnavailableView(
                    "No highlights yet",
                    systemImage: "highlighter",
                    description: Text("Highlight text while reading or listening; they show up here.")
                )
            }
        }
    }

    /// Derive a seek target from the highlight's jumpHref (`/items/{id}?t={sec}`), if present.
    private func seekSeconds(_ hl: Highlight) -> Double? {
        guard let comps = URLComponents(string: hl.jumpHref),
              let t = comps.queryItems?.first(where: { $0.name == "t" })?.value else { return nil }
        return Double(t)
    }
}

private struct HighlightRow: View {
    let highlight: Highlight

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Rectangle().frame(width: 3).foregroundStyle(.yellow)
            VStack(alignment: .leading, spacing: 6) {
                Text(highlight.text).font(.callout).lineLimit(4)
                HStack(spacing: 6) {
                    Artwork(url: highlight.itemArtworkUrl, size: 18, cornerRadius: 4)
                    Text(highlight.itemTitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
