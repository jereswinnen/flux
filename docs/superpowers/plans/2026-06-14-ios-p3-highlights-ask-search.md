# iOS P3 — Highlights, Ask (streaming chat), Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the Highlights and Ask tabs and add a Search tab — a local reverse-chron Highlights feed, full streaming multi-turn Ask (with live web-search status + grouped sources), and hybrid library Search — all navigating to the source item with optional seek.

**Architecture:** Native SwiftUI + SwiftData + Observation. Highlights read the already-synced local store (offline). Search & Ask are online: `FluxClient.search`/`conversations`/`conversation` + a new `streamChat` (the only new `FluxAPI` work) that consumes the `/api/chat` UI-message SSE stream. Cross-tab item navigation via an `ItemRoute` value + a resolver that looks the item up in SwiftData.

**Tech Stack:** Swift, SwiftUI, SwiftData, Observation, `FluxAPI`. Xcode 26, iOS 26 simulator.

**Verification model:** No business-logic XCTest target; verify via green `swift build` (FluxAPI) + green `xcodebuild` (`Flux` scheme) per task, and the `FluxUITests` screenshot harness + `simctl` against the live API (`https://flux-production-32de.up.railway.app`, no token).

**Files (overview):**
- `clients/swift/Sources/FluxAPI/FluxClient.swift` (modify — `streamChat` + `ChatStreamPart`)
- `ios/Flux/Models/Highlight.swift` (modify — `itemType`)
- `ios/Flux/Sync/HighlightStore.swift` (modify — pass item type)
- `ios/Flux/Detail/ItemDetailView.swift` (modify — `initialSeekSec`, "Ask about this")
- `ios/Flux/Navigation/ItemRoute.swift` (create — route value + resolver)
- `ios/Flux/Highlights/HighlightsView.swift` (create)
- `ios/Flux/Search/SearchView.swift` (create)
- `ios/Flux/Ask/AskView.swift` (create)
- `ios/Flux/Ask/ConversationView.swift` (create)
- `ios/Flux/Ask/ChatViewModel.swift` (create)
- `ios/Flux/Ask/SourcesView.swift` (create)
- `ios/Flux/RootView.swift` (modify — Search tab, wire Highlights/Ask)
- `ios/FluxUITests/FluxUITests.swift` (modify — P3 screenshots)

---

### Task 0: `FluxClient.streamChat` + `ChatStreamPart`

**Files:** Modify `clients/swift/Sources/FluxAPI/FluxClient.swift`

- [ ] **Step 1: Add the stream-part enum (top level in the file, near other public types)**

```swift
/// A parsed event from the `/api/chat` UI-message SSE stream.
public enum ChatStreamPart: Sendable {
    case textDelta(String)
    /// Emitted when the model invokes web search; `query` is what it searched for.
    case webSearchStatus(query: String?)
    /// A web source surfaced during streaming (library `[n]` sources are not streamed —
    /// refetch the conversation after the stream for the canonical source list).
    case webSource(url: String, title: String?)
}
```

- [ ] **Step 2: Add the streaming method to the `FluxClient` actor**

```swift
    /// Stream an assistant turn for a conversation. POSTs to `/api/chat` and yields parsed
    /// SSE parts. Finishes on `[DONE]` or end of stream. Library `[n]` sources are persisted
    /// server-side (not streamed) — refetch `conversation(id:)` afterwards for the full source list.
    public func streamChat(
        conversationId: String,
        content: String,
        itemId: String? = nil
    ) -> AsyncThrowingStream<ChatStreamPart, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    struct Body: Encodable {
                        let conversationId: String
                        let content: String
                        let itemId: String?
                    }
                    let req = try request(
                        "POST", path: "/api/chat",
                        body: Body(conversationId: conversationId, content: content, itemId: itemId)
                    )
                    let (bytes, response) = try await session.bytes(for: req)
                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        throw FluxError.httpError(statusCode: http.statusCode, body: nil)
                    }
                    for try await line in bytes.lines {
                        let trimmed = line.trimmingCharacters(in: .whitespaces)
                        guard trimmed.hasPrefix("data:") else { continue }
                        let payload = trimmed.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
                        if payload.isEmpty || payload == "[DONE]" { continue }
                        guard let data = payload.data(using: .utf8),
                              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                              let type = obj["type"] as? String else { continue }
                        switch type {
                        case "text-delta":
                            if let delta = obj["delta"] as? String { continuation.yield(.textDelta(delta)) }
                        case "tool-input-available":
                            if obj["toolName"] as? String == "web_search" {
                                let query = (obj["input"] as? [String: Any])?["query"] as? String
                                continuation.yield(.webSearchStatus(query: query))
                            }
                        case "source-url":
                            if let url = obj["url"] as? String {
                                continuation.yield(.webSource(url: url, title: obj["title"] as? String))
                            }
                        default:
                            break
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
```

