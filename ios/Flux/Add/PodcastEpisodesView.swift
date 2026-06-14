import SwiftUI
import FluxAPI

struct PodcastEpisodesView: View {
    let show: PodcastShow
    let onAdded: () -> Void

    @Environment(AppConfig.self) private var config
    @Environment(\.dismiss) private var dismiss
    @State private var episodes: [FeedEpisode] = []
    @State private var showName: String?
    @State private var artworkUrl: String?
    @State private var loading = false
    @State private var error: String?
    @State private var addingId: String?

    var body: some View {
        List(episodes, id: \.audioUrl) { ep in
            Button { Task { await add(ep) } } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ep.title).font(.callout).lineLimit(2)
                        if let pub = ep.publishedAt {
                            Text(pub.prefix(10)).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if addingId == ep.audioUrl { ProgressView() }
                    else { Image(systemName: "plus.circle").foregroundStyle(.tint) }
                }
            }
            .buttonStyle(.plain)
        }
        .overlay {
            if loading { ProgressView() }
            else if episodes.isEmpty, let error { Text(error).foregroundStyle(.secondary).padding() }
        }
        .navigationTitle(show.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        guard let feedUrl = show.feedUrl, let client = config.makeClient() else {
            error = "This show has no feed."; return
        }
        loading = true; defer { loading = false }
        do {
            let res = try await client.episodesForFeed(feedUrl: feedUrl)
            episodes = res.episodes; showName = res.showName; artworkUrl = res.artworkUrl
        } catch { self.error = error.localizedDescription }
    }

    private func add(_ ep: FeedEpisode) async {
        guard let client = config.makeClient() else { return }
        addingId = ep.audioUrl
        defer { addingId = nil }
        let input = PodcastItemInput(
            title: ep.title,
            audioUrl: ep.audioUrl,
            podcastName: showName ?? show.name,
            artworkUrl: artworkUrl ?? show.artworkUrl,
            publishedAt: ep.publishedAt,
            durationSec: ep.durationSec,
            episodeGuid: ep.guid,
            itunesCollectionId: show.collectionId
        )
        if (try? await client.addPodcastItem(input)) != nil {
            onAdded()
            dismiss()
        }
    }
}
