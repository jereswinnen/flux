import SwiftUI
import SwiftData

/// Slim now-playing bar shown above the tab bar whenever audio is loaded.
/// Tap to expand to a full player sheet. Bound to the shared AudioPlayer.
struct MiniPlayerBar: View {
    @Environment(AudioPlayer.self) private var player: AudioPlayer?
    @Query private var items: [Item]
    @State private var expanded = false

    private var currentItem: Item? {
        guard let id = player?.currentItemId else { return nil }
        return items.first { $0.id == id }
    }

    var body: some View {
        if let player, let item = currentItem {
            Button { expanded = true } label: {
                HStack(spacing: 10) {
                    AsyncImage(url: item.artworkUrl.flatMap(URL.init)) { $0.resizable().scaledToFill() }
                        placeholder: { Color.secondary.opacity(0.15) }
                        .frame(width: 32, height: 32)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    Text(item.title).font(.callout).lineLimit(1)
                    Spacer(minLength: 8)
                    Button { player.togglePlayPause() } label: {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
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
            .sheet(isPresented: $expanded) {
                NavigationStack {
                    ScrollView { AudioPlayerBar(item: item).padding() }
                        .navigationTitle(item.title)
                        .navigationBarTitleDisplayMode(.inline)
                }
                .presentationDetents([.medium])
            }
        }
    }

    private var progress: Double {
        guard let player, player.duration > 0 else { return 0 }
        return min(1, player.currentTime / player.duration)
    }
}