- [ ] **Step 3: Build the package**

Run: `cd clients/swift && swift build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add clients/swift/Sources/FluxAPI/FluxClient.swift
git commit -m "feat(swift): streamChat — consume /api/chat UI-message SSE stream"
```

---

### Task 1: `Highlight.itemType` for the Highlights filter

**Files:** Modify `ios/Flux/Models/Highlight.swift`, `ios/Flux/Sync/HighlightStore.swift`

- [ ] **Step 1: Add the stored property + populate it**

In `ios/Flux/Models/Highlight.swift`, add `var itemType: String` after `itemArtworkUrl`. Update BOTH inits:
- In the memberwise init, add a parameter `itemType: String` and `self.itemType = itemType`.
- In `init(from dto: HighlightDTO)` and `apply(_:)`, set `itemType = dto.item.type.rawValue`.

The full updated model (replace the file body's properties + inits):

```swift
import Foundation
import SwiftData
import FluxAPI

@Model
final class Highlight {
    @Attribute(.unique) var id: String
    var itemId: String
    var kind: String
    var text: String
    var note: String?
    var createdAt: Date
    var updatedAt: Date
    var jumpHref: String
    var itemTitle: String
    var itemSource: String?
    var itemArtworkUrl: String?
    var itemType: String

    init(
        id: String, itemId: String, kind: String, text: String, note: String?,
        createdAt: Date, updatedAt: Date, jumpHref: String,
        itemTitle: String, itemSource: String?, itemArtworkUrl: String?, itemType: String
    ) {
        self.id = id
        self.itemId = itemId
        self.kind = kind
        self.text = text
        self.note = note
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.jumpHref = jumpHref
        self.itemTitle = itemTitle
        self.itemSource = itemSource
        self.itemArtworkUrl = itemArtworkUrl
        self.itemType = itemType
    }

    init(from dto: HighlightDTO) {
        id = dto.id
        itemId = dto.item.id
        kind = dto.kind.rawValue
        text = dto.text
        note = dto.note
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
        jumpHref = dto.jumpHref
        itemTitle = dto.item.title
        itemSource = dto.item.source
        itemArtworkUrl = dto.item.artworkUrl
        itemType = dto.item.type.rawValue
    }

    func apply(_ dto: HighlightDTO) {
        itemId = dto.item.id
        kind = dto.kind.rawValue
        text = dto.text
        note = dto.note
        createdAt = dto.createdAt
        updatedAt = dto.updatedAt
        jumpHref = dto.jumpHref
        itemTitle = dto.item.title
        itemSource = dto.item.source
        itemArtworkUrl = dto.item.artworkUrl
        itemType = dto.item.type.rawValue
    }
}
```

- [ ] **Step 2: Pass item type from the optimistic store**

In `ios/Flux/Sync/HighlightStore.swift`, the `Highlight(...)` memberwise init call now needs `itemType: item.type`:

```swift
        let local = Highlight(
            id: tempId, itemId: item.id, kind: kind.rawValue, text: text, note: note,
            createdAt: now, updatedAt: now, jumpHref: "/items/\(item.id)",
            itemTitle: item.title, itemSource: item.source, itemArtworkUrl: item.artworkUrl,
            itemType: item.type
        )
```

- [ ] **Step 3: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED.
(SwiftData adds the new non-optional `itemType` column; existing rows get the default empty string on lightweight migration — acceptable, they re-sync. If the build/run shows a migration error, the simpler path is to delete the app from the simulator; data re-syncs.)

- [ ] **Step 4: Commit**

```bash
git add ios/Flux/Models/Highlight.swift ios/Flux/Sync/HighlightStore.swift
git commit -m "feat(ios): denormalize itemType onto Highlight for the Highlights filter"
```

---

### Task 2: `ItemRoute` value + resolver, and `ItemDetailView` initial seek

**Files:** Create `ios/Flux/Navigation/ItemRoute.swift`; modify `ios/Flux/Detail/ItemDetailView.swift`

- [ ] **Step 1: Create the route + resolver**

`ios/Flux/Navigation/ItemRoute.swift`:

```swift
import SwiftUI
import SwiftData

/// A navigation value to open an item by id (optionally seeking, for podcasts).
/// Used by Search, Highlights, and Ask sources, where we hold an id, not an `Item`.
struct ItemRoute: Hashable {
    let itemId: String
    let seekSec: Double?
}

/// Resolves an `ItemRoute` to the local `Item` and renders its detail, or a
/// "not in your library" note if it isn't synced locally.
struct ItemRouteDestination: View {
    let route: ItemRoute
    @Query private var items: [Item]

    init(route: ItemRoute) {
        self.route = route
        let id = route.itemId
        _items = Query(filter: #Predicate<Item> { $0.id == id })
    }

    var body: some View {
        if let item = items.first {
            ItemDetailView(item: item, initialSeekSec: route.seekSec)
        } else {
            ContentUnavailableView(
                "Not in your library",
                systemImage: "tray",
                description: Text("This item isn't synced to your device.")
            )
        }
    }
}
```

- [ ] **Step 2: Add `initialSeekSec` to `ItemDetailView`**

In `ios/Flux/Detail/ItemDetailView.swift`, change the init + `.task`:

```swift
    let item: Item
    let initialSeekSec: Double?

    @Environment(DetailLoader.self) private var detailLoader: DetailLoader?
    @Environment(AudioPlayer.self) private var audio: AudioPlayer?
    @Query private var caches: [ItemDetailCache]

    init(item: Item, initialSeekSec: Double? = nil) {
        self.item = item
        self.initialSeekSec = initialSeekSec
        let id = item.id
        _caches = Query(filter: #Predicate<ItemDetailCache> { $0.itemId == id })
    }
```

And update the `.task`:

```swift
        .task {
            await detailLoader?.load(itemId: item.id)
            if let seek = initialSeekSec, item.type == "podcast", let audio {
                audio.load(item: item)
                audio.seek(to: seek)
            }
        }
```

Register the route destination so sources opened from within a detail screen resolve:

```swift
        .navigationDestination(for: ItemRoute.self) { ItemRouteDestination(route: $0) }
```

(Add it as a modifier on the `ScrollView`.)

- [ ] **Step 3: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Commit**

```bash
git add ios/Flux/Navigation/ItemRoute.swift ios/Flux/Detail/ItemDetailView.swift
git commit -m "feat(ios): ItemRoute value + resolver, and ItemDetailView initial seek"
```

---

### Task 3: Highlights tab

**Files:** Create `ios/Flux/Highlights/HighlightsView.swift`; modify `ios/Flux/RootView.swift`

- [ ] **Step 1: Create `HighlightsView`**

`ios/Flux/Highlights/HighlightsView.swift`:

```swift
import SwiftUI
import SwiftData

struct HighlightsView: View {
    @State private var typeFilter: String? = nil
    @State private var searchText = ""

    var body: some View {
        NavigationStack {
            HighlightsList(typeFilter: typeFilter, searchText: searchText)
                .navigationTitle("Highlights")
                .searchable(text: $searchText, prompt: "Search highlights")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            typeButton("All", value: nil)
                            typeButton("Podcasts", value: "podcast")
                            typeButton("Videos", value: "youtube")
                            typeButton("Articles", value: "article")
                        } label: {
                            Label("Filter", systemImage: typeFilter == nil
                                ? "line.3.horizontal.decrease.circle"
                                : "line.3.horizontal.decrease.circle.fill")
                        }
                    }
                }
                .navigationDestination(for: ItemRoute.self) { ItemRouteDestination(route: $0) }
        }
    }

    @ViewBuilder private func typeButton(_ label: String, value: String?) -> some View {
        Button { typeFilter = value } label: {
            if typeFilter == value { Label(label, systemImage: "checkmark") } else { Text(label) }
        }
    }
}

private struct HighlightsList: View {
    @Query private var highlights: [Highlight]

    init(typeFilter: String?, searchText: String) {
        let sort = [SortDescriptor(\Highlight.createdAt, order: .reverse)]
        let q = searchText
        if let type = typeFilter, !q.isEmpty {
            _highlights = Query(filter: #Predicate<Highlight> {
                $0.itemType == type && ($0.text.localizedStandardContains(q) || ($0.note ?? "").localizedStandardContains(q))
            }, sort: sort)
        } else if let type = typeFilter {
            _highlights = Query(filter: #Predicate<Highlight> { $0.itemType == type }, sort: sort)
        } else if !q.isEmpty {
            _highlights = Query(filter: #Predicate<Highlight> {
                $0.text.localizedStandardContains(q) || ($0.note ?? "").localizedStandardContains(q)
            }, sort: sort)
        } else {
            _highlights = Query(sort: sort)
        }
    }

    var body: some View {
        List(highlights, id: \.id) { hl in
            NavigationLink(value: ItemRoute(itemId: hl.itemId, seekSec: seekSeconds(hl))) {
                HighlightRow(highlight: hl)
            }
        }
        .listStyle(.plain)
        .overlay {
            if highlights.isEmpty {
                ContentUnavailableView(
                    "No highlights yet",
                    systemImage: "highlighter",
                    description: Text("Highlight text while reading or listening; they show up here.")
                )
            }
        }
    }

    /// Derive a seek target from the highlight's jumpHref (`/items/{id}?t={sec}`), if present.
    private func seekSeconds(_ hl: Highlight) -> Double? {
        guard let comps = URLComponents(string: hl.jumpHref),
              let t = comps.queryItems?.first(where: { $0.name == "t" })?.value else { return nil }
        return Double(t)
    }
}

private struct HighlightRow: View {
    let highlight: Highlight

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Rectangle().frame(width: 3).foregroundStyle(.yellow)
            VStack(alignment: .leading, spacing: 6) {
                Text(highlight.text).font(.callout).lineLimit(4)
                HStack(spacing: 6) {
                    AsyncImage(url: highlight.itemArtworkUrl.flatMap(URL.init)) { img in
                        img.resizable().scaledToFill()
                    } placeholder: { Color.secondary.opacity(0.15) }
                    .frame(width: 18, height: 18)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    Text(highlight.itemTitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
```

- [ ] **Step 2: Wire it into `RootView`**

In `ios/Flux/RootView.swift`, replace the Highlights placeholder `Tab` content with `HighlightsView()`:

```swift
            Tab("Highlights", systemImage: "highlighter") {
                HighlightsView()
            }
```

- [ ] **Step 3: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Commit**

```bash
git add ios/Flux/Highlights/HighlightsView.swift ios/Flux/RootView.swift
git commit -m "feat(ios): Highlights tab — reverse-chron feed, type filter, search, jump+seek"
```

---

### Task 4: Search tab

**Files:** Create `ios/Flux/Search/SearchView.swift`; modify `ios/Flux/RootView.swift`

- [ ] **Step 1: Create `SearchView`**

`ios/Flux/Search/SearchView.swift`:

```swift
import SwiftUI
import SwiftData
import FluxAPI

struct SearchView: View {
    @Environment(AppConfig.self) private var config
    @State private var query = ""
    @State private var items: [ItemDTO] = []
    @State private var moments: [SearchMoment] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                if !items.isEmpty {
                    Section("Items") {
                        ForEach(items, id: \.id) { item in
                            NavigationLink(value: ItemRoute(itemId: item.id, seekSec: nil)) {
                                SearchItemRow(title: item.title, source: item.source, artworkUrl: item.artworkUrl)
                            }
                        }
                    }
                }
                if !moments.isEmpty {
                    Section("Moments") {
                        ForEach(moments, id: \.chunkId) { m in
                            NavigationLink(value: ItemRoute(itemId: m.itemId, seekSec: Double(m.startSec))) {
                                MomentRow(moment: m)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .overlay { overlay }
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Search your library")
            .onChange(of: query) { _, q in scheduleSearch(q) }
            .navigationDestination(for: ItemRoute.self) { ItemRouteDestination(route: $0) }
        }
    }

    @ViewBuilder private var overlay: some View {
        if isSearching {
            ProgressView()
        } else if query.count >= 2 && items.isEmpty && moments.isEmpty {
            ContentUnavailableView.search(text: query)
        } else if query.isEmpty {
            ContentUnavailableView(
                "Search your library",
                systemImage: "magnifyingglass",
                description: Text("Find episodes, videos, articles, and transcript moments.")
            )
        }
    }

    private func scheduleSearch(_ q: String) {
        searchTask?.cancel()
        let trimmed = q.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2, let client = config.makeClient() else {
            items = []; moments = []; isSearching = false
            return
        }
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))   // debounce
            if Task.isCancelled { return }
            isSearching = true
            defer { isSearching = false }
            do {
                let res = try await client.search(query: trimmed)
                if Task.isCancelled { return }
                items = res.items
                moments = res.moments
            } catch {
                if !Task.isCancelled { items = []; moments = [] }
            }
        }
    }
}

private struct SearchItemRow: View {
    let title: String
    let source: String?
    let artworkUrl: String?
    var body: some View {
        HStack(spacing: 10) {
            AsyncImage(url: artworkUrl.flatMap(URL.init)) { img in
                img.resizable().scaledToFill()
            } placeholder: { Color.secondary.opacity(0.15) }
            .frame(width: 40, height: 40)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body).lineLimit(2)
                if let source { Text(source).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
    }
}

private struct MomentRow: View {
    let moment: SearchMoment
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(moment.itemTitle).font(.caption.bold()).foregroundStyle(.secondary).lineLimit(1)
            Text(moment.content).font(.callout).lineLimit(3)
            Text(timeString(Double(moment.startSec))).font(.caption2.monospacedDigit()).foregroundStyle(.tint)
        }
        .padding(.vertical, 2)
    }
}
```

(`timeString` is the global helper defined in `InsightsSection.swift` (P2) — reused here.)

- [ ] **Step 2: Add the Search tab to `RootView`**

In `ios/Flux/RootView.swift`, add a tab between Library and Highlights:

```swift
            Tab("Search", systemImage: "magnifyingglass") {
                SearchView()
            }
```

- [ ] **Step 3: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Screenshot verification**

Dispatch apple-platform-builder: launch (live API), open Search, type "design", screenshot results (items + moments) to `/tmp/flux-p3-search.png`. Tap a moment → confirm it opens the item.

- [ ] **Step 5: Commit**

```bash
git add ios/Flux/Search/SearchView.swift ios/Flux/RootView.swift
git commit -m "feat(ios): Search tab — hybrid library search, items + moments, tap-to-open/seek"
```

---

### Task 5: Ask — conversation list (`AskView`)

**Files:** Create `ios/Flux/Ask/AskView.swift`; modify `ios/Flux/RootView.swift`

- [ ] **Step 1: Create `AskView`**

`ios/Flux/Ask/AskView.swift`:

```swift
import SwiftUI
import FluxAPI

struct AskView: View {
    @Environment(AppConfig.self) private var config
    @State private var conversations: [ConversationRow] = []
    @State private var loading = false
    @State private var error: String?
    @State private var newConversationId: String?

    var body: some View {
        NavigationStack {
            Group {
                if conversations.isEmpty && !loading {
                    ContentUnavailableView(
                        "Ask anything",
                        systemImage: "sparkles",
                        description: Text(error ?? "Ask questions across your whole library.")
                    )
                } else {
                    List(conversations, id: \.id) { convo in
                        NavigationLink(value: convo.id) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(convo.title).font(.body).lineLimit(1)
                                Text(convo.updatedAt, style: .relative).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Ask")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await startNew() } } label: { Image(systemName: "square.and.pencil") }
                }
            }
            .overlay { if loading { ProgressView() } }
            .refreshable { await load() }
            .task { await load() }
            .navigationDestination(for: String.self) { id in
                ConversationView(conversationId: id, scopedItemId: nil)
            }
            .navigationDestination(item: $newConversationId) { id in
                ConversationView(conversationId: id, scopedItemId: nil)
            }
        }
    }

    private func load() async {
        guard let client = config.makeClient() else { return }
        loading = true
        defer { loading = false }
        do { conversations = try await client.conversations(); error = nil }
        catch { error = error.localizedDescription }
    }

    private func startNew() async {
        guard let client = config.makeClient() else { return }
        do {
            let convo = try await client.createConversation()
            newConversationId = convo.id
        } catch { error = error.localizedDescription }
    }
}
```

NOTE: references `ConversationView` (Task 6) — create a minimal stub first (`struct ConversationView: View { let conversationId: String; var scopedItemId: String?; var body: some View { EmptyView() } }`) so this builds, then Task 6 replaces it.

- [ ] **Step 2: Wire into `RootView`**

```swift
            Tab("Ask", systemImage: "sparkles") {
                AskView()
            }
```

- [ ] **Step 3: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Commit**

```bash
git add ios/Flux/Ask/AskView.swift ios/Flux/RootView.swift
git commit -m "feat(ios): Ask tab — conversation list + new conversation"
```

---

### Task 6: Ask — streaming thread (`ChatViewModel`, `ConversationView`, `SourcesView`)

**Files:** Create `ios/Flux/Ask/ChatViewModel.swift`, `ios/Flux/Ask/ConversationView.swift`, `ios/Flux/Ask/SourcesView.swift`

- [ ] **Step 1: `ChatViewModel`**

`ios/Flux/Ask/ChatViewModel.swift`:

```swift
import Foundation
import Observation
import FluxAPI

/// One chat turn for display. `id` is the server id when persisted, else a temp id.
struct ChatMessage: Identifiable {
    var id: String
    var role: String          // "user" | "assistant"
    var content: String
    var sources: [SourceDTO]
    var status: String?       // transient streaming status (e.g. "Searching the web…")
    var isStreaming: Bool
}

@MainActor @Observable
final class ChatViewModel {
    let conversationId: String
    let scopedItemId: String?
    private let config: AppConfig

    var messages: [ChatMessage] = []
    var loading = false
    var error: String?
    var isStreaming: Bool { messages.last?.isStreaming == true }
    private var streamTask: Task<Void, Never>?

    init(conversationId: String, scopedItemId: String?, config: AppConfig) {
        self.conversationId = conversationId
        self.scopedItemId = scopedItemId
        self.config = config
    }

    func loadHistory() async {
        guard let client = config.makeClient() else { return }
        loading = true
        defer { loading = false }
        do {
            let detail = try await client.conversation(id: conversationId)
            messages = detail.messages.map {
                ChatMessage(id: $0.id, role: $0.role, content: $0.content,
                            sources: $0.sources ?? [], status: nil, isStreaming: false)
            }
            error = nil
        } catch { error = error.localizedDescription }
    }

    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let client = config.makeClient(), !isStreaming else { return }
        messages.append(ChatMessage(id: "u-\(UUID())", role: "user", content: trimmed,
                                    sources: [], status: nil, isStreaming: false))
        let assistantId = "a-\(UUID())"
        messages.append(ChatMessage(id: assistantId, role: "assistant", content: "",
                                    sources: [], status: nil, isStreaming: true))

        streamTask = Task {
            var webSources: [SourceDTO] = []
            do {
                for try await part in client.streamChat(conversationId: conversationId, content: trimmed, itemId: scopedItemId) {
                    guard let idx = messages.firstIndex(where: { $0.id == assistantId }) else { break }
                    switch part {
                    case .textDelta(let delta):
                        messages[idx].content += delta
                        messages[idx].status = nil
                    case .webSearchStatus(let query):
                        messages[idx].status = query.map { "Searching the web for \"\($0)\"" } ?? "Searching the web…"
                    case .webSource(let url, let title):
                        if !webSources.contains(where: { $0.url == url }) {
                            webSources.append(SourceDTO.web(url: url, title: title))
                            messages[idx].sources = webSources
                        }
                    }
                }
            } catch {
                if let idx = messages.firstIndex(where: { $0.id == assistantId }) {
                    messages[idx].status = nil
                }
                self.error = error.localizedDescription
            }
            // Refetch the canonical persisted turn (library [n] + web sources).
            await reconcileAfterStream(assistantId: assistantId)
        }
    }

    func stop() { streamTask?.cancel(); markDoneStreaming() }

    private func markDoneStreaming() {
        if let idx = messages.lastIndex(where: { $0.isStreaming }) {
            messages[idx].isStreaming = false
            messages[idx].status = nil
        }
    }

    private func reconcileAfterStream(assistantId: String) async {
        defer { markDoneStreaming() }
        guard let client = config.makeClient() else { return }
        // The assistant turn is persisted in onFinish; a brief retry covers the write race.
        for attempt in 0..<4 {
            if attempt > 0 { try? await Task.sleep(for: .milliseconds(400)) }
            guard let detail = try? await client.conversation(id: conversationId) else { continue }
            if let last = detail.messages.last, last.role == "assistant", !last.content.isEmpty {
                if let idx = messages.firstIndex(where: { $0.id == assistantId }) {
                    messages[idx] = ChatMessage(id: last.id, role: "assistant", content: last.content,
                                                sources: last.sources ?? [], status: nil, isStreaming: false)
                }
                return
            }
        }
    }
}
```

NOTE: uses `SourceDTO.web(url:title:)` — a convenience the DTO doesn't have. Since `SourceDTO`'s memberwise init may be internal, add a small static factory in the iOS app instead (extension in this file):

```swift
extension SourceDTO {
    /// Build a minimal web SourceDTO for live-streamed web results.
    static func web(url: String, title: String?) -> SourceDTO {
        SourceDTO(kind: .web, source: nil, itemId: "", itemTitle: title ?? url, startSec: 0,
                  podcastName: nil, artworkUrl: nil, audioUrl: nil, videoId: nil, url: url,
                  snippet: nil, content: nil, isHighlight: nil, isWeb: true)
    }
}
```

If `SourceDTO`'s memberwise init is not accessible from the app module, add a `public init(...)` to `SourceDTO` in `FluxModels.swift` (mirroring Task 0 of P2's `HighlightLocator` fix) as a sub-step, then rebuild the package. Verify accessibility during the build step and apply this fallback if needed.

