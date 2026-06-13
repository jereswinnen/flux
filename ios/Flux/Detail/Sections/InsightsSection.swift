import SwiftUI
import SwiftData
import FluxAPI

struct InsightsSection: View {
    let item: Item
    let insights: InsightsDTO

    @Environment(\.modelContext) private var context
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @Environment(AudioPlayer.self) private var player: AudioPlayer?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let summary = insights.summary, !summary.isEmpty {
                sectionHeader("Summary")
                Text(summary).font(.callout)
            }
            if let takeaways = insights.takeaways, !takeaways.isEmpty {
                sectionHeader("Takeaways")
                ForEach(Array(takeaways.enumerated()), id: \.offset) { idx, t in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "circle.fill").font(.system(size: 5)).padding(.top, 7)
                        Text(t).font(.callout)
                        Spacer(minLength: 0)
                    }
                    .contextMenu {
                        Button("Highlight", systemImage: "highlighter") {
                            HighlightStore.create(in: context, item: item, kind: .takeaway, text: t,
                                                  locator: HighlightLocator(index: idx))
                            Task { await sync?.sync() }
                        }
                    }
                }
            }
            if let topics = insights.topics, !topics.isEmpty {
                sectionHeader("Topics")
                FlowChips(topics: topics)
            }
            if let chapters = insights.chapters, !chapters.isEmpty {
                sectionHeader("Chapters")
                ForEach(Array(chapters.enumerated()), id: \.offset) { _, ch in
                    Button {
                        player?.seek(to: ch.startSec)
                    } label: {
                        HStack {
                            Text(ch.title).font(.callout)
                            Spacer()
                            Text(timeString(ch.startSec)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(item.type != "podcast")
                }
            }
            if let quotes = insights.quotes, !quotes.isEmpty {
                sectionHeader("Notable quotes")
                ForEach(Array(quotes.enumerated()), id: \.offset) { idx, q in
                    Text("\u{201C}\(q.text)\u{201D}")
                        .font(.callout.italic())
                        .padding(.leading, 8)
                        .overlay(alignment: .leading) { Rectangle().frame(width: 3).foregroundStyle(.tint) }
                        .contextMenu {
                            Button("Highlight", systemImage: "highlighter") {
                                HighlightStore.create(in: context, item: item, kind: .quote, text: q.text,
                                                      locator: HighlightLocator(sec: q.approxTimestampSec, index: idx))
                                Task { await sync?.sync() }
                            }
                        }
                }
            }
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title).font(.headline)
    }
}

private struct FlowChips: View {
    let topics: [String]
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 80), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
            ForEach(topics, id: \.self) { topic in
                Text(topic)
                    .font(.caption)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(.quaternary, in: Capsule())
            }
        }
    }
}

func timeString(_ seconds: Double) -> String {
    let s = Int(seconds)
    let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
}
