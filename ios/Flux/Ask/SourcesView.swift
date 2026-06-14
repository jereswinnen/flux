import SwiftUI
import FluxAPI

/// Grouped sources under an assistant message: library sources grouped by item
/// (with timestamp chips that navigate + seek), web sources as links.
struct SourcesView: View {
    let sources: [SourceDTO]
    @Environment(\.openURL) private var openURL

    private var web: [SourceDTO] { sources.filter { $0.kind == .web } }
    private var library: [SourceDTO] { sources.filter { $0.kind != .web } }

    var body: some View {
        if !sources.isEmpty {
            DisclosureGroup("Sources (\(sources.count))") {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(groupedLibrary, id: \.itemId) { group in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(group.title).font(.caption.bold()).lineLimit(1)
                            HStack {
                                ForEach(group.times, id: \.self) { sec in
                                    NavigationLink(value: ItemRoute(itemId: group.itemId, seekSec: sec)) {
                                        Text(timeString(sec))
                                            .font(.caption2.monospacedDigit())
                                            .padding(.horizontal, 6).padding(.vertical, 2)
                                            .background(.quaternary, in: Capsule())
                                    }
                                }
                            }
                        }
                    }
                    ForEach(web, id: \.url) { src in
                        Button {
                            if let u = src.url.flatMap(URL.init) { openURL(u) }
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "globe").font(.caption2)
                                Text(src.itemTitle).font(.caption).lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 4)
            }
            .font(.caption)
        }
    }

    private struct LibGroup { let itemId: String; let title: String; let times: [Double] }

    private var groupedLibrary: [LibGroup] {
        var order: [String] = []
        var byId: [String: (title: String, times: [Double])] = [:]
        for s in library {
            if byId[s.itemId] == nil { byId[s.itemId] = (s.itemTitle, []); order.append(s.itemId) }
            if !byId[s.itemId]!.times.contains(s.startSec) { byId[s.itemId]!.times.append(s.startSec) }
        }
        return order.map { LibGroup(itemId: $0, title: byId[$0]!.title, times: byId[$0]!.times) }
    }
}