- [ ] **Step 2: `SourcesView`**

`ios/Flux/Ask/SourcesView.swift`:

```swift
import SwiftUI
import FluxAPI

/// Grouped sources under an assistant message: library sources grouped by item
/// (with timestamp chips that navigate + seek), web sources as links.
struct SourcesView: View {
    let sources: [SourceDTO]
    @Environment(\.openURL) private var openURL

    private var library: [SourceDTO] { sources.filter { $0.kind != .web } }
    private var web: [SourceDTO] { sources.filter { $0.kind == .web } }

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
```

- [ ] **Step 3: `ConversationView`**

`ios/Flux/Ask/ConversationView.swift`:

```swift
import SwiftUI
import FluxAPI

struct ConversationView: View {
    let conversationId: String
    let scopedItemId: String?

    @Environment(AppConfig.self) private var config
    @State private var model: ChatViewModel?
    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        ForEach(model?.messages ?? []) { msg in
                            MessageBubble(message: msg).id(msg.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: model?.messages.last?.content) { _, _ in
                    if let last = model?.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            composer
        }
        .navigationTitle("Ask")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: ItemRoute.self) { ItemRouteDestination(route: $0) }
        .task {
            if model == nil {
                model = ChatViewModel(conversationId: conversationId, scopedItemId: scopedItemId, config: config)
                await model?.loadHistory()
            }
        }
    }

    @ViewBuilder private var composer: some View {
        HStack(spacing: 8) {
            TextField("Ask about your library…", text: $draft, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
            if model?.isStreaming == true {
                Button { model?.stop() } label: { Image(systemName: "stop.circle.fill").font(.title2) }
            } else {
                Button {
                    let text = draft; draft = ""
                    model?.send(text)
                } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding()
    }
}

private struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        if message.role == "user" {
            HStack {
                Spacer(minLength: 40)
                Text(message.content)
                    .padding(10)
                    .background(.tint, in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(.white)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if let status = message.status {
                    Label(status, systemImage: "magnifyingglass").font(.caption).foregroundStyle(.secondary)
                }
                if message.content.isEmpty && message.isStreaming && message.status == nil {
                    ProgressView()
                } else {
                    Text(attributed(message.content))
                }
                SourcesView(sources: message.sources)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func attributed(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}
```

