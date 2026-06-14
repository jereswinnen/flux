# iOS P4 — Add Content, Polish & Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add content creation (URL + podcast search), polish (global mini-player, inline citation chips, conversation rename/delete, entity detail), and prune the FluxAPI surface to exactly what the app uses.

**Architecture:** Native SwiftUI + SwiftData + Observation. New backend route `GET /api/entities/[slug]` composes existing DB functions. FluxAPI gains podcast-search + entity methods and sheds 4 unused methods (+2 DTOs). iOS reuses existing pieces (`AudioPlayerBar`, `ItemRoute`, `timeString`).

**Tech Stack:** Swift, SwiftUI, SwiftData, `FluxAPI`; Next.js route handler (TS). Xcode 26, iOS 26.

**Verification:** `swift build` (FluxAPI) + `xcodebuild` (`Flux`) green per group; `curl` the new route; `FluxUITests` screenshots. **GOTCHA (from P3): editing the local FluxAPI package needs a CLEAN Xcode build** to pick up — clean DerivedData before iOS builds that depend on FluxAPI changes.

**Files (overview):**
- `clients/swift/Sources/FluxAPI/FluxModels.swift` (podcast + entity DTOs; remove AskResponse/EntitySearchResult)
- `clients/swift/Sources/FluxAPI/FluxClient.swift` (searchPodcasts/episodesForFeed/entity; remove ask/highlights/updateHighlightNote/items)
- `clients/swift/README.md` (surface update)
- `app/api/entities/[slug]/route.ts` (create)
- `docs/api/openapi.yaml` (add the route)
- `ios/Flux/Add/AddContentView.swift`, `AddContentModel.swift`, `PodcastEpisodesView.swift` (create)
- `ios/Flux/Player/MiniPlayerBar.swift` (create)
- `ios/Flux/Entity/EntityDetailView.swift` (create)
- `ios/Flux/Navigation/ItemRoute.swift` (add `EntityRoute`)
- `ios/Flux/Ask/ConversationView.swift` (citation chips)
- `ios/Flux/Ask/AskView.swift` (rename/delete swipe)
- `ios/Flux/Library/LibraryView.swift` (+ Add button)
- `ios/Flux/RootView.swift` (mini-player inset)
- `ios/Flux/Detail/Sections/EntitiesSection.swift` (navigate to EntityRoute)
- `ios/FluxUITests/FluxUITests.swift` (screenshots)

---

### Task 0: FluxAPI — add podcast/entity surface, prune unused

**Files:** `clients/swift/Sources/FluxAPI/FluxModels.swift`, `FluxClient.swift`, `README.md`

- [ ] **Step 1: Add DTOs to `FluxModels.swift`**

```swift
// MARK: - Podcasts (iTunes add flow)

public struct PodcastShow: Codable, Sendable {
    public let collectionId: Int
    public let name: String
    public let artistName: String
    public let artworkUrl: String?
    public let feedUrl: String?
}

public struct FeedEpisode: Codable, Sendable {
    public let title: String
    public let guid: String?
    public let audioUrl: String
    public let audioType: String?
    public let publishedAt: String?
    public let durationSec: Int?
    public let description: String?
}

public struct EpisodesResponse: Decodable, Sendable {
    public let showName: String?
    public let artworkUrl: String?
    public let episodes: [FeedEpisode]
}

// MARK: - Entity detail

public struct EntityExternalIds: Codable, Sendable {
    public let itunesId: Int?
    public let isbn: String?
    public let googleBooksId: String?
}

public struct EntityRecord: Codable, Sendable {
    public let id: String
    public let name: String
    public let slug: String
    public let type: String
    public let description: String?
    public let summary: String?
    public let imageUrl: String?
    public let wikipediaUrl: String?
    public let externalIds: EntityExternalIds?
    public let metadata: EntityMetadata?
}

public struct EntityMention: Codable, Sendable {
    public let id: String          // item id
    public let title: String
    public let podcastName: String?
    public let artworkUrl: String?
    public let context: String?
    public let approxTimestampSec: Int?
}

public struct RelatedEntity: Codable, Sendable {
    public let id: String
    public let name: String
    public let slug: String
    public let type: String
    public let imageUrl: String?
    public let sharedItems: Int
}

public struct EntityDetail: Codable, Sendable {
    public let entity: EntityRecord
    public let mentions: [EntityMention]
    public let relatedEntities: [RelatedEntity]
}
```

