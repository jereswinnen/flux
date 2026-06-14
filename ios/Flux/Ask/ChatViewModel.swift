import Foundation
import Observation
import FluxAPI

/// One chat turn for display. `id` is the server id when persisted, else a temp id.
struct ChatMessage: Identifiable {
    var id: String
    var role: String          // "user" | "assistant"
    var content: String
    var sources: [SourceDTO]
    var status: String?       // transient streaming status (e.g. "Searching the web…")
    var isStreaming: Bool
}

extension SourceDTO {
    /// Build a minimal web SourceDTO for live-streamed web results.
    static func web(url: String, title: String?) -> SourceDTO {
        SourceDTO(kind: .web, source: nil, itemId: "", itemTitle: title ?? url, startSec: 0,
                  podcastName: nil, artworkUrl: nil, audioUrl: nil, videoId: nil, url: url,
                  snippet: nil, content: nil, isHighlight: nil, isWeb: true)
    }
}

@MainActor @Observable
final class ChatViewModel {
    let conversationId: String
    let scopedItemId: String?
    private let config: AppConfig

    var messages: [ChatMessage] = []
    var loading = false
    var error: String?
    var isStreaming: Bool { messages.last?.isStreaming == true }
    private var streamTask: Task<Void, Never>?

    init(conversationId: String, scopedItemId: String?, config: AppConfig) {
        self.conversationId = conversationId
        self.scopedItemId = scopedItemId
        self.config = config
    }

    func loadHistory() async {
        guard let client = config.makeClient() else { return }
        loading = true
        defer { loading = false }
        do {
            let detail = try await client.conversation(id: conversationId)
            messages = detail.messages.map {
                ChatMessage(id: $0.id, role: $0.role, content: $0.content,
                            sources: $0.sources ?? [], status: nil, isStreaming: false)
            }
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let client = config.makeClient(), !isStreaming else { return }
        messages.append(ChatMessage(id: "u-\(UUID())", role: "user", content: trimmed,
                                    sources: [], status: nil, isStreaming: false))
        let assistantId = "a-\(UUID())"
        messages.append(ChatMessage(id: assistantId, role: "assistant", content: "",
                                    sources: [], status: nil, isStreaming: true))

        streamTask = Task {
            var webSources: [SourceDTO] = []
            do {
                let stream = await client.streamChat(conversationId: conversationId, content: trimmed, itemId: scopedItemId)
                for try await part in stream {
                    guard let idx = messages.firstIndex(where: { $0.id == assistantId }) else { break }
                    switch part {
                    case .textDelta(let delta):
                        messages[idx].content += delta
                        messages[idx].status = nil
                    case .webSearchStatus(let query):
                        messages[idx].status = query.map { "Searching the web for \"\($0)\"" } ?? "Searching the web…"
                    case .webSource(let url, let title):
                        if !webSources.contains(where: { $0.url == url }) {
                            webSources.append(SourceDTO.web(url: url, title: title))
                            messages[idx].sources = webSources
                        }
                    }
                }
            } catch {
                if let idx = messages.firstIndex(where: { $0.id == assistantId }) {
                    messages[idx].status = nil
                }
                // Stopping the stream cancels the task — that's a user action, not an error.
                if !(error is CancellationError) {
                    self.error = error.localizedDescription
                }
            }
            // Refetch the canonical persisted turn (library [n] + web sources).
            await reconcileAfterStream(assistantId: assistantId)
        }
    }

    func stop() { streamTask?.cancel(); markDoneStreaming() }

    private func markDoneStreaming() {
        if let idx = messages.lastIndex(where: { $0.isStreaming }) {
            messages[idx].isStreaming = false
            messages[idx].status = nil
        }
    }

    private func reconcileAfterStream(assistantId: String) async {
        defer { markDoneStreaming() }
        guard let client = config.makeClient() else { return }
        // The assistant turn is persisted in onFinish; a brief retry covers the write race.
        for attempt in 0..<4 {
            if attempt > 0 { try? await Task.sleep(for: .milliseconds(400)) }
            guard let detail = try? await client.conversation(id: conversationId) else { continue }
            if let last = detail.messages.last, last.role == "assistant", !last.content.isEmpty {
                if let idx = messages.firstIndex(where: { $0.id == assistantId }) {
                    messages[idx] = ChatMessage(id: last.id, role: "assistant", content: last.content,
                                                sources: last.sources ?? [], status: nil, isStreaming: false)
                }
                return
            }
        }
    }
}
