import SwiftUI
import FluxAPI

struct AskView: View {
    @Environment(AppConfig.self) private var config
    @State private var conversations: [ConversationRow] = []
    @State private var loading = false
    @State private var error: String?
    @State private var path: [String] = []   // conversation ids

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
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Ask")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await startNew() } } label: { Image(systemName: "square.and.pencil") }
                }
            }
            .overlay { if loading { ProgressView() } }
            .refreshable { await load() }
            .task { await load() }
            .navigationDestination(for: String.self) { id in
                ConversationView(conversationId: id, scopedItemId: nil)
            }
            .navigationDestination(for: ItemRoute.self) { ItemRouteDestination(route: $0) }
        }
    }

    private func load() async {
        guard let client = config.makeClient() else { return }
        loading = true
        defer { loading = false }
        do { conversations = try await client.conversations(); error = nil }
        catch { self.error = error.localizedDescription }
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