- [ ] **Step 2: Remove orphaned DTOs**

Delete `public struct AskResponse { ... }` and `public struct EntitySearchResult { ... }` from `FluxModels.swift`.

- [ ] **Step 3: Add client methods to `FluxClient.swift`**

```swift
    // MARK: - Podcast add flow

    /// Search iTunes for podcast shows.
    public func searchPodcasts(query: String) async throws -> [PodcastShow] {
        struct Env: Decodable { let results: [PodcastShow] }
        let res: Env = try await perform(
            try request("GET", path: "/api/itunes/search", query: ["q": query, "type": "podcast"])
        )
        return res.results
    }

    /// Fetch a show's episodes by parsing its RSS feed.
    public func episodesForFeed(feedUrl: String) async throws -> EpisodesResponse {
        try await perform(
            try request("GET", path: "/api/itunes/episodes", query: ["feedUrl": feedUrl])
        )
    }

    // MARK: - Entities

    /// Fetch an entity with its mentions and co-mentioned entities.
    public func entity(slug: String) async throws -> EntityDetail {
        try await perform(try request("GET", path: "/api/entities/\(slug)"))
    }
```

- [ ] **Step 4: Remove unused client methods**

Delete from `FluxClient.swift`: `items()`, `highlights(type:q:itemId:)`, `updateHighlightNote(id:note:)`, `ask(query:)` (and any now-unused private envelope types they alone used — e.g. a `HighlightsEnvelope`/`Envelope<[ItemDTO]>` if unreferenced elsewhere; verify with the compiler).

- [ ] **Step 5: Build the package**

Run: `cd clients/swift && swift build`
Expected: `Build complete!` (fix any references to the removed types — there should be none in the package).

- [ ] **Step 6: Update `clients/swift/README.md`**

Update the documented method list: add `searchPodcasts`, `episodesForFeed`, `entity(slug:)`; remove `items`, `highlights`, `updateHighlightNote`, `ask`.

- [ ] **Step 7: Commit**

```bash
git add clients/swift/
git commit -m "feat(swift): podcast-search + entity-detail client surface; prune unused (ask/highlights/updateHighlightNote/items)"
```

---

### Task 1: Backend — `GET /api/entities/[slug]`

**Files:** Create `app/api/entities/[slug]/route.ts`; modify `docs/api/openapi.yaml`

- [ ] **Step 1: Inspect the existing DB functions**

Read `lib/db/entities.ts` to confirm the exact signatures/returns of `getEntityBySlug`, `itemsMentioningEntity`, `coMentionedEntities` (the design references them). Confirm import paths.

- [ ] **Step 2: Create the route**

`app/api/entities/[slug]/route.ts`:

```ts
import { db } from "@/lib/db"
import { getEntityBySlug, itemsMentioningEntity, coMentionedEntities } from "@/lib/db/entities"

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entity = await getEntityBySlug(db, slug)
  if (!entity) return Response.json({ error: "not found" }, { status: 404 })

  const [mentions, related] = await Promise.all([
    itemsMentioningEntity(db, entity.id),
    coMentionedEntities(db, entity.id),
  ])

  return Response.json({
    entity: {
      id: entity.id,
      name: entity.name,
      slug: entity.slug,
      type: entity.type,
      description: entity.description,
      summary: entity.summary,
      imageUrl: entity.imageUrl,
      wikipediaUrl: entity.wikipediaUrl,
      externalIds: entity.externalIds,
      metadata: entity.metadata,
    },
    mentions: mentions.map((m) => ({
      id: m.id,
      title: m.title,
      podcastName: m.podcastName,
      artworkUrl: m.artworkUrl,
      context: m.context,
      approxTimestampSec: m.approxTimestampSec,
    })),
    relatedEntities: related.map((r) => ({
      id: r.id, name: r.name, slug: r.slug, type: r.type,
      imageUrl: r.imageUrl, sharedItems: r.sharedItems,
    })),
  })
}
```