- [ ] **Step 4: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED. (If `SourceDTO.web` fails to compile because the memberwise init is internal, add a `public init` to `SourceDTO` in `FluxModels.swift`, `swift build` the package, then rebuild.)

- [ ] **Step 5: Screenshot verification**

Dispatch apple-platform-builder: launch (live API) → Ask tab → new conversation → ask "What does the library say about design taste?" → screenshot mid-stream (text appearing / "searching" status) and after completion (answer + Sources disclosure). Save `/tmp/flux-p3-ask-streaming.png`, `/tmp/flux-p3-ask-done.png`. Confirm text streams in and sources appear; tapping a source opens the item.

- [ ] **Step 6: Commit**

```bash
git add ios/Flux/Ask/ChatViewModel.swift ios/Flux/Ask/ConversationView.swift ios/Flux/Ask/SourcesView.swift
git commit -m "feat(ios): Ask streaming thread — live tokens, web-search status, grouped sources"
```

---

### Task 7: Item-scoped "Ask about this"

**Files:** Modify `ios/Flux/Detail/ItemDetailView.swift`

- [ ] **Step 1: Add the toolbar button + navigation**

In `ItemDetailView`, add state + a toolbar button that creates an item-scoped conversation and navigates:

```swift
    @Environment(AppConfig.self) private var config
    @State private var askConversationId: String?
```

