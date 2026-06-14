import SwiftUI
import SwiftData
import FluxAPI

struct LibraryView: View {
    @Environment(AppConfig.self) private var config
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @State private var typeFilter: String? = nil   // nil = all types
    @State private var unreadOnly = true
    @State private var showingAdd = false

    var body: some View {
        NavigationStack {
            Group {
                if !config.isConfigured {
                    ContentUnavailableView(
                        "Set up your server",
                        systemImage: "gear",
                        description: Text("Add your server URL and API token in Settings.")
                    )
                } else {
                    LibraryList(typeFilter: typeFilter, unreadOnly: unreadOnly)
                }
            }
            .navigationTitle("Library")
            .toolbar {
                filterToolbar
                ToolbarItem(placement: .topBarLeading) {
                    Button { showingAdd = true } label: { Image(systemName: "plus") }
                        .disabled(!config.isConfigured)
                        .accessibilityLabel("Add content")
                }
            }
            .navigationDestination(for: ItemRoute.self) { ItemRouteDestination(route: $0) }
            .navigationDestination(for: EntityRoute.self) { EntityDetailView(slug: $0.slug) }
            .sheet(isPresented: $showingAdd) {
                AddContentView(onAdded: { Task { await sync?.sync() } })
            }
            .refreshable { await sync?.sync() }
            .safeAreaInset(edge: .top) {
                if let error = sync?.lastError {
                    ErrorBanner(message: error)
                }
            }
        }
    }

    @ToolbarContentBuilder
    private var filterToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Section("Type") {
                    typeButton("All", value: nil)
                    typeButton("Podcasts", value: "podcast")
                    typeButton("Videos", value: "youtube")
                    typeButton("Articles", value: "article")
                }
                Section("Read state") {
                    Toggle("Unread only", isOn: $unreadOnly)
                }
            } label: {
                let isFiltered = typeFilter != nil || !unreadOnly
                Label("Filter", systemImage: isFiltered
                    ? "line.3.horizontal.decrease.circle.fill"
                    : "line.3.horizontal.decrease.circle")
            }
        }
    }

    @ViewBuilder
    private func typeButton(_ label: String, value: String?) -> some View {
        Button { typeFilter = value } label: {
            if typeFilter == value {
                Label(label, systemImage: "checkmark")
            } else {
                Text(label)
            }
        }
    }
}

// MARK: - LibraryList

private struct LibraryList: View {
    @Environment(\.modelContext) private var context
    @Query private var items: [Item]

    init(typeFilter: String?, unreadOnly: Bool) {
        let sort = \Item.createdAt
        let order = SortOrder.reverse
        if let type = typeFilter, unreadOnly {
            _items = Query(
                filter: #Predicate<Item> { item in
                    item.type == type && item.readState == "unread"
                },
                sort: sort, order: order
            )
        } else if let type = typeFilter {
            _items = Query(
                filter: #Predicate<Item> { item in
                    item.type == type
                },
                sort: sort, order: order
            )
        } else if unreadOnly {
            _items = Query(
                filter: #Predicate<Item> { item in
                    item.readState == "unread"
                },
                sort: sort, order: order
            )
        } else {
            _items = Query(sort: sort, order: order)
        }
    }

    var body: some View {
        List(items) { item in
            NavigationLink {
                ItemDetailView(item: item)
            } label: {
                ItemRow(item: item)
            }
            .swipeActions(edge: .leading) {
                Button(item.readState == "read" ? "Unread" : "Read") {
                    toggleRead(item)
                }
                .tint(.blue)
            }
            .swipeActions(edge: .trailing) {
                Button("Archive") { archive(item) }
                    .tint(.orange)
            }
        }
        .listStyle(.plain)
        .overlay {
            if items.isEmpty {
                ContentUnavailableView(
                    "Nothing here",
                    systemImage: "tray",
                    description: Text("Pull to refresh, or add items on the web.")
                )
            }
        }
    }

    private func toggleRead(_ item: Item) {
        changeReadState(item, to: item.readState == "read" ? "unread" : "read")
    }

    private func archive(_ item: Item) {
        changeReadState(item, to: "archived")
    }

    private func changeReadState(_ item: Item, to state: String) {
        item.readState = state
        let payload = ReadStatePayload(id: item.id, readState: state)
        if let data = try? JSONEncoder().encode(payload),
           let json = String(data: data, encoding: .utf8) {
            context.insert(PendingChange(kind: "setReadState", payloadJSON: json))
        }
        try? context.save()
    }
}

// MARK: - ItemRow

private struct ItemRow: View {
    let item: Item

    var body: some View {
        HStack(spacing: 12) {
            Artwork(url: item.artworkUrl, size: 44)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.body)
                    .lineLimit(2)
                if let source = item.source {
                    Text(source)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)

            if item.status != "ready" {
                Text(item.status)
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.quaternary, in: Capsule())
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - ErrorBanner

private struct ErrorBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
            Text(message)
                .font(.caption)
                .lineLimit(2)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.red.opacity(0.1))
        .foregroundStyle(.red)
    }
}