(Adjust field names if Step 1 shows differences — e.g. if `itemsMentioningEntity` returns different keys.)

- [ ] **Step 3: Smoke-test**

Run the dev server or test against the live deploy after pushing. Locally: `npm run dev` then `curl 'http://localhost:3000/api/entities/<known-slug>'`. To find a slug, query an item detail that has entities, or check the DB. Expected: `{entity, mentions, relatedEntities}` with HTTP 200; unknown slug → 404.

- [ ] **Step 4: Document in OpenAPI**

Add a `GET /api/entities/{slug}` path entry to `docs/api/openapi.yaml` mirroring the response shape.

- [ ] **Step 5: Commit**

```bash
git add app/api/entities docs/api/openapi.yaml
git commit -m "feat(api): GET /api/entities/[slug] — entity + mentions + related"
```

---

### Task 2: iOS — Add content (URL + podcast search)

**Files:** Create `ios/Flux/Add/AddContentModel.swift`, `AddContentView.swift`, `PodcastEpisodesView.swift`; modify `ios/Flux/Library/LibraryView.swift`

- [ ] **Step 1: `AddContentModel`**

`ios/Flux/Add/AddContentModel.swift`:

```swift
import Foundation
import Observation
import FluxAPI

@MainActor @Observable
final class AddContentModel {
    enum Mode { case link, podcast }

    private let config: AppConfig
    var mode: Mode = .link
    var urlText = ""
    var podcastQuery = ""
    var shows: [PodcastShow] = []
    var inFlight = false
    var error: String?

    init(config: AppConfig) { self.config = config }

    /// Add an article/YouTube URL. Returns true on success.
    func addLink() async -> Bool {
        let url = urlText.trimmingCharacters(in: .whitespaces)
        guard !url.isEmpty, let client = config.makeClient() else { return false }
        inFlight = true; defer { inFlight = false }
        do { _ = try await client.addItem(url: url); error = nil; return true }
        catch { self.error = error.localizedDescription; return false }
    }

    func searchPodcasts() async {
        let q = podcastQuery.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2, let client = config.makeClient() else { shows = []; return }
        inFlight = true; defer { inFlight = false }
        do { shows = try await client.searchPodcasts(query: q); error = nil }
        catch { self.error = error.localizedDescription }
    }
}
```

- [ ] **Step 2: `PodcastEpisodesView`**

`ios/Flux/Add/PodcastEpisodesView.swift`:

```swift
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
    @State private var addingGuid: String?

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
                    if addingGuid == ep.guid { ProgressView() }
                    else { Image(systemName: "plus.circle").foregroundStyle(.tint) }
                }
            }
            .buttonStyle(.plain)
        }
        .overlay { if loading { ProgressView() } else if episodes.isEmpty, let error { Text(error).foregroundStyle(.secondary) } }
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
        addingGuid = ep.guid
        defer { addingGuid = nil }
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
```

- [ ] **Step 3: `AddContentView`**

`ios/Flux/Add/AddContentView.swift`:

```swift
import SwiftUI
import FluxAPI

struct AddContentView: View {
    let onAdded: () -> Void

    @Environment(AppConfig.self) private var config
    @Environment(\.dismiss) private var dismiss
    @State private var model: AddContentModel?

    var body: some View {
        NavigationStack {
            Group {
                if let model { content(model) } else { ProgressView() }
            }
            .navigationTitle("Add")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .navigationDestination(for: PodcastShow.self) { show in
                PodcastEpisodesView(show: show, onAdded: onAdded)
            }
        }
        .task { if model == nil { model = AddContentModel(config: config) } }
    }

    @ViewBuilder private func content(_ model: AddContentModel) -> some View {
        @Bindable var model = model
        Form {
            Picker("Type", selection: $model.mode) {
                Text("Link").tag(AddContentModel.Mode.link)
                Text("Podcast").tag(AddContentModel.Mode.podcast)
            }
            .pickerStyle(.segmented)

            if model.mode == .link {
                Section("Article or YouTube URL") {
                    TextField("https://…", text: $model.urlText)
                        .keyboardType(.URL).autocorrectionDisabled().textInputAutocapitalization(.never)
                    Button {
                        Task { if await model.addLink() { onAdded(); dismiss() } }
                    } label: {
                        if model.inFlight { ProgressView() } else { Text("Add") }
                    }
                    .disabled(model.urlText.trimmingCharacters(in: .whitespaces).isEmpty || model.inFlight)
                }
            } else {
                Section {
                    TextField("Search podcasts", text: $model.podcastQuery)
                        .autocorrectionDisabled()
                        .onSubmit { Task { await model.searchPodcasts() } }
                }
                Section {
                    ForEach(model.shows, id: \.collectionId) { show in
                        NavigationLink(value: show) {
                            HStack(spacing: 10) {
                                AsyncImage(url: show.artworkUrl.flatMap(URL.init)) { $0.resizable().scaledToFill() }
                                    placeholder: { Color.secondary.opacity(0.15) }
                                    .frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: 6))
                                VStack(alignment: .leading) {
                                    Text(show.name).font(.callout).lineLimit(1)
                                    Text(show.artistName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                        }
                    }
                }
            }
            if let error = model.error {
                Text(error).font(.caption).foregroundStyle(.red)
            }
        }
    }
}
```

