import SwiftUI
import FluxAPI

struct EntityDetailView: View {
    let slug: String

    @Environment(AppConfig.self) private var config
    @State private var detail: EntityDetail?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            if let detail {
                VStack(alignment: .leading, spacing: 20) {
                    header(detail.entity)
                    if let summary = detail.entity.summary ?? detail.entity.description, !summary.isEmpty {
                        Text(summary).font(.callout)
                    }
                    if !detail.mentions.isEmpty {
                        sectionTitle("Mentioned in")
                        ForEach(detail.mentions, id: \.id) { m in
                            NavigationLink(value: ItemRoute(itemId: m.id, seekSec: m.approxTimestampSec.map(Double.init))) {
                                mentionRow(m)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if !detail.relatedEntities.isEmpty {
                        sectionTitle("Often mentioned with")
                        ForEach(detail.relatedEntities, id: \.id) { r in
                            NavigationLink(value: EntityRoute(slug: r.slug)) {
                                HStack(spacing: 10) {
                                    Artwork(url: r.imageUrl, size: 32, cornerRadius: 16)
                                    Text(r.name).font(.callout)
                                    Spacer()
                                    Text("^[\(r.sharedItems) shared item](inflect: true)")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding()
            } else if loading {
                ProgressView().padding(.top, 60)
            } else {
                ContentUnavailableView(
                    "Couldn't load",
                    systemImage: "person.crop.circle.badge.questionmark",
                    description: Text(error ?? "Try again when online.")
                )
            }
        }
        .navigationTitle(detail?.entity.name ?? "Entity")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder private func header(_ e: EntityRecord) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Artwork(url: e.imageUrl, size: 64, cornerRadius: 8)
            VStack(alignment: .leading, spacing: 4) {
                Text(e.name).font(.title3.bold())
                Text(e.type.capitalized).font(.caption).foregroundStyle(.secondary)
                if let wiki = e.wikipediaUrl.flatMap(URL.init) {
                    Link("Wikipedia", destination: wiki).font(.caption)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func sectionTitle(_ t: String) -> some View { Text(t).font(.headline) }

    private func mentionRow(_ m: EntityMention) -> some View {
        HStack(spacing: 10) {
            Artwork(url: m.artworkUrl, size: 36, cornerRadius: 6)
            VStack(alignment: .leading, spacing: 2) {
                Text(m.title).font(.callout).lineLimit(1)
                if let ctx = m.context, !ctx.isEmpty {
                    Text(ctx).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func load() async {
        guard let client = config.makeClient() else { return }
        loading = true; defer { loading = false }
        do { detail = try await client.entity(slug: slug); error = nil }
        catch { self.error = error.localizedDescription }
    }
}
