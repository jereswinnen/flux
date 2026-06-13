import SwiftUI
import FluxAPI

struct AudioPlayerBar: View {
    let item: Item
    @Environment(AudioPlayer.self) private var player: AudioPlayer?
    @State private var scrubbing = false
    @State private var scrubValue: Double = 0

    private let speeds: [Float] = [0.8, 1.0, 1.25, 1.5, 2.0]

    var body: some View {
        guard let player else { return AnyView(EmptyView()) }
        let isCurrent = player.currentItemId == item.id
        let time = isCurrent ? player.currentTime : 0
        let duration = isCurrent ? player.duration : (item.durationSec.map(Double.init) ?? 0)

        return AnyView(
            VStack(spacing: 12) {
                if let err = player.errorMessage, isCurrent {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
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
                HStack {
                    Text(timeString(scrubbing ? scrubValue : time)).font(.caption.monospacedDigit())
                    Spacer()
                    Text(timeString(duration)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                HStack(spacing: 32) {
                    Button { player.skip(-15) } label: { Image(systemName: "gobackward.15") }
                    Button {
                        if !isCurrent { player.load(item: item) }
                        player.togglePlayPause()
                    } label: {
                        Image(systemName: (isCurrent && player.isPlaying) ? "pause.circle.fill" : "play.circle.fill")
                            .font(.system(size: 52))
                    }
                    Button { player.skip(15) } label: { Image(systemName: "goforward.15") }
                }
                .font(.title2)
                Menu {
                    ForEach(speeds, id: \.self) { s in
                        Button("\(s, specifier: "%g")×") { player.setRate(s) }
                    }
                } label: {
                    Text("\(player.rate, specifier: "%g")×").font(.caption)
                }
            }
            .onAppear { if !isCurrent { player.load(item: item) } }
        )
    }
}
