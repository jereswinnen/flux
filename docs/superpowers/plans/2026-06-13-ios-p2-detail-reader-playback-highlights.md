# iOS P2 — Item Detail, Reader, Playback & Highlights — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder item detail with a real per-type screen — article reader (with native-selection highlighting), native AVPlayer podcast playback (background + lock-screen), YouTube embed — plus full web-parity sections (insights, transcript, entities, highlights) and an optimistic offline highlight create/delete path.

**Architecture:** Native SwiftUI + SwiftData + Observation + system frameworks (AVFoundation, MediaPlayer, WebKit, UIKit interop). Detail bundles are fetched on open via `FluxClient.item(id:)` and cached in a new `ItemDetailCache` SwiftData model (read-later offline). Highlight writes go through the existing `PendingChange` outbox flushed by `SyncEngine`. No third-party packages.

**Tech Stack:** Swift 5/6, SwiftUI, SwiftData, Observation, AVFoundation, MediaPlayer, WebKit, `FluxAPI` (local SwiftPM). Xcode 26, iOS 26 simulator.

**Verification model:** This project has **no XCTest target** (the owner declined test-only scaffolding in P1 to keep the app clean/native). Each task is verified by a **green `xcodebuild`** (via the `apple-platform-build-tools:apple-platform-builder` agent) and, where noted, a **`simctl` screenshot** against the live Railway API (`https://flux-production-32de.up.railway.app`, no token). Keep logic pieces small and reviewable in lieu of unit tests.

**Files created (overview):**
- `clients/swift/Sources/FluxAPI/FluxModels.swift` (modify — public init on `HighlightLocator`)
- `ios/Flux/Models/ItemDetailCache.swift`
- `ios/Flux/Sync/DetailLoader.swift`
- `ios/Flux/Sync/HighlightStore.swift` (optimistic create/delete + reconcile helper)
- `ios/Flux/Sync/SyncEngine.swift` (modify — outbox create/delete + reconcile)
- `ios/Flux/Detail/ItemDetailView.swift`
- `ios/Flux/Detail/ArticleReaderView.swift`
- `ios/Flux/Detail/HTMLTextView.swift`
- `ios/Flux/Detail/Sections/InsightsSection.swift`
- `ios/Flux/Detail/Sections/TranscriptSection.swift`
- `ios/Flux/Detail/Sections/EntitiesSection.swift`
- `ios/Flux/Detail/Sections/HighlightsSection.swift`
- `ios/Flux/Player/AudioPlayer.swift`
- `ios/Flux/Player/AudioPlayerBar.swift`
- `ios/Flux/Player/YouTubeEmbedView.swift`
- `ios/Flux/Library/LibraryView.swift` (modify — NavigationLink → `ItemDetailView`)
- `ios/Flux/FluxApp.swift` (modify — register `ItemDetailCache`, inject `AudioPlayer`)
- `ios/Flux/RootView.swift` (modify — construct + inject `DetailLoader` and `AudioPlayer`)
- `ios/Flux.xcodeproj/project.pbxproj` (modify — `UIBackgroundModes = audio`)

---

### Task 0: FluxAPI — public initializer for `HighlightLocator`

The iOS app must construct `HighlightLocator` values (for takeaway/quote highlights). The struct's memberwise init is `internal`, so add a `public init`.

**Files:**
- Modify: `clients/swift/Sources/FluxAPI/FluxModels.swift` (the `HighlightLocator` struct, ~line 280-290)

- [ ] **Step 1: Add the public init**

In `FluxModels.swift`, inside `public struct HighlightLocator`, after the stored properties, add:

```swift
    public init(
        sec: Double? = nil,
        segmentStart: Double? = nil,
        index: Int? = nil,
        charStart: Int? = nil,
        charEnd: Int? = nil,
        location: String? = nil
    ) {
        self.sec = sec
        self.segmentStart = segmentStart
        self.index = index
        self.charStart = charStart
        self.charEnd = charEnd
        self.location = location
    }
```

- [ ] **Step 2: Build the package**

Run: `cd clients/swift && swift build`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add clients/swift/Sources/FluxAPI/FluxModels.swift
git commit -m "feat(swift): public init for HighlightLocator so clients can build locators"
```

---

### Task 1: `ItemDetailCache` SwiftData model

Caches the fetched detail bundle so saved items read offline. Stores nested DTOs as JSON strings to keep the model flat.

**Files:**
- Create: `ios/Flux/Models/ItemDetailCache.swift`
- Modify: `ios/Flux/FluxApp.swift`

- [ ] **Step 1: Create the model**

`ios/Flux/Models/ItemDetailCache.swift`:

```swift
import Foundation
import SwiftData
import FluxAPI

/// On-open cache of an item's full detail bundle (GET /api/items/{id}).
/// Nested DTOs are stored as JSON strings so the SwiftData model stays flat;
/// `decoded()` rehydrates the typed FluxAPI DTOs.
@Model
final class ItemDetailCache {
    @Attribute(.unique) var itemId: String
    var contentHtml: String?
    var transcriptJSON: String?
    var insightsJSON: String?
    var entitiesJSON: String?
    var fetchedAt: Date

    init(
        itemId: String,
        contentHtml: String?,
        transcriptJSON: String?,
        insightsJSON: String?,
        entitiesJSON: String?,
        fetchedAt: Date
    ) {
        self.itemId = itemId
        self.contentHtml = contentHtml
        self.transcriptJSON = transcriptJSON
        self.insightsJSON = insightsJSON
        self.entitiesJSON = entitiesJSON
        self.fetchedAt = fetchedAt
    }