(`PodcastShow` must be `Hashable` for `NavigationLink(value:)`/`navigationDestination(for:)`. It's `Codable` with value-type members; add `Hashable` conformance in Task 0's struct: `public struct PodcastShow: Codable, Hashable, Sendable`.)

- [ ] **Step 4: Add the "+" button to `LibraryView`**

In `LibraryView`, add `@State private var showingAdd = false`, a toolbar `+` button setting it true, and `.sheet(isPresented: $showingAdd) { AddContentView(onAdded: { Task { await sync?.sync() } }) }`. Place the `+` as a `ToolbarItem(placement: .topBarLeading)` (the filter is trailing).

- [ ] **Step 5: Build (CLEAN — FluxAPI changed)**

Dispatch apple-platform-builder: clean DerivedData, then build `Flux`. Expected: BUILD SUCCEEDED.

- [ ] **Step 6: Screenshot verification**

Launch (live API) → Library → tap + → screenshot the Add sheet (Link mode), switch to Podcast, search "founders", screenshot results. Add a known article URL and confirm it appears after sync. Save `/tmp/flux-p4-add-*.png`.

- [ ] **Step 7: Commit**

```bash
git add ios/Flux/Add ios/Flux/Library/LibraryView.swift
git commit -m "feat(ios): Add content — URL paste + iTunes podcast search/add"
```

---

### Task 3: iOS — Global mini-player

**Files:** Create `ios/Flux/Player/MiniPlayerBar.swift`; modify `ios/Flux/RootView.swift`

- [ ] **Step 1: `MiniPlayerBar`**

`ios/Flux/Player/MiniPlayerBar.swift`:

```swift
import SwiftUI
import SwiftData

struct MiniPlayerBar: View {
    @Environment(AudioPlayer.self) private var player: AudioPlayer?
    @Query private var items: [Item]
    @State private var expanded = false

    init() {
        _items = Query()   // small library; we filter to the current id in `currentItem`
    }

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
                        .frame(width: 32, height: 32).clipShape(RoundedRectangle(cornerRadius: 6))
                    Text(item.title).font(.callout).lineLimit(1)
                    Spacer(minLength: 8)
                    Button { player.togglePlayPause() } label: {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(.ultraThinMaterial)
                .overlay(alignment: .bottom) {
                    GeometryReader { geo in
                        Rectangle().fill(.tint)
                            .frame(width: geo.size.width * progress)
                            .frame(height: 2)
                    }
                    .frame(height: 2)
                }
            }
            .buttonStyle(.plain)
            .sheet(isPresented: $expanded) {
                NavigationStack {
                    ScrollView { AudioPlayerBar(item: item).padding() }
                        .navigationTitle(item.title).navigationBarTitleDisplayMode(.inline)
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
```

- [ ] **Step 2: Inset it on the TabView**

In `RootView`, add `.safeAreaInset(edge: .bottom)` on the `TabView` (after the `.environment` modifiers):

```swift
        .safeAreaInset(edge: .bottom) { MiniPlayerBar() }
```

- [ ] **Step 3: Build + screenshot**

