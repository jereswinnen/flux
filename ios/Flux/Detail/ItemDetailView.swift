import SwiftUI
import SwiftData
import FluxAPI

struct ItemDetailView: View {
    let item: Item
    let initialSeekSec: Double?

    @Environment(DetailLoader.self) private var detailLoader: DetailLoader?
    @Environment(AudioPlayer.self) private var audio: AudioPlayer?
    @Environment(AppConfig.self) private var config
    @Query private var caches: [ItemDetailCache]
    @State private var askRoute: ScopedAskRoute?

    init(item: Item, initialSeekSec: Double? = nil) {
        self.item = item
        self.initialSeekSec = initialSeekSec
        let id = item.id
        _caches = Query(filter: #Predicate<ItemDetailCache> { $0.itemId == id })
    }

    private var cache: ItemDetailCache? { caches.first }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                typeContent
                sharedSections
            }
            .padding()
        }
        .navigationTitle(item.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await startAsk() } } label: { Image(systemName: "sparkles") }
            }
        }
        .sheet(item: $askRoute) { route in
            NavigationStack {
                ConversationView(conversationId: route.conversationId, scopedItemId: route.itemId)
                    .navigationDestination(for: ItemRoute.self) { ItemRouteDestination(route: $0) }
                    .navigationDestination(for: EntityRoute.self) { EntityDetailView(slug: $0.slug) }
            }
        }
        .task {
            await detailLoader?.load(itemId: item.id)
            if let seek = initialSeekSec, item.type == "podcast", let audio {
                audio.load(item: item)
                audio.seek(to: seek)
            }
        }
    }

    private func startAsk() async {
        guard let client = config.makeClient() else { return }
        if let convo = try? await client.createConversation(itemId: item.id) {
            askRoute = ScopedAskRoute(conversationId: convo.id, itemId: item.id)
        }
    }

    @ViewBuilder private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            AsyncImage(url: item.artworkUrl.flatMap(URL.init)) { img in
                img.resizable().scaledToFill()
            } placeholder: {
                Color.secondary.opacity(0.15)
            }
            .frame(width: 72, height: 72)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title).font(.title3.bold())
                if let source = item.source {
                    Text(source).font(.subheadline).foregroundStyle(.secondary)
                }
                if item.status != "ready" {
                    Text(item.status)
                        .font(.caption2)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.quaternary, in: Capsule())
                }
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder private var typeContent: some View {
        switch item.type {
        case "article":
            if let html = cache?.contentHtml {
                ArticleReaderView(item: item, contentHtml: html)
            } else if let text = cache?.transcript?.fullText {
                Text(text).font(.body)
            } else {
                detailPlaceholder
            }
        case "podcast":
            AudioPlayerBar(item: item)
        case "youtube":
            if let videoId = item.videoId {
                YouTubeEmbedView(videoId: videoId)
                    .aspectRatio(16.0/9.0, contentMode: .fit)
            }
        default:
            EmptyView()
        }
    }

    @ViewBuilder private var detailPlaceholder: some View {
        if detailLoader?.loading.contains(item.id) == true {
            ProgressView().frame(maxWidth: .infinity)
        } else {
            ContentUnavailableView(
                "Couldn't load",
                systemImage: "wifi.slash",
                description: Text("Pull or reopen when online.")
            )
        }
    }

    @ViewBuilder private var sharedSections: some View {
        if let insights = cache?.insights {
            InsightsSection(item: item, insights: insights)
        }
        if let transcript = cache?.transcript, !transcript.segments.isEmpty {
            TranscriptSection(item: item, transcript: transcript)
        }
        if let entities = cache?.entities, !entities.isEmpty {
            EntitiesSection(entities: entities)
        }
        HighlightsSection(itemId: item.id)
    }
}
