import SwiftUI
import SwiftData

/// Slim now-playing bar shown above the tab bar whenever audio is loaded.
/// Reads title/artwork straight off the shared AudioPlayer (no library-wide fetch).
/// Tap to expand to the full player.
struct MiniPlayerBar: View {
    @Environment(AudioPlayer.self) private var player: AudioPlayer?
    @State private var expanded = false

    var body: some View {
        if let player, let id = player.currentItemId {
            Button { expanded = true } label: {
                HStack(spacing: 10) {
                    Artwork(url: player.currentArtworkUrl, size: 32, cornerRadius: 6)
                    Text(player.currentTitle ?? "Now playing").font(.callout).lineLimit(1)
                    Spacer(minLength: 8)
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                        .onTapGesture { player.togglePlayPause() }
                        .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                }
                .padding(.leading, 12)
                .padding(.trailing, 4)
                .padding(.vertical, 6)
                .background(.ultraThinMaterial)
                .overlay(alignment: .bottom) {
                    GeometryReader { geo in
                        Rectangle().fill(.tint)
                            .frame(width: geo.size.width * progress, height: 2)
                    }
                    .frame(height: 2)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Now playing: \(player.currentTitle ?? "")")
            .sheet(isPresented: $expanded) {
                ExpandedPlayerSheet(itemId: id)
            }
        }
    }

    private var progress: Double {
        guard let player, player.duration > 0 else { return 0 }
        return min(1, player.currentTime / player.duration)
    }
}

/// Targeted fetch of the playing item for the expanded full-player sheet.
private struct ExpandedPlayerSheet: View {
    @Query private var items: [Item]

    init(itemId: String) {
        _items = Query(filter: #Predicate<Item> { $0.id == itemId })
    }

    var body: some View {
        NavigationStack {
            Group {
                if let item = items.first {
                    ScrollView { AudioPlayerBar(item: item).padding() }
                        .navigationTitle(item.title)
                } else {
                    ContentUnavailableView("Not playing", systemImage: "speaker.slash")
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}
