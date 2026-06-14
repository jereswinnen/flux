import SwiftUI
import FluxAPI

struct AudioPlayerBar: View {
    let item: Item
    @Environment(AudioPlayer.self) private var player: AudioPlayer?
    @State private var scrubbing = false
    @State private var scrubValue: Double = 0

    private let speeds: [Float] = [0.8, 1.0, 1.25, 1.5, 2.0]

    var body: some View {
        if let player {
            content(player)
        }
    }

    @ViewBuilder private func content(_ player: AudioPlayer) -> some View {
        let isCurrent = player.currentItemId == item.id
        let time = isCurrent ? player.currentTime : 0
        let duration = isCurrent ? player.duration : (item.durationSec.map(Double.init) ?? 0)

        VStack(spacing: 16) {
            HStack(spacing: 12) {
                Artwork(url: item.artworkUrl, size: 56, cornerRadius: 8)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(.headline).lineLimit(2)
                    if let source = item.source {
                        Text(source).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }

            if let err = player.errorMessage, isCurrent {
                Text(err).font(.caption).foregroundStyle(.red)
            }

            VStack(spacing: 4) {
                Slider(
                    value: Binding(
                        get: { scrubbing ? scrubValue : time },
                        set: { scrubValue = $0 }
                    ),
                    in: 0...max(duration, 1),
                    onEditingChanged: { editing in
                        scrubbing = editing
                        if !editing { player.seek(to: scrubValue) }
                    }
                )
                .tint(.accentColor)
                HStack {
                    Text(timeString(scrubbing ? scrubValue : time)).font(.caption.monospacedDigit())
                    Spacer()
                    Text(timeString(duration)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 36) {
                Button { player.skip(-15) } label: { Image(systemName: "gobackward.15") }
                    .accessibilityLabel("Back 15 seconds")
                Button {
                    if !isCurrent { player.load(item: item) }
                    player.togglePlayPause()
                } label: {
                    Image(systemName: (isCurrent && player.isPlaying) ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 56))
                }
                .accessibilityLabel(isCurrent && player.isPlaying ? "Pause" : "Play")
                Button { player.skip(15) } label: { Image(systemName: "goforward.15") }
                    .accessibilityLabel("Forward 15 seconds")
            }
            .font(.title2)

            Menu {
                ForEach(speeds, id: \.self) { s in
                    Button("\(s, specifier: "%g")×") { player.setRate(s) }
                }
            } label: {
                Text(isCurrent ? "\(player.rate, specifier: "%g")×" : "1×")
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(.quaternary, in: Capsule())
            }
            .accessibilityLabel("Playback speed")
        }
    }
}