    // MARK: - Decoded accessors

    var transcript: TranscriptDTO? { Self.decode(transcriptJSON) }
    var insights: InsightsDTO? { Self.decode(insightsJSON) }
    var entities: [MentionedEntity] { Self.decode(entitiesJSON) ?? [] }

    private static func decode<T: Decodable>(_ json: String?) -> T? {
        guard let json, let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
```

- [ ] **Step 2: Register the model in the container**

In `ios/Flux/FluxApp.swift`, change the `.modelContainer` line:

```swift
        .modelContainer(for: [Item.self, Highlight.self, PendingChange.self, ItemDetailCache.self])
```

- [ ] **Step 3: Build**

Dispatch apple-platform-builder: build the `Flux` scheme for an iPhone 17 simulator.
Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Commit**

```bash
git add ios/Flux/Models/ItemDetailCache.swift ios/Flux/FluxApp.swift
git commit -m "feat(ios): ItemDetailCache SwiftData model for offline detail bundles"
```

---

### Task 2: `DetailLoader` service

Fetches the detail bundle on open, upserts the cache + the returned highlights. Cache-first; refreshes when online.

**Files:**
- Create: `ios/Flux/Sync/DetailLoader.swift`
- Modify: `ios/Flux/RootView.swift`

- [ ] **Step 1: Create the loader**

`ios/Flux/Sync/DetailLoader.swift`:

```swift
import Foundation
import Observation
import SwiftData
import FluxAPI

@MainActor @Observable
final class DetailLoader {
    private let context: ModelContext
    private let config: AppConfig

    /// Item ids whose detail fetch is currently in flight (drives per-item spinners).
    var loading: Set<String> = []
    var lastError: String?

    init(context: ModelContext, config: AppConfig) {
        self.context = context
        self.config = config
    }

    /// Fetch + cache the detail bundle. Safe to call repeatedly; the view shows any
    /// existing cache immediately, and this refreshes it in the background.
    func load(itemId: String) async {
        guard let client = config.makeClient(), !loading.contains(itemId) else { return }
        loading.insert(itemId)
        defer { loading.remove(itemId) }
        do {
            let detail = try await client.item(id: itemId)
            upsertCache(itemId: itemId, detail: detail)
            for dto in detail.highlights { upsertHighlight(dto) }
            try context.save()
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func upsertCache(itemId: String, detail: ItemDetail) {
        let enc = JSONEncoder()
        func encode<T: Encodable>(_ value: T?) -> String? {
            guard let value, let data = try? enc.encode(value) else { return nil }
            return String(data: data, encoding: .utf8)
        }
        let contentHtml = detail.transcript?.contentHtml
        let transcriptJSON = encode(detail.transcript)
        let insightsJSON = encode(detail.insights)
        let entitiesJSON = encode(detail.entities)

        let existing = try? context.fetch(
            FetchDescriptor<ItemDetailCache>(predicate: #Predicate { $0.itemId == itemId })
        ).first
        if let row = existing {
            row.contentHtml = contentHtml
            row.transcriptJSON = transcriptJSON
            row.insightsJSON = insightsJSON
            row.entitiesJSON = entitiesJSON
            row.fetchedAt = Date()
        } else {
            context.insert(ItemDetailCache(
                itemId: itemId,
                contentHtml: contentHtml,
                transcriptJSON: transcriptJSON,
                insightsJSON: insightsJSON,
                entitiesJSON: entitiesJSON,
                fetchedAt: Date()
            ))
        }
    }

    private func upsertHighlight(_ dto: HighlightDTO) {
        let id = dto.id
        let existing = try? context.fetch(
            FetchDescriptor<Highlight>(predicate: #Predicate { $0.id == id })
        ).first
        if let h = existing { h.apply(dto) } else { context.insert(Highlight(from: dto)) }
    }
}
```

- [ ] **Step 2: Construct + inject in RootView**

In `ios/Flux/RootView.swift`, add a `@State private var detail: DetailLoader?` alongside `sync`, construct it in the `.task` block, and inject via `.environment`. The updated body:

```swift
    @State private var sync: SyncEngine?
    @State private var detail: DetailLoader?

    var body: some View {
        TabView {
            // ... unchanged tabs ...
        }
        .environment(sync)
        .environment(detail)
        .task {
            if sync == nil { sync = SyncEngine(context: context, config: config) }
            if detail == nil { detail = DetailLoader(context: context, config: config) }
            await sync?.sync()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await sync?.sync() } }
        }
    }
```

(Keep the existing `Tab(...)` contents exactly as they are.)

- [ ] **Step 3: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Commit**

```bash
git add ios/Flux/Sync/DetailLoader.swift ios/Flux/RootView.swift
git commit -m "feat(ios): DetailLoader — fetch + cache item detail bundles on open"
```

---

### Task 3: `ItemDetailView` scaffold + wire from Library

The detail entry point: header, per-type switch (stubs for now), shared-section container reading the cache.

**Files:**
- Create: `ios/Flux/Detail/ItemDetailView.swift`
- Modify: `ios/Flux/Library/LibraryView.swift`

- [ ] **Step 1: Create the detail view**

`ios/Flux/Detail/ItemDetailView.swift`:

```swift
import SwiftUI
import SwiftData
import FluxAPI

struct ItemDetailView: View {
    let item: Item

    @Environment(DetailLoader.self) private var detailLoader: DetailLoader?
    @Query private var caches: [ItemDetailCache]

    init(item: Item) {
        self.item = item
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
        .task { await detailLoader?.load(itemId: item.id) }
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
```

NOTE: This task references `ArticleReaderView`, `AudioPlayerBar`, `YouTubeEmbedView`, `InsightsSection`, `TranscriptSection`, `EntitiesSection`, `HighlightsSection` which are created in later tasks. To keep this task building green, **create minimal stub files** for each now (each just `import SwiftUI` + a `struct X: View { ... var body: some View { EmptyView() } }` with the exact init signature used above). Later tasks replace the stub bodies. Stub signatures:
- `ArticleReaderView(item: Item, contentHtml: String)`
- `AudioPlayerBar(item: Item)`
- `YouTubeEmbedView(videoId: String)`
- `InsightsSection(item: Item, insights: InsightsDTO)`
- `TranscriptSection(item: Item, transcript: TranscriptDTO)`
- `EntitiesSection(entities: [MentionedEntity])`
- `HighlightsSection(itemId: String)`

Create the stubs in their final file paths (per the Files overview) so later tasks just edit them.

- [ ] **Step 2: Wire the NavigationLink**

In `ios/Flux/Library/LibraryView.swift`, replace the placeholder `NavigationLink { VStack… }` destination (lines ~106-114) with:

```swift
            NavigationLink {
                ItemDetailView(item: item)
            } label: {
                ItemRow(item: item)
            }
```

- [ ] **Step 3: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Commit**

```bash
git add ios/Flux/Detail ios/Flux/Player ios/Flux/Library/LibraryView.swift
git commit -m "feat(ios): ItemDetailView scaffold + per-type switch + section stubs, wired from Library"
```

---

### Task 4: Article reader — `HTMLTextView` + `ArticleReaderView`

Render sanitized `contentHtml` as styled, selectable text via a `UITextView` wrapped in `UIViewRepresentable`.

**Files:**
- Create: `ios/Flux/Detail/HTMLTextView.swift`
- Modify (replace stub): `ios/Flux/Detail/ArticleReaderView.swift`

- [ ] **Step 1: Create `HTMLTextView`**

`ios/Flux/Detail/HTMLTextView.swift`:

```swift
import SwiftUI
import UIKit

/// Renders sanitized HTML as a selectable, non-editable UITextView sized to its content.
/// Conversion (WebKit-backed, main-thread) is memoized in the coordinator.
/// `highlightRanges` get a background fill; tapping one calls `onTapHighlight`.
struct HTMLTextView: UIViewRepresentable {
    let html: String
    /// Substrings to mark as highlights (matched first-occurrence) + their highlight id.
    var highlights: [(id: String, text: String)] = []
    var onTapHighlight: ((String) -> Void)? = nil
    /// Called with the user's selected substring when they tap the "Highlight" menu item.
    var onCreateHighlight: ((String) -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.isEditable = false
        tv.isSelectable = true
        tv.isScrollEnabled = false
        tv.backgroundColor = .clear
        tv.textContainerInset = .zero
        tv.textContainer.lineFragmentPadding = 0
        tv.delegate = context.coordinator
        context.coordinator.textView = tv
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        context.coordinator.parent = self
        let attributed = context.coordinator.attributedString(for: html)
        let mutable = NSMutableAttributedString(attributedString: attributed)
        context.coordinator.applyHighlights(into: mutable)
        tv.attributedText = mutable
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: HTMLTextView
        weak var textView: UITextView?
        private var cachedHTML: String?
        private var cached: NSAttributedString?

        init(_ parent: HTMLTextView) { self.parent = parent }

        /// Convert + style once per unique html string.
        func attributedString(for html: String) -> NSAttributedString {
            if cachedHTML == html, let cached { return cached }
            let data = Data(html.utf8)
            let base: NSAttributedString
            if let parsed = try? NSAttributedString(
                data: data,
                options: [
                    .documentType: NSAttributedString.DocumentType.html,
                    .characterEncoding: String.Encoding.utf8.rawValue
                ],
                documentAttributes: nil
            ) {
                base = parsed
            } else {
                base = NSAttributedString(string: html)
            }
            let styled = NSMutableAttributedString(attributedString: base)
            let full = NSRange(location: 0, length: styled.length)
            let body = UIFont.preferredFont(forTextStyle: .body)
            let serif = UIFont(descriptor: body.fontDescriptor.withDesign(.serif) ?? body.fontDescriptor, size: body.pointSize)
            let para = NSMutableParagraphStyle()
            para.lineSpacing = 4
            para.paragraphSpacing = 12
            styled.addAttribute(.font, value: serif, range: full)
            styled.addAttribute(.foregroundColor, value: UIColor.label, range: full)
            styled.addAttribute(.paragraphStyle, value: para, range: full)
            cachedHTML = html
            cached = styled
            return styled
        }

        func applyHighlights(into text: NSMutableAttributedString) {
            let ns = text.string as NSString
            for hl in parent.highlights {
                let range = ns.range(of: hl.text)
                if range.location != NSNotFound {
                    text.addAttribute(.backgroundColor, value: UIColor.systemYellow.withAlphaComponent(0.35), range: range)
                    text.addAttribute(.init("hlid"), value: hl.id, range: range)
                }
            }
        }

        // Tap on a marked range → delete callback
        func textView(_ textView: UITextView, shouldInteractWith URL: URL, in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool { false }

        // Custom "Highlight" edit-menu action
        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            guard range.length > 0, let onCreate = parent.onCreateHighlight else {
                return UIMenu(children: suggestedActions)
            }
            let selected = (textView.text as NSString).substring(with: range)
            let highlight = UIAction(title: "Highlight", image: UIImage(systemName: "highlighter")) { _ in
                onCreate(selected)
            }
            return UIMenu(children: [highlight] + suggestedActions)
        }
    }
}
```

NOTE on tap-to-delete: detecting taps on a marked range uses a `UITapGestureRecognizer` added in `makeUIView`; for clarity that wiring is added in Task 6 when delete is implemented. For Task 4, selection + create-menu + display marking is sufficient.

- [ ] **Step 2: Replace the `ArticleReaderView` stub**

`ios/Flux/Detail/ArticleReaderView.swift`:

```swift
import SwiftUI
import SwiftData
import FluxAPI

struct ArticleReaderView: View {
    let item: Item
    let contentHtml: String

    var body: some View {
        HTMLTextView(html: contentHtml)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
```

(Highlight wiring is added in Task 6.)

- [ ] **Step 3: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Screenshot verification**

Dispatch apple-platform-builder: launch the app (configured to the live API — set Server URL `https://flux-production-32de.up.railway.app`, no token, via Settings), open the article "AI Broke Interviews", and `simctl` screenshot the rendered article body. Confirm the body renders with serif styling and text is selectable (a long-press shows the menu with "Highlight"). Save to `/tmp/flux-p2-article.png`.

- [ ] **Step 5: Commit**

```bash
git add ios/Flux/Detail/HTMLTextView.swift ios/Flux/Detail/ArticleReaderView.swift
git commit -m "feat(ios): article reader — HTML render with serif typography + selectable text"
```

---

### Task 5: Highlight write path — outbox create/delete + `HighlightStore`

Extend the outbox flush to push creates/deletes and reconcile optimistic temp ids. Add a small `HighlightStore` helper for optimistic local mutations.

**Files:**
- Modify: `ios/Flux/Sync/SyncEngine.swift`
- Create: `ios/Flux/Sync/HighlightStore.swift`

- [ ] **Step 1: Add outbox payloads + extend the flush switch**

In `ios/Flux/Sync/SyncEngine.swift`, add payload types next to `ReadStatePayload`:

```swift
struct CreateHighlightPayload: Codable {
    let tempId: String       // the optimistic local Highlight.id
    let itemId: String
    let kind: String
    let text: String
    let note: String?
    let locator: HighlightLocator?
}

struct DeleteHighlightPayload: Codable {
    let id: String
}
```

Replace the `flushOutbox` body's `switch`/delete loop with one that only deletes the `PendingChange` on success and reconciles the temp id on create:

```swift
    func flushOutbox(_ client: FluxClient) async throws {
        let pending = (try? context.fetch(
            FetchDescriptor<PendingChange>(sortBy: [SortDescriptor(\.createdAt)])
        )) ?? []

        for change in pending {
            do {
                switch change.kind {
                case "setReadState":
                    guard let p = decode(change.payloadJSON, as: ReadStatePayload.self),
                          let state = ItemReadState(rawValue: p.readState) else { break }
                    _ = try await client.setReadState(id: p.id, state)

                case "createHighlight":
                    guard let p = decode(change.payloadJSON, as: CreateHighlightPayload.self),
                          let kind = HighlightKind(rawValue: p.kind) else { break }
                    let raw = try await client.createHighlight(
                        itemId: p.itemId, kind: kind, text: p.text,
                        note: p.note, locator: p.locator
                    )
                    reconcileCreatedHighlight(tempId: p.tempId, serverId: raw.id)

                case "deleteHighlight":
                    guard let p = decode(change.payloadJSON, as: DeleteHighlightPayload.self) else { break }
                    try await client.deleteHighlight(id: p.id)

                default:
                    break
                }
            } catch {
                // Stop on first failure; retry the whole queue on the next sync.
                throw error
            }
            context.delete(change)
        }
        if !pending.isEmpty { try context.save() }
    }

    /// Re-key an optimistic highlight from its temp id to the server-assigned id,
    /// so the next delta-sync upsert matches it instead of inserting a duplicate.
    private func reconcileCreatedHighlight(tempId: String, serverId: String) {
        let existing = try? context.fetch(
            FetchDescriptor<Highlight>(predicate: #Predicate { $0.id == tempId })
        ).first
        existing?.id = serverId
    }
```

(Note: because the flush now throws on first failure, `sync()` already wraps it in do/catch and surfaces `lastError`. The remaining unsent `PendingChange`s stay queued.)

- [ ] **Step 2: Create `HighlightStore`**

`ios/Flux/Sync/HighlightStore.swift`:

```swift
import Foundation
import SwiftData
import FluxAPI

/// Optimistic, offline-first highlight create/delete against the local SwiftData store + outbox.
/// Call `flush` (via SyncEngine) afterwards isn't required here — the next sync flushes the outbox,
/// but callers may trigger an immediate sync for snappiness.
@MainActor
enum HighlightStore {
    /// Create a highlight optimistically. Returns the temp id of the local row.
    @discardableResult
    static func create(
        in context: ModelContext,
        item: Item,
        kind: HighlightKind,
        text: String,
        note: String? = nil,
        locator: HighlightLocator? = nil
    ) -> String {
        let tempId = "temp-" + UUID().uuidString
        let now = Date()
        let local = Highlight(
            id: tempId, itemId: item.id, kind: kind.rawValue, text: text, note: note,
            createdAt: now, updatedAt: now, jumpHref: "/items/\(item.id)",
            itemTitle: item.title, itemSource: item.source, itemArtworkUrl: item.artworkUrl
        )
        context.insert(local)
        let payload = CreateHighlightPayload(
            tempId: tempId, itemId: item.id, kind: kind.rawValue,
            text: text, note: note, locator: locator
        )
        enqueue(in: context, kind: "createHighlight", payload: payload)
        try? context.save()
        return tempId
    }

    /// Delete a highlight optimistically. If it was never synced (temp id), just drop the
    /// queued create instead of sending a delete for an id the server never saw.
    static func delete(in context: ModelContext, highlight: Highlight) {
        let id = highlight.id
        context.delete(highlight)
        if id.hasPrefix("temp-") {
            dropPendingCreate(in: context, tempId: id)
        } else {
            enqueue(in: context, kind: "deleteHighlight", payload: DeleteHighlightPayload(id: id))
        }
        try? context.save()
    }

    private static func enqueue<T: Encodable>(in context: ModelContext, kind: String, payload: T) {
        guard let data = try? JSONEncoder().encode(payload),
              let json = String(data: data, encoding: .utf8) else { return }
        context.insert(PendingChange(kind: kind, payloadJSON: json))
    }

    private static func dropPendingCreate(in context: ModelContext, tempId: String) {
        let pending = (try? context.fetch(
            FetchDescriptor<PendingChange>(predicate: #Predicate { $0.kind == "createHighlight" })
        )) ?? []
        for change in pending where change.payloadJSON.contains(tempId) {
            context.delete(change)
        }
    }
}
```

- [ ] **Step 3: Add the convenience `Highlight` initializer**

`HighlightStore` uses a memberwise `Highlight` init that doesn't exist yet (the model only has `init(from dto:)`). In `ios/Flux/Models/Highlight.swift`, add:

```swift
    init(
        id: String, itemId: String, kind: String, text: String, note: String?,
        createdAt: Date, updatedAt: Date, jumpHref: String,
        itemTitle: String, itemSource: String?, itemArtworkUrl: String?
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
    }
```

- [ ] **Step 4: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED.

- [ ] **Step 5: Commit**

```bash
git add ios/Flux/Sync/SyncEngine.swift ios/Flux/Sync/HighlightStore.swift ios/Flux/Models/Highlight.swift
git commit -m "feat(ios): optimistic highlight create/delete via outbox + temp-id reconcile"
```

---

### Task 6: Article highlight display + create + tap-to-delete

Wire the reader to show existing `article` highlights, create from selection, and delete on tap.

**Files:**
- Modify: `ios/Flux/Detail/ArticleReaderView.swift`
- Modify: `ios/Flux/Detail/HTMLTextView.swift` (tap gesture for delete)

- [ ] **Step 1: Add the tap-to-delete gesture to `HTMLTextView`**

In `HTMLTextView.makeUIView`, after configuring `tv`, add a tap recognizer:

```swift
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        tap.cancelsTouchesInView = false
        tv.addGestureRecognizer(tap)
```

In `Coordinator`, add:

```swift
        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let tv = textView, let onTap = parent.onTapHighlight else { return }
            let point = gesture.location(in: tv)
            guard let position = tv.closestPosition(to: point),
                  let range = tv.tokenizer.rangeEnclosingPosition(position, with: .character, inDirection: .layout(.right)) else { return }
            let offset = tv.offset(from: tv.beginningOfDocument, to: range.start)
            guard let attributed = tv.attributedText, offset >= 0, offset < attributed.length else { return }
            if let id = attributed.attribute(.init("hlid"), at: offset, effectiveRange: nil) as? String {
                onTap(id)
            }
        }
```

- [ ] **Step 2: Wire `ArticleReaderView` to the store + highlights**

`ios/Flux/Detail/ArticleReaderView.swift`:

```swift
import SwiftUI
import SwiftData
import FluxAPI

struct ArticleReaderView: View {
    let item: Item
    let contentHtml: String

    @Environment(\.modelContext) private var context
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @Query private var highlights: [Highlight]
    @State private var pendingDelete: Highlight?

    init(item: Item, contentHtml: String) {
        self.item = item
        self.contentHtml = contentHtml
        let id = item.id
        _highlights = Query(filter: #Predicate<Highlight> { $0.itemId == id && $0.kind == "article" })
    }

    var body: some View {
        HTMLTextView(
            html: contentHtml,
            highlights: highlights.map { (id: $0.id, text: $0.text) },
            onTapHighlight: { id in
                pendingDelete = highlights.first { $0.id == id }
            },
            onCreateHighlight: { text in
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return }
                HighlightStore.create(in: context, item: item, kind: .article, text: trimmed)
                Task { await sync?.sync() }
            }
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .confirmationDialog(
            "Remove highlight?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            presenting: pendingDelete
        ) { hl in
            Button("Remove highlight", role: .destructive) {
                HighlightStore.delete(in: context, highlight: hl)
                pendingDelete = nil
                Task { await sync?.sync() }
            }
        } message: { hl in
            Text(hl.text)
        }
    }
}
```

- [ ] **Step 3: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Screenshot verification**

Dispatch apple-platform-builder: open an article, select text → tap "Highlight", confirm the mark appears (yellow). Tap the mark → confirm the "Remove highlight?" dialog. `simctl` screenshot both states to `/tmp/flux-p2-highlight-*.png`.

- [ ] **Step 5: Commit**

```bash
git add ios/Flux/Detail/ArticleReaderView.swift ios/Flux/Detail/HTMLTextView.swift
git commit -m "feat(ios): article highlights — create from selection, display, tap-to-delete"
```

---

### Task 7: Shared sections — Insights, Transcript, Entities, Highlights

Replace the four stubs with real content (full web parity, display + takeaway/quote highlight creation).

**Files:**
- Modify (replace stubs): `ios/Flux/Detail/Sections/InsightsSection.swift`, `TranscriptSection.swift`, `EntitiesSection.swift`, `HighlightsSection.swift`

- [ ] **Step 1: `InsightsSection`**

`ios/Flux/Detail/Sections/InsightsSection.swift`:

```swift
import SwiftUI
import SwiftData
import FluxAPI

struct InsightsSection: View {
    let item: Item
    let insights: InsightsDTO

    @Environment(\.modelContext) private var context
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @Environment(AudioPlayer.self) private var player: AudioPlayer?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let summary = insights.summary, !summary.isEmpty {
                sectionHeader("Summary")
                Text(summary).font(.callout)
            }
            if let takeaways = insights.takeaways, !takeaways.isEmpty {
                sectionHeader("Takeaways")
                ForEach(Array(takeaways.enumerated()), id: \.offset) { idx, t in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "circle.fill").font(.system(size: 5)).padding(.top, 7)
                        Text(t).font(.callout)
                        Spacer(minLength: 0)
                    }
                    .contextMenu {
                        Button("Highlight", systemImage: "highlighter") {
                            HighlightStore.create(in: context, item: item, kind: .takeaway, text: t,
                                                  locator: HighlightLocator(index: idx))
                            Task { await sync?.sync() }
                        }
                    }
                }
            }
            if let topics = insights.topics, !topics.isEmpty {
                sectionHeader("Topics")
                FlowChips(topics: topics)
            }
            if let chapters = insights.chapters, !chapters.isEmpty {
                sectionHeader("Chapters")
                ForEach(Array(chapters.enumerated()), id: \.offset) { _, ch in
                    Button {
                        player?.seek(to: ch.startSec)
                    } label: {
                        HStack {
                            Text(ch.title).font(.callout)
                            Spacer()
                            Text(timeString(ch.startSec)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(item.type != "podcast")
                }
            }
            if let quotes = insights.quotes, !quotes.isEmpty {
                sectionHeader("Notable quotes")
                ForEach(Array(quotes.enumerated()), id: \.offset) { idx, q in
                    Text("\u{201C}\(q.text)\u{201D}")
                        .font(.callout.italic())
                        .padding(.leading, 8)
                        .overlay(alignment: .leading) { Rectangle().frame(width: 3).foregroundStyle(.tint) }
                        .contextMenu {
                            Button("Highlight", systemImage: "highlighter") {
                                HighlightStore.create(in: context, item: item, kind: .quote, text: q.text,
                                                      locator: HighlightLocator(sec: q.approxTimestampSec, index: idx))
                                Task { await sync?.sync() }
                            }
                        }
                }
            }
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title).font(.headline)
    }
}

private struct FlowChips: View {
    let topics: [String]
    var body: some View {
        // Simple wrapping via a LazyVGrid of adaptive columns.
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 80), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
            ForEach(topics, id: \.self) { topic in
                Text(topic)
                    .font(.caption)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(.quaternary, in: Capsule())
            }
        }
    }
}

func timeString(_ seconds: Double) -> String {
    let s = Int(seconds)
    let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
}
```

NOTE: `Quote.approxTimestampSec` is non-optional `Double` per the DTO; pass it directly. `Chapter.startSec` is `Double`. Verify these member names against `FluxModels.swift` (`Chapter { title, startSec }`, `Quote { text, approxTimestampSec }`) before building; adjust if the Swift names differ.

- [ ] **Step 2: `TranscriptSection`**

`ios/Flux/Detail/Sections/TranscriptSection.swift`:

```swift
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
```

- [ ] **Step 3: `EntitiesSection`**

`ios/Flux/Detail/Sections/EntitiesSection.swift`:

```swift
import SwiftUI
import FluxAPI

struct EntitiesSection: View {
    let entities: [MentionedEntity]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Mentioned").font(.headline)
            ForEach(entities, id: \.id) { entity in
                HStack(alignment: .top, spacing: 12) {
                    AsyncImage(url: entity.imageUrl.flatMap(URL.init)) { img in
                        img.resizable().scaledToFill()
                    } placeholder: {
                        Color.secondary.opacity(0.15)
                    }
                    .frame(width: 40, height: 40)
                    .clipShape(RoundedRectangle(cornerRadius: 6))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(entity.name).font(.callout.bold())
                        Text(entity.type).font(.caption2).foregroundStyle(.secondary)
                        if let desc = entity.description, !desc.isEmpty {
                            Text(desc).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
        }
    }
}
```

- [ ] **Step 4: `HighlightsSection`**

`ios/Flux/Detail/Sections/HighlightsSection.swift`:

```swift
import SwiftUI
import SwiftData
import FluxAPI

struct HighlightsSection: View {
    let itemId: String

    @Environment(\.modelContext) private var context
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @Query private var highlights: [Highlight]

    init(itemId: String) {
        self.itemId = itemId
        _highlights = Query(
            filter: #Predicate<Highlight> { $0.itemId == itemId },
            sort: \Highlight.createdAt, order: .reverse
        )
    }

    var body: some View {
        if !highlights.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Highlights").font(.headline)
                ForEach(highlights, id: \.id) { hl in
                    HStack(alignment: .top, spacing: 8) {
                        Rectangle().frame(width: 3).foregroundStyle(.yellow)
                        Text(hl.text).font(.callout)
                        Spacer(minLength: 0)
                        Button(role: .destructive) {
                            HighlightStore.delete(in: context, highlight: hl)
                            Task { await sync?.sync() }
                        } label: {
                            Image(systemName: "trash").font(.caption)
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 5: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED. (If `Chapter`/`Quote` member names differ from the plan, fix per the actual `FluxModels.swift` definitions.)

- [ ] **Step 6: Screenshot verification**

Dispatch apple-platform-builder: open an item that has insights (e.g. a Founders podcast) and `simctl` screenshot the Insights + Transcript + Entities + Highlights sections to `/tmp/flux-p2-sections.png`.

- [ ] **Step 7: Commit**

```bash
git add ios/Flux/Detail/Sections
git commit -m "feat(ios): detail sections — insights, transcript, entities, highlights (web parity)"
```

---

### Task 8: Audio player — `AudioPlayer` + `AudioPlayerBar` + background mode

Native AVPlayer with background audio + lock-screen/Control Center controls.

**Files:**
- Modify (replace stub): `ios/Flux/Player/AudioPlayer.swift` (create as a service, not a view)
- Modify (replace stub): `ios/Flux/Player/AudioPlayerBar.swift`
- Modify: `ios/Flux/FluxApp.swift` (inject `AudioPlayer`)
- Modify: `ios/Flux/RootView.swift` (construct + inject `AudioPlayer`)
- Modify: `ios/Flux.xcodeproj/project.pbxproj` (`UIBackgroundModes = audio`)

- [ ] **Step 1: Create the `AudioPlayer` service**

`ios/Flux/Player/AudioPlayer.swift`:

```swift
import Foundation
import Observation
import AVFoundation
import MediaPlayer
import FluxAPI

@MainActor @Observable
final class AudioPlayer {
    private let player = AVPlayer()
    private var timeObserver: Any?

    var currentItemId: String?
    var isPlaying = false
    var currentTime: Double = 0
    var duration: Double = 0
    var rate: Float = 1.0
    var errorMessage: String?

    init() {
        configureSession()
        configureRemoteCommands()
        addTimeObserver()
    }

    func load(item: Item) {
        guard currentItemId != item.id else { return }
        guard let urlString = item.audioUrl, let url = URL(string: urlString) else {
            errorMessage = "No audio for this item."
            return
        }
        errorMessage = nil
        currentItemId = item.id
        let playerItem = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: playerItem)
        duration = item.durationSec.map(Double.init) ?? 0
        updateNowPlaying(item: item)
    }

    func togglePlayPause() { isPlaying ? pause() : play() }

    func play() {
        try? AVAudioSession.sharedInstance().setActive(true)
        player.rate = rate
        isPlaying = true
        updateNowPlayingPlayback()
    }

    func pause() {
        player.pause()
        isPlaying = false
        updateNowPlayingPlayback()
    }

    func seek(to seconds: Double) {
        player.seek(to: CMTime(seconds: max(0, seconds), preferredTimescale: 600))
        currentTime = seconds
        updateNowPlayingPlayback()
    }

    func skip(_ delta: Double) { seek(to: currentTime + delta) }

    func setRate(_ newRate: Float) {
        rate = newRate
        if isPlaying { player.rate = newRate }
    }

    // MARK: - Private

    private func configureSession() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
    }

    private func addTimeObserver() {
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard let self else { return }
            Task { @MainActor in
                self.currentTime = time.seconds
                if let d = self.player.currentItem?.duration.seconds, d.isFinite, d > 0 {
                    self.duration = d
                }
                self.updateNowPlayingPlayback()
            }
        }
    }

    private func configureRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in self?.play(); return .success }
        c.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
        c.skipForwardCommand.preferredIntervals = [15]
        c.skipForwardCommand.addTarget { [weak self] _ in self?.skip(15); return .success }
        c.skipBackwardCommand.preferredIntervals = [15]
        c.skipBackwardCommand.addTarget { [weak self] _ in self?.skip(-15); return .success }
        c.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.seek(to: e.positionTime); return .success
        }
    }

    private func updateNowPlaying(item: Item) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: item.title,
            MPMediaItemPropertyArtist: item.source ?? "",
        ]
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func updateNowPlayingPlayback() {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? Double(rate) : 0.0
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
```

- [ ] **Step 2: Create `AudioPlayerBar`**

`ios/Flux/Player/AudioPlayerBar.swift`:

```swift
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
```

- [ ] **Step 3: Inject `AudioPlayer`**

In `ios/Flux/RootView.swift`, add `@State private var audio = AudioPlayer()` and `.environment(audio)` on the `TabView`. (The `AudioPlayer` doesn't need a `ModelContext`, so a plain `@State` initializer is fine.)

In `ios/Flux/FluxApp.swift` — no change needed if injected from RootView; but ensure `AudioPlayer` is created once. (RootView `@State` is created once per app launch — acceptable.)

- [ ] **Step 4: Add the `audio` background mode**

The project uses `GENERATE_INFOPLIST_FILE = YES`. Add the background mode via build settings in `ios/Flux.xcodeproj/project.pbxproj` — to BOTH the Debug and Release `XCBuildConfiguration` blocks of the `Flux` app target, add:

```
INFOPLIST_KEY_UIBackgroundModes = audio;
```

(Find the two `buildSettings = { ... }` blocks for the `Flux` target — they already contain keys like `INFOPLIST_KEY_UILaunchScreen_Generation` or `PRODUCT_BUNDLE_IDENTIFIER`. Add the line alongside those.)

If `INFOPLIST_KEY_UIBackgroundModes` does not take effect (array-valued plist key), instead add a real `Info.plist` with `UIBackgroundModes = [audio]` and set `INFOPLIST_FILE` + `GENERATE_INFOPLIST_FILE = NO`. Verify in the built app's `Info.plist` (the build agent can `plutil -p` the built `.app/Info.plist`).

- [ ] **Step 5: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED. Ask the agent to `plutil -p` the built app's `Info.plist` and confirm `UIBackgroundModes` contains `audio`.

- [ ] **Step 6: Screenshot verification**

Dispatch apple-platform-builder: open a podcast, tap play, `simctl` screenshot the player bar (and, if feasible, the lock screen / Control Center Now Playing). Save to `/tmp/flux-p2-player.png`. Confirm playback starts and the scrubber advances.

- [ ] **Step 7: Commit**

```bash
git add ios/Flux/Player/AudioPlayer.swift ios/Flux/Player/AudioPlayerBar.swift ios/Flux/RootView.swift ios/Flux/FluxApp.swift ios/Flux.xcodeproj/project.pbxproj
git commit -m "feat(ios): native AVPlayer podcast playback — background audio + lock-screen controls"
```

---

### Task 9: YouTube embed — `YouTubeEmbedView`

**Files:**
- Modify (replace stub): `ios/Flux/Player/YouTubeEmbedView.swift`

- [ ] **Step 1: Implement the embed**

`ios/Flux/Player/YouTubeEmbedView.swift`:

```swift
import SwiftUI
import WebKit

struct YouTubeEmbedView: UIViewRepresentable {
    let videoId: String

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.isScrollEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.loadedVideoId != videoId else { return }
        context.coordinator.loadedVideoId = videoId
        let embed = "https://www.youtube.com/embed/\(videoId)?playsinline=1&modestbranding=1"
        let html = """
        <!DOCTYPE html><html><head><meta name="viewport" content="initial-scale=1.0"/>
        <style>html,body{margin:0;padding:0;background:transparent;height:100%}iframe{width:100%;height:100%;border:0}</style>
        </head><body>
        <iframe src="\(embed)" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe>
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: URL(string: "https://www.youtube.com"))
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var loadedVideoId: String?
    }
}
```

- [ ] **Step 2: Build**

Dispatch apple-platform-builder: build `Flux`. Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Screenshot verification**

Dispatch apple-platform-builder: open a YouTube item, `simctl` screenshot the embed to `/tmp/flux-p2-youtube.png`. Confirm the player loads.

- [ ] **Step 4: Commit**

```bash
git add ios/Flux/Player/YouTubeEmbedView.swift
git commit -m "feat(ios): YouTube embed via WKWebView"
```

---

### Task 10: Final integration pass + full screenshot sweep

**Files:** none (verification + any small fixes surfaced)

- [ ] **Step 1: Full build**

Dispatch apple-platform-builder: clean build `Flux`. Expected: BUILD SUCCEEDED, no warnings introduced.

- [ ] **Step 2: End-to-end screenshot sweep**

Dispatch apple-platform-builder against the live API: capture (a) an article with a created highlight, (b) a podcast playing with the player bar, (c) a YouTube embed, (d) the insights/transcript/entities sections, (e) the Highlights section with a delete. Save under `/tmp/flux-p2-final-*.png`. Report any visual issues.

- [ ] **Step 3: Verify offline read-later**

Dispatch apple-platform-builder: open an article (caches it), then disable the simulator network (or point at an unreachable URL) and reopen — confirm the cached body still renders. Report result.

- [ ] **Step 4: Final commit (if fixes were needed)**

```bash
git add -A ios/
git commit -m "fix(ios): P2 integration polish"
```

---

## Self-Review

**Spec coverage:** detail cache (Task 1) + DetailLoader (Task 2) ✓; per-type detail (Task 3) ✓; article reader + native-selection highlight (Tasks 4, 6) ✓; AVPlayer background + lock-screen (Task 8) ✓; YouTube embed (Task 9) ✓; insights/transcript/entities/highlights sections with takeaway/quote create (Task 7) ✓; outbox create/delete + reconcile (Task 5) ✓; manual read state (unchanged — no auto-read added) ✓; offline read-later (Task 10 step 3 verifies) ✓.

**Type consistency:** `HighlightStore.create/delete` signatures match call sites in Tasks 6/7; the `Highlight` memberwise init (Task 5 step 3) matches `HighlightStore`'s use; `CreateHighlightPayload`/`DeleteHighlightPayload` defined in Task 5 and consumed in the same task's flush; `AudioPlayer` API (`seek`, `skip`, `togglePlayPause`, `setRate`, `currentItemId`, `isPlaying`, `currentTime`, `duration`, `rate`) consistent across Tasks 7/8; `HighlightLocator(index:)`/`(sec:index:)` rely on Task 0's public init.

**Known verification-time checks (flagged inline, not placeholders):** confirm `Chapter.startSec` / `Quote.approxTimestampSec` / `TranscriptSegment.start` Swift member names against `FluxModels.swift` before Task 7 build; confirm `INFOPLIST_KEY_UIBackgroundModes` vs. a real `Info.plist` for the background-audio entitlement in Task 8 (fallback documented).

**Risk:** the system HTML→`NSAttributedString` importer (Task 4) may jank on very large articles — start native, escalate to a structured parser only if a real article janks (per spec).