Clean not needed (no FluxAPI change). Build `Flux`. Then launch, play a podcast, switch to another tab, screenshot showing the mini-player above the tab bar; tap it → expanded sheet. Save `/tmp/flux-p4-miniplayer.png`.

- [ ] **Step 4: Commit**

```bash
git add ios/Flux/Player/MiniPlayerBar.swift ios/Flux/RootView.swift
git commit -m "feat(ios): global mini-player above the tab bar, tap to expand"
```

---

### Task 4: iOS — Inline citation chips

**Files:** Modify `ios/Flux/Ask/ConversationView.swift`

- [ ] **Step 1: Replace the assistant text rendering with a citation-aware builder**

In `ConversationView.swift`'s `MessageBubble`, replace the assistant `Text(attributed(message.content))` with a flow of prose + tappable `[n]` chips. Add a helper that segments the content:

```swift
private enum AnswerSegment: Identifiable {
    case text(String)
    case citation(Int)
    var id: String {
        switch self {
        case .text(let s): return "t-\(s.hashValue)"
        case .citation(let n): return "c-\(n)"
        }
    }
}

private func segments(_ content: String) -> [AnswerSegment] {
    var result: [AnswerSegment] = []
    var text = ""
    var i = content.startIndex
    while i < content.endIndex {
        let c = content[i]
        if c == "[", let close = content[i...].firstIndex(of: "]") {
            let inner = content[content.index(after: i)..<close]
            if let n = Int(inner) {
                if !text.isEmpty { result.append(.text(text)); text = "" }
                result.append(.citation(n))
                i = content.index(after: close)
                continue
            }
        }
        text.append(c)
        i = content.index(after: i)
    }
    if !text.isEmpty { result.append(.text(text)) }
    return result
}
```

Render with a wrapping layout. Because mixing inline tappable chips with markdown prose in SwiftUI is fiddly, render the prose as markdown `Text` and the citations as chips using a `WrappingHStack`-style flow built from `Text` concatenation where possible; simplest robust approach: render the full answer as markdown `Text` for prose, and append a compact row of unique citation chips beneath it that map to sources. Implement the simplest version that ships: 

- Keep the markdown answer `Text(attributed(content))`.
- Below it, if `message.sources` is non-empty, show a horizontal wrap of chips `[1]…[k]` for the cited indices found via `segments`, each a `NavigationLink(value: ItemRoute(...))` to `message.sources[n-1]` (guard range). 

```swift
private var citationChips: some View {
    let indices = Set(segments(message.content).compactMap { if case .citation(let n) = $0 { return n } else { return nil } })
        .filter { $0 >= 1 && $0 <= message.sources.count }.sorted()
    return ForEach(indices, id: \.self) { n in
        let src = message.sources[n - 1]
        NavigationLink(value: ItemRoute(itemId: src.itemId, seekSec: src.startSec)) {
            Text("[\(n)]").font(.caption2.monospacedDigit())
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(.tint.opacity(0.15), in: Capsule())
        }
    }
}
```

In the assistant branch, place a wrapping `HStack`/`LazyHGrid` (or simple `HStack` if few) of `citationChips` between the answer text and `SourcesView`. (Web sources have `itemId == ""`; `ItemRouteDestination` shows "not in your library" for those — acceptable, or filter `src.itemId.isEmpty` to skip nav for web citations and instead show a plain chip.)

NOTE: keep this minimal — no new files, one private enum + two helpers inside `ConversationView.swift`.

- [ ] **Step 2: Build + screenshot**

Build `Flux`. Ask a question, screenshot showing `[n]` chips under the answer; tap one → opens the source. Save `/tmp/flux-p4-citations.png`.

- [ ] **Step 3: Commit**

```bash
git add ios/Flux/Ask/ConversationView.swift
git commit -m "feat(ios): tappable citation chips on Ask answers"
```

---

### Task 5: iOS — Conversation rename/delete

**Files:** Modify `ios/Flux/Ask/AskView.swift`

- [ ] **Step 1: Add swipe actions + rename alert**

In `AskView`, add state `@State private var renaming: ConversationRow?` and `@State private var renameText = ""`. On each list row add:

