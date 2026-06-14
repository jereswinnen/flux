import SwiftUI
import FluxAPI

struct ConversationView: View {
    let conversationId: String
    let scopedItemId: String?

    @Environment(AppConfig.self) private var config
    @State private var model: ChatViewModel?
    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        ForEach(model?.messages ?? []) { msg in
                            MessageBubble(message: msg).id(msg.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: model?.messages.last?.content) { _, _ in
                    if let last = model?.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
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

    @ViewBuilder private var composer: some View {
        HStack(spacing: 8) {
            TextField("Ask about your library…", text: $draft, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
            if model?.isStreaming == true {
                Button { model?.stop() } label: { Image(systemName: "stop.circle.fill").font(.title2) }
            } else {
                Button {
                    let text = draft; draft = ""
                    model?.send(text)
                } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
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
}
