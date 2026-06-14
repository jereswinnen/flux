import SwiftUI
import SwiftData
import FluxAPI

struct SearchView: View {
    @Environment(AppConfig.self) private var config
    @State private var query = ""
    @State private var items: [ItemDTO] = []
    @State private var moments: [SearchMoment] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                if !items.isEmpty {
                    Section("Items") {
                        ForEach(items, id: \.id) { item in
                            NavigationLink(value: ItemRoute(itemId: item.id, seekSec: nil)) {
                                SearchItemRow(title: item.title, source: item.source, artworkUrl: item.artworkUrl)
                            }
                        }
                    }
                }
                if !moments.isEmpty {
                    Section("Moments") {
                        ForEach(moments, id: \.chunkId) { m in
                            NavigationLink(value: ItemRoute(itemId: m.itemId, seekSec: Double(m.startSec))) {
                                MomentRow(moment: m)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .overlay { overlay }
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Search your library")
            .onChange(of: query) { _, q in scheduleSearch(q) }
            .navigationDestination(for: ItemRoute.self) { ItemRouteDestination(route: $0) }
            .navigationDestination(for: EntityRoute.self) { EntityDetailView(slug: $0.slug) }
        }
    }

    @ViewBuilder private var overlay: some View {
        if isSearching {
            ProgressView()
        } else if query.count >= 2 && items.isEmpty && moments.isEmpty {
            ContentUnavailableView.search(text: query)
        } else if query.isEmpty {
            ContentUnavailableView(
                "Search your library",
                systemImage: "magnifyingglass",
                description: Text("Find episodes, videos, articles, and transcript moments.")
            )
        }
    }

    private func scheduleSearch(_ q: String) {
        searchTask?.cancel()
        let trimmed = q.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2, let client = config.makeClient() else {
            items = []; moments = []; isSearching = false
            return
        }
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))   // debounce
            if Task.isCancelled { return }
            isSearching = true
            defer { isSearching = false }
            do {
                let res = try await client.search(query: trimmed)
                if Task.isCancelled { return }
                items = res.items
                moments = res.moments
            } catch {
                if !Task.isCancelled { items = []; moments = [] }
            }
        }
    }
}

private struct SearchItemRow: View {
    let title: String
    let source: String?
    let artworkUrl: String?
    var body: some View {
        HStack(spacing: 10) {
            Artwork(url: artworkUrl, size: 40, cornerRadius: 6)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body).lineLimit(2)
                if let source { Text(source).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
    }
}

private struct MomentRow: View {
    let moment: SearchMoment
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(moment.itemTitle).font(.caption.bold()).foregroundStyle(.secondary).lineLimit(1)
            Text(moment.content).font(.callout).lineLimit(3)
            Text(timeString(Double(moment.startSec))).font(.caption2.monospacedDigit()).foregroundStyle(.tint)
        }
        .padding(.vertical, 2)
    }
}