Add to the `ScrollView` modifiers:

```swift
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await startAsk() } } label: { Image(systemName: "sparkles") }
            }
        }
        .navigationDestination(item: $askConversationId) { id in
            ConversationView(conversationId: id, scopedItemId: item.id)
        }
```

And the method:

```swift
    private func startAsk() async {
        guard let client = config.makeClient() else { return }
        if let convo = try? await client.createConversation(itemId: item.id) {
            askConversationId = convo.id
        }
    }
```

- [ ] **Step 2: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Commit**

```bash
git add ios/Flux/Detail/ItemDetailView.swift
git commit -m "feat(ios): 'Ask about this' — item-scoped conversation from detail"
```

---

### Task 8: UI tests + final screenshot sweep

**Files:** Modify `ios/FluxUITests/FluxUITests.swift`

- [ ] **Step 1: Add screenshot tests**

Append to `FluxUITests` two tests that exercise the new tabs:

```swift
    func testHighlightsFeed() throws {
        let tab = app.tabBars.buttons["Highlights"]
        XCTAssertTrue(tab.waitForExistence(timeout: 5))
        tab.tap()
        Thread.sleep(forTimeInterval: 2.0)
        saveScreenshot("flux-highlights.png")
    }

    func testSearch() throws {
        let tab = app.tabBars.buttons["Search"]
        XCTAssertTrue(tab.waitForExistence(timeout: 5))
        tab.tap()
        let field = app.searchFields.firstMatch
        if field.waitForExistence(timeout: 5) {
            field.tap(); field.typeText("design")
        }
        Thread.sleep(forTimeInterval: 3.0)
        saveScreenshot("flux-search.png")
    }
```

