import SwiftUI
import FluxAPI

struct ConversationView: View {
    let conversationId: String
    let scopedItemId: String?

    @Environment(AppConfig.self) private var config
    @State private var model: ChatViewModel?
    @State private var draft = ""

    private static let suggestions = [
        "What themes come up most across my library?",
        "Summarize what I've saved about design.",
        "What did I save about building good products?",
    ]

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    if (model?.messages.isEmpty ?? true) && model?.loading != true {
                        emptyState
                    } else {
                        LazyVStack(alignment: .leading, spacing: 16) {
                            ForEach(model?.messages ?? []) { msg in
                                MessageBubble(message: msg).id(msg.id)
                            }
                        }
                        .padding()
                    }
                }
                .onChange(of: model?.messages.last?.content) { _, _ in
                    if let last = model?.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            if let error = model?.error {
                Text(error)
                    .font(.caption).foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal).padding(.vertical, 6)
                    .background(.red.opacity(0.1))
            }
            composer
        }
        .navigationTitle("Ask")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if model == nil {
                model = ChatViewModel(conversationId: conversationId, scopedItemId: scopedItemId, config: config)
                await model?.loadHistory()
            }
        }
    }

    @ViewBuilder private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "sparkles").font(.largeTitle).foregroundStyle(.tint)
            Text(scopedItemId == nil ? "Ask about your library" : "Ask about this item")
                .font(.headline)
            VStack(spacing: 8) {
                ForEach(Self.suggestions, id: \.self) { prompt in
                    Button { model?.send(prompt) } label: {
                        Text(prompt)
                            .font(.callout)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(10)
                            .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal)
        .padding(.top, 60)
    }

    @ViewBuilder private var composer: some View {
        HStack(spacing: 8) {
            TextField("Ask about your library…", text: $draft, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
            if model?.isStreaming == true {
                Button { model?.stop() } label: { Image(systemName: "stop.circle.fill").font(.title2) }
                    .accessibilityLabel("Stop")
            } else {
                Button {
                    guard let model else { return }
                    let text = draft; draft = ""
                    model.send(text)
                } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || model == nil)
                .accessibilityLabel("Send")
            }
        }
        .padding()
    }
}

private struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        if message.role == "user" {
            HStack {
                Spacer(minLength: 40)
                Text(message.content)
                    .padding(10)
                    .background(.tint, in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(.white)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if let status = message.status {
                    Label(status, systemImage: "magnifyingglass").font(.caption).foregroundStyle(.secondary)
                }
                if message.content.isEmpty && message.isStreaming && message.status == nil {
                    ProgressView()
                } else {
                    Text(attributed(message.content))
                    citationChips
                }
                SourcesView(sources: message.sources)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func attributed(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }

    /// `[n]` markers cited in the answer, as tappable chips → the matching source (+ seek).
    /// Web sources (empty itemId) render as a flat chip; library sources navigate.
    @ViewBuilder private var citationChips: some View {
        let cited = citedIndices(message.content).filter { $0 >= 1 && $0 <= message.sources.count }
        if !cited.isEmpty {
            HStack(spacing: 6) {
                ForEach(cited, id: \.self) { n in
                    let src = message.sources[n - 1]
                    if src.itemId.isEmpty {
                        chipLabel(n)
                    } else {
                        NavigationLink(value: ItemRoute(itemId: src.itemId, seekSec: src.startSec)) {
                            chipLabel(n)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func chipLabel(_ n: Int) -> some View {
        Text("[\(n)]")
            .font(.caption2.monospacedDigit())
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(.tint.opacity(0.15), in: Capsule())
    }

    private func citedIndices(_ content: String) -> [Int] {
        var result: [Int] = []
        var i = content.startIndex
        while i < content.endIndex {
            if content[i] == "[", let close = content[i...].firstIndex(of: "]") {
                if let n = Int(content[content.index(after: i)..<close]), !result.contains(n) {
                    result.append(n)
                }
                i = content.index(after: close)
            } else {
                i = content.index(after: i)
            }
        }
        return result.sorted()
    }
}