```swift
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) { Task { await delete(convo) } } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        Button { renaming = convo; renameText = convo.title } label: {
                            Label("Rename", systemImage: "pencil")
                        }
                        .tint(.blue)
                    }
```

Add the alert on the List:

```swift
            .alert("Rename conversation", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }), presenting: renaming) { convo in
                TextField("Title", text: $renameText)
                Button("Save") { Task { await rename(convo, to: renameText) } }
                Button("Cancel", role: .cancel) {}
            }
```

And the methods:

```swift
    private func delete(_ convo: ConversationRow) async {
        guard let client = config.makeClient() else { return }
        try? await client.deleteConversation(id: convo.id)
        conversations.removeAll { $0.id == convo.id }
    }

    private func rename(_ convo: ConversationRow, to title: String) async {
        let t = title.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, let client = config.makeClient() else { return }
        try? await client.renameConversation(id: convo.id, title: t)
        if let idx = conversations.firstIndex(where: { $0.id == convo.id }) {
            // ConversationRow is immutable; refetch list for the new title.
            await load()
        }
        renaming = nil
    }
```

(If `load()` is heavy, instead reload just the list — it's small. Keep it simple.)

- [ ] **Step 2: Build + screenshot**

Build `Flux`. In Ask, swipe a conversation → Delete/Rename; rename one. Screenshot `/tmp/flux-p4-convo-actions.png`.

- [ ] **Step 3: Commit**

```bash
git add ios/Flux/Ask/AskView.swift
git commit -m "feat(ios): conversation rename + delete swipe actions"
```

---

### Task 6: iOS — Entity detail

**Files:** Modify `ios/Flux/Navigation/ItemRoute.swift` (add `EntityRoute`), create `ios/Flux/Entity/EntityDetailView.swift`, modify `ios/Flux/Detail/Sections/EntitiesSection.swift` and the tab roots that show entities.

- [ ] **Step 1: Add `EntityRoute`**

In `ItemRoute.swift`:

```swift
/// Navigation value to open an entity detail by slug.
struct EntityRoute: Hashable {
    let slug: String
}
```

- [ ] **Step 2: `EntityDetailView`**

`ios/Flux/Entity/EntityDetailView.swift`:

```swift
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
                                    AsyncImage(url: r.imageUrl.flatMap(URL.init)) { $0.resizable().scaledToFill() }
                                        placeholder: { Color.secondary.opacity(0.15) }
                                        .frame(width: 32, height: 32).clipShape(Circle())
                                    Text(r.name).font(.callout)
                                    Spacer()
                                    Text("\(r.sharedItems)").font(.caption).foregroundStyle(.secondary)
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
                ContentUnavailableView("Couldn't load", systemImage: "person.crop.circle.badge.questionmark",
                                       description: Text(error ?? "Try again when online."))
            }
        }
        .navigationTitle(detail?.entity.name ?? "Entity")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder private func header(_ e: EntityRecord) -> some View {
        HStack(alignment: .top, spacing: 12) {
            AsyncImage(url: e.imageUrl.flatMap(URL.init)) { $0.resizable().scaledToFill() }
                placeholder: { Color.secondary.opacity(0.15) }
                .frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 8))
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
            AsyncImage(url: m.artworkUrl.flatMap(URL.init)) { $0.resizable().scaledToFill() }
                placeholder: { Color.secondary.opacity(0.15) }
                .frame(width: 36, height: 36).clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                Text(m.title).font(.callout).lineLimit(1)
                if let ctx = m.context, !ctx.isEmpty {
                    Text(ctx).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
        }
    }

    private func load() async {
        guard let client = config.makeClient() else { return }
        loading = true; defer { loading = false }
        do { detail = try await client.entity(slug: slug); error = nil }
        catch { self.error = error.localizedDescription }
    }
}
```

- [ ] **Step 3: Wire `EntitiesSection` cards to navigate**

In `EntitiesSection.swift`, wrap each entity card in `NavigationLink(value: EntityRoute(slug: entity.slug)) { ... }.buttonStyle(.plain)`.

- [ ] **Step 4: Register the `EntityRoute` destination**

Add `.navigationDestination(for: EntityRoute.self) { EntityDetailView(slug: $0.slug) }` to every tab root that can surface entities: at minimum the same stacks that register `ItemRoute` (Library, Search, Highlights, Ask) — since entities are reached from item detail (any tab) and from related-entity recursion. Add it alongside each existing `.navigationDestination(for: ItemRoute.self)`. Also add it inside the item-scoped Ask sheet wrapper in `ItemDetailView` (where `ItemRoute` is already registered) for completeness.

- [ ] **Step 5: Build (CLEAN — FluxAPI changed in Task 0; clean if not already done since)**

Dispatch apple-platform-builder: build `Flux` (clean DerivedData if the FluxAPI change from Task 0 hasn't been picked up by a clean build yet). Expected: BUILD SUCCEEDED.

- [ ] **Step 6: Screenshot verification**

Requires the backend route (Task 1) deployed (push to main first, or test against local dev). Open an item with entities → tap a Mentioned card → entity detail (header, mentions, related); tap a mention → item; tap a related entity → recurse. Save `/tmp/flux-p4-entity.png`.

- [ ] **Step 7: Commit**

```bash
git add ios/Flux/Entity ios/Flux/Navigation/ItemRoute.swift ios/Flux/Detail/Sections/EntitiesSection.swift ios/Flux/Library/LibraryView.swift ios/Flux/Search/SearchView.swift ios/Flux/Highlights/HighlightsView.swift ios/Flux/Ask/AskView.swift ios/Flux/Detail/ItemDetailView.swift
git commit -m "feat(ios): entity detail screen + navigation from Mentioned cards"
```

---

### Task 7: Verification sweep + UI tests

**Files:** Modify `ios/FluxUITests/FluxUITests.swift`

- [ ] **Step 1: Add screenshot tests**

Append tests that screenshot: the Add sheet (tap +), and an entity detail (open an item with entities → tap a card). Mirror the existing helper style (`openLibrary`, `openItem`, `saveScreenshot`).

- [ ] **Step 2: Run UI tests (clean build)**

Dispatch apple-platform-builder: clean + `xcodebuild test` the `Flux` scheme. Expected: all tests pass; new screenshots written.

- [ ] **Step 3: Full manual sweep**

Verify end-to-end against the live API (after pushing the backend route): add a URL + a podcast episode; mini-player across tabs; citation chip tap; conversation rename+delete; entity detail navigation. Report issues.

- [ ] **Step 4: Commit**

```bash
git add ios/FluxUITests/FluxUITests.swift
git commit -m "test(ios): screenshot tests for Add content + entity detail"
```

---

## Self-Review

**Spec coverage:** podcast search + URL add (FluxAPI Task 0 + iOS Task 2) ✓; global mini-player (Task 3) ✓; inline citation chips (Task 4) ✓; conversation rename/delete (Task 5) ✓; entity detail — backend route (Task 1) + FluxAPI (Task 0) + iOS screen/wiring (Task 6) ✓; FluxAPI pruning + README (Task 0) ✓; OpenAPI update (Task 1) ✓; UI tests (Task 7) ✓.

**Type consistency:** `PodcastShow` made `Hashable` for navigation; `AddContentModel.Mode` used in the picker; `PodcastItemInput` fields match the existing initializer (title, audioUrl, podcastName, artworkUrl, publishedAt, durationSec, episodeGuid, itunesCollectionId); `EntityDetail`/`EntityRecord`/`EntityMention`/`RelatedEntity` consistent across the route, client, and `EntityDetailView`; `EntityRoute`/`ItemRoute` registered once per stack; citation chips index `sources[n-1]` with range guard.

**Flagged checks (not placeholders):** Task 1 Step 1 must confirm `itemsMentioningEntity`/`coMentionedEntities` exact return keys before finalizing the route mapping. Removing FluxClient methods (Task 0 Step 4) may orphan private envelope types — let the compiler flag and delete them. The mini-player `@Query private var items` loads all items then filters to one in Swift — acceptable for a personal library's size; if it ever grows, switch to a targeted fetch.

**Risk:** entity detail screenshots need the backend route live — push Task 1 before Task 6's manual verification. Citation-chip rendering is intentionally the simple "chips beneath the answer" version (not inline-in-prose) to avoid SwiftUI text/inline-view fragility while still being tappable + useful.