- [ ] **Step 2: Run UI tests**

Dispatch apple-platform-builder: `xcodebuild test` the `Flux` scheme (FluxUITests). Expected: all tests pass; `/tmp/flux-highlights.png` and `/tmp/flux-search.png` written.

- [ ] **Step 3: Full manual sweep + commit**

Dispatch apple-platform-builder: capture the Ask streaming + done states and a highlight jump-to-source. Report any visual issues. Then:

```bash
git add ios/FluxUITests/FluxUITests.swift
git commit -m "test(ios): screenshot tests for Highlights + Search"
```

---

## Self-Review

**Spec coverage:** `streamChat` + `ChatStreamPart` (Task 0) ✓; Highlights tab w/ type filter + search + jump/seek, `Highlight.itemType` (Tasks 1, 3) ✓; Search tab items+moments tap/seek (Task 4) ✓; Ask conversation list (Task 5) + streaming thread w/ live status, web sources, post-stream canonical refetch, markdown, grouped sources, source tap-through (Task 6) ✓; item-scoped Ask (Task 7) ✓; `ItemRoute`/resolver + `ItemDetailView` initial seek (Task 2) ✓; UI-test screenshots (Task 8) ✓.

**Type consistency:** `ChatStreamPart` cases match the `ChatViewModel` switch; `ChatMessage` shape consistent across VM/views; `ItemRoute(itemId:seekSec:)` used identically in Highlights/Search/Sources/resolver; `ConversationView(conversationId:scopedItemId:)` signature matches all call sites (AskView, ItemDetailView, its own stub); `SourceDTO.web` factory used in VM and (if needed) backed by a `public init` on `SourceDTO`.

**Flagged checks (not placeholders):** confirm `SourceDTO`'s memberwise init is accessible from the app; if not, add a `public init` to `FluxModels.swift` (sub-step in Task 6). Confirm `SearchMoment.startSec` is `Int` (per FluxModels) — cast to `Double` for `ItemRoute.seekSec`/`timeString` (done in the plan). The `Highlight.itemType` non-optional column relies on SwiftData lightweight migration giving existing rows a default; if a migration error appears at runtime, delete+reinstall the app (data re-syncs).

**Risk:** `bytes.lines` splits on newlines; the AI SDK frames parts as `data: {json}\n` lines, so line-based parsing is correct, but if a single SSE event spans control framing differently than expected, the parser falls through (`default: break`) harmlessly — verified against the web `use-conversation.ts` which uses the same line/`data:` model.
