import SwiftUI
import FluxAPI

struct AskView: View {
    @Environment(AppConfig.self) private var config
    @State private var conversations: [ConversationRow] = []
    @State private var loading = false
    @State private var error: String?
    @State private var path: [String] = []   // conversation ids
    @State private var renaming: ConversationRow?
    @State private var renameText = ""

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if conversations.isEmpty && !loading {
                    ContentUnavailableView(
                        "Ask anything",
                        systemImage: "sparkles",
                        description: Text(error ?? "Ask questions across your whole library.")
                    )
                } else {
                    List(conversations, id: \.id) { convo in
                        NavigationLink(value: convo.id) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(convo.title).font(.body).lineLimit(1)
                                Text(convo.updatedAt, style: .relative).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { Task { await delete(convo) } } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button { renaming = convo; renameText = convo.title } label: {
                                Label("Rename", systemImage: "pencil")
                            }
                            .tint(.blue)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Ask")
            .alert("Rename conversation", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }), presenting: renaming) { convo in
                TextField("Title", text: $renameText)
                Button("Save") { Task { await rename(convo, to: renameText) } }
                Button("Cancel", role: .cancel) {}
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await startNew() } } label: { Image(systemName: "square.and.pencil") }
                        .accessibilityLabel("New conversation")
                }
            }
            .overlay { if loading { ProgressView() } }
            .refreshable { await load() }
            .task { await load() }
            .navigationDestination(for: String.self) { id in
                ConversationView(conversationId: id, scopedItemId: nil)
            }
            .navigationDestination(for: ItemRoute.self) { ItemRouteDestination(route: $0) }
            .navigationDestination(for: EntityRoute.self) { EntityDetailView(slug: $0.slug) }
        }
    }

    private func load() async {
        guard let client = config.makeClient() else { return }
        loading = true
        defer { loading = false }
        do { conversations = try await client.conversations(); error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func delete(_ convo: ConversationRow) async {
        guard let client = config.makeClient() else { return }
        try? await client.deleteConversation(id: convo.id)
        conversations.removeAll { $0.id == convo.id }
    }

    private func rename(_ convo: ConversationRow, to title: String) async {
        let t = title.trimmingCharacters(in: .whitespaces)
        renaming = nil
        guard !t.isEmpty, let client = config.makeClient() else { return }
        try? await client.renameConversation(id: convo.id, title: t)
        await load()
    }

    private func startNew() async {
        guard let client = config.makeClient() else { return }
        do {
            let convo = try await client.createConversation()
            conversations.insert(convo, at: 0)
            path.append(convo.id)
        } catch { self.error = error.localizedDescription }
    }
}
