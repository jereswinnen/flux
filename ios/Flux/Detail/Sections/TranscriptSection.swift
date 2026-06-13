import SwiftUI
import FluxAPI

struct TranscriptSection: View {
    let item: Item
    let transcript: TranscriptDTO

    @Environment(AudioPlayer.self) private var player: AudioPlayer?
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                expanded.toggle()
            } label: {
                HStack {
                    Text("Transcript").font(.headline)
                    Spacer()
                    Image(systemName: expanded ? "chevron.up" : "chevron.down").foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)

            if expanded {
                ForEach(Array(transcript.segments.enumerated()), id: \.offset) { _, seg in
                    Button {
                        if item.type == "podcast" { player?.seek(to: seg.start) }
                    } label: {
                        HStack(alignment: .top, spacing: 8) {
                            Text(timeString(seg.start))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.tint)
                                .frame(width: 48, alignment: .leading)
                            Text(seg.text).font(.callout)
                            Spacer(minLength: 0)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(item.type != "podcast")
                }
            }
        }
    }
}
