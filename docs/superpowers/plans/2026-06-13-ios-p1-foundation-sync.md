# iOS P1 — Foundation & Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. Build verification uses the **apple-platform-builder** agent (`xcodebuild`); visual checks use `simctl` screenshots.

**Goal:** A native SwiftUI app shell with Keychain config, a SwiftData offline store, a `SyncEngine` over `GET /api/sync`, and a working **Library** tab — the full data spine.

**Architecture:** Native SwiftUI + SwiftData + Observation only; no third-party deps beyond the linked `FluxAPI` package. Views bind to `@Query`; two small `@Observable` services (`AppConfig`, `SyncEngine`) via `.environment`. Filtering/sorting in the SwiftData `#Predicate`. (Full principles in the spec.)

**Spec:** `docs/superpowers/specs/2026-06-13-ios-p1-foundation-sync-design.md`

**Project:** `ios/Flux.xcodeproj`, scheme `Flux`, synchronized source folder `ios/Flux/` (new `.swift` files there are auto-included). `FluxAPI` package linked (`import FluxAPI`). Build target: an `iPhone 17 Pro` simulator (iOS 26).

**FluxAPI facts:** `FluxClient(baseURL: URL, token: String? = nil)`; `func sync(since: Date? = nil) async throws -> SyncResponse` (`{ items: [ItemDTO], highlights: [HighlightDTO], deletions: [Deletion], syncedAt: Date }`); `func setReadState(id: String, _ : ItemReadState) async throws -> ItemDTO`; `Deletion { type: String, id: String }`; `ItemDTO`/`HighlightDTO` per `FluxModels.swift` (camelCase fields; `source`, `videoId`, `readState`, `createdAt`, `updatedAt`, dates as `Date`). `ItemType`/`ItemStatus`/`ItemReadState` are `String` enums.

## File structure (all under `ios/Flux/`)
- `Models/Item.swift`, `Models/Highlight.swift`, `Models/Outbox.swift`
- `Config/KeychainStore.swift`, `Config/AppConfig.swift`
- `Sync/SyncEngine.swift`
- `Settings/SettingsView.swift`
- `Library/LibraryView.swift`
- `FluxApp.swift`, `RootView.swift` (and remove the template `ContentView.swift` contents)

---

## Task 1: SwiftData models

**Files:** `Models/Item.swift`, `Models/Highlight.swift`, `Models/Outbox.swift`.

- [ ] **Item.swift**
```swift
import Foundation
import SwiftData
import FluxAPI

@Model
final class Item {
    @Attribute(.unique) var id: String
    var type: String
    var title: String
    var source: String?
    var audioUrl: String?
    var sourceUrl: String?
    var artworkUrl: String?
    var durationSec: Int?
    var publishedAt: Date?
    var createdAt: Date
    var updatedAt: Date
    var status: String
    var videoId: String?
    var readState: String

    init(from dto: ItemDTO) {
        id = dto.id; type = dto.type.rawValue; title = dto.title
        source = dto.source; audioUrl = dto.audioUrl; sourceUrl = dto.sourceUrl
        artworkUrl = dto.artworkUrl; durationSec = dto.durationSec
        publishedAt = dto.publishedAt; createdAt = dto.createdAt; updatedAt = dto.updatedAt
        status = dto.status.rawValue; videoId = dto.videoId; readState = dto.readState.rawValue
    }
    func apply(_ dto: ItemDTO) {
        type = dto.type.rawValue; title = dto.title; source = dto.source
        audioUrl = dto.audioUrl; sourceUrl = dto.sourceUrl; artworkUrl = dto.artworkUrl
        durationSec = dto.durationSec; publishedAt = dto.publishedAt
        createdAt = dto.createdAt; updatedAt = dto.updatedAt
        status = dto.status.rawValue; videoId = dto.videoId; readState = dto.readState.rawValue
    }
}
```
(If `ItemDTO` field names/optionality differ from this, MATCH the real `FluxModels.swift` — read it.)

- [ ] **Highlight.swift** — `@Model final class Highlight` with `@Attribute(.unique) var id`, `itemId`, `kind`, `text`, `note: String?`, `createdAt`, `updatedAt`, and denormalized `itemTitle`, `itemSource: String?`, `itemArtworkUrl: String?` (from `HighlightDTO.item`). `init(from:)` + `apply(_:)`. (Read `HighlightDTO`/its `item` sub-struct for exact field names.)

- [ ] **Outbox.swift**
```swift
import Foundation
import SwiftData

@Model
final class PendingChange {
    @Attribute(.unique) var id: UUID
    var kind: String        // "setReadState" | "createHighlight" | "deleteHighlight" | "updateNote"
    var payloadJSON: String
    var createdAt: Date
    init(kind: String, payloadJSON: String) {
        id = UUID(); self.kind = kind; self.payloadJSON = payloadJSON; createdAt = Date()
    }
}
```

- [ ] **Verify:** apple-platform-builder builds the `Flux` scheme (these compile once the container is set in Task 4; if building standalone now fails only due to no `@main` change yet, that's expected — full build gate is Task 6). Commit: `feat(ios): SwiftData models (Item, Highlight, PendingChange)`.

---

## Task 2: Config + Keychain + Settings

**Files:** `Config/KeychainStore.swift`, `Config/AppConfig.swift`, `Settings/SettingsView.swift`.

- [ ] **KeychainStore.swift** — minimal `Security` wrapper:
```swift
import Foundation
import Security

enum KeychainStore {
    static func get(_ key: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrAccount as String: key,
                                kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func set(_ key: String, _ value: String) {
        let data = Data(value.utf8)
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrAccount as String: key]
        SecItemDelete(base as CFDictionary)
        var add = base; add[kSecValueData as String] = data
        SecItemAdd(add as CFDictionary, nil)
    }
    static func delete(_ key: String) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword,
                       kSecAttrAccount as String: key] as CFDictionary)
    }
}
```

- [ ] **AppConfig.swift**
```swift
import Foundation
import Observation
import FluxAPI

@Observable
final class AppConfig {
    var baseURL: String { didSet { KeychainStore.set("baseURL", baseURL) } }
    var token: String { didSet { KeychainStore.set("token", token) } }

    init() {
        baseURL = KeychainStore.get("baseURL") ?? ""
        token = KeychainStore.get("token") ?? ""
    }
    var isConfigured: Bool { URL(string: baseURL) != nil && !baseURL.isEmpty }
    func makeClient() -> FluxClient? {
        guard let url = URL(string: baseURL), !baseURL.isEmpty else { return nil }
        return FluxClient(baseURL: url, token: token.isEmpty ? nil : token)
    }
}
```

- [ ] **SettingsView.swift** — a `Form`: a `TextField("Server URL", text: $config.baseURL)` (`.keyboardType(.URL)`, `.autocorrectionDisabled`, `.textInputAutocapitalization(.never)`), a `SecureField("API token", text: $config.token)`, and a "Test connection" `Button` that `Task { try await config.makeClient()?.sync() }` and shows a success/failure note via local `@State`. Reads `@Environment(AppConfig.self)`.

- [ ] **Verify + commit** `feat(ios): Keychain-backed AppConfig + Settings`.

---

## Task 3: SyncEngine + outbox flush

**Files:** `Sync/SyncEngine.swift`.

- [ ] **SyncEngine.swift**
```swift
import Foundation
import Observation
import SwiftData
import FluxAPI

@MainActor @Observable
final class SyncEngine {
    private let context: ModelContext
    private let config: AppConfig
    var isSyncing = false
    var lastError: String?

    init(context: ModelContext, config: AppConfig) { self.context = context; self.config = config }

    private var cursor: Date? {
        get { (UserDefaults.standard.object(forKey: "syncCursor") as? Date) }
        set { UserDefaults.standard.set(newValue, forKey: "syncCursor") }
    }

    func sync() async {
        guard let client = config.makeClient(), !isSyncing else { return }
        isSyncing = true; defer { isSyncing = false }
        do {
            try await flushOutbox(client)
            let res = try await client.sync(since: cursor)
            for dto in res.items { upsertItem(dto) }
            for dto in res.highlights { upsertHighlight(dto) }
            for del in res.deletions { applyDeletion(del) }
            try context.save()
            cursor = res.syncedAt
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func upsertItem(_ dto: ItemDTO) {
        let id = dto.id
        let existing = try? context.fetch(FetchDescriptor<Item>(predicate: #Predicate { $0.id == id })).first
        if let item = existing { item.apply(dto) } else { context.insert(Item(from: dto)) }
    }
    // upsertHighlight: same shape with Highlight.
    private func applyDeletion(_ del: Deletion) {
        let id = del.id
        if del.type == "item" {
            try? context.fetch(FetchDescriptor<Item>(predicate: #Predicate { $0.id == id })).forEach(context.delete)
            try? context.fetch(FetchDescriptor<Highlight>(predicate: #Predicate { $0.itemId == id })).forEach(context.delete)
        } else if del.type == "highlight" {
            try? context.fetch(FetchDescriptor<Highlight>(predicate: #Predicate { $0.id == id })).forEach(context.delete)
        }
    }

    func flushOutbox(_ client: FluxClient) async throws {
        let pending = (try? context.fetch(FetchDescriptor<PendingChange>(
            sortBy: [SortDescriptor(\.createdAt)]))) ?? []
        for change in pending {
            switch change.kind {
            case "setReadState":
                if let p = decode(change.payloadJSON, as: ReadStatePayload.self),
                   let state = ItemReadState(rawValue: p.readState) {
                    _ = try await client.setReadState(id: p.id, state)
                }
            // P2 adds createHighlight / deleteHighlight / updateNote cases.
            default: break
            }
            context.delete(change)
        }
        try context.save()
    }
    struct ReadStatePayload: Codable { let id: String; let readState: String }
    private func decode<T: Decodable>(_ json: String, as: T.Type) -> T? {
        guard let d = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(T.self, from: d)
    }
}
```
(`@MainActor` keeps `ModelContext` use on the main actor — simplest correct choice; network `await`s still suspend. Adjust to the real `FluxClient`/DTO names. `upsertHighlight` mirrors `upsertItem`.)

- [ ] **Verify + commit** `feat(ios): SyncEngine (delta sync + outbox flush)`.

---

## Task 4: App shell + TabView + placeholders

**Files:** `FluxApp.swift`, `RootView.swift`; gut `ContentView.swift`.

- [ ] **FluxApp.swift**
```swift
import SwiftUI
import SwiftData

@main
struct FluxApp: App {
    @State private var config = AppConfig()
    var body: some Scene {
        WindowGroup { RootView().environment(config) }
            .modelContainer(for: [Item.self, Highlight.self, PendingChange.self])
    }
}
```
- [ ] **Remove the template** `@main struct MyApp` / `ContentView` / `#Playground` from `ContentView.swift` (delete the file's body; either delete the file or leave it empty-but-valid — synchronized folder. Deleting the file is cleanest: `rm ios/Flux/ContentView.swift`). Ensure only ONE `@main`.
- [ ] **RootView.swift**
```swift
import SwiftUI
import SwiftData

struct RootView: View {
    @Environment(\.modelContext) private var context
    @Environment(AppConfig.self) private var config
    @Environment(\.scenePhase) private var scenePhase
    @State private var sync: SyncEngine?

    var body: some View {
        TabView {
            Tab("Library", systemImage: "books.vertical") { LibraryView() }
            Tab("Highlights", systemImage: "highlighter") { Text("Highlights — coming soon").foregroundStyle(.secondary) }
            Tab("Ask", systemImage: "sparkles") { Text("Ask — coming soon").foregroundStyle(.secondary) }
            Tab("Settings", systemImage: "gear") { NavigationStack { SettingsView() } }
        }
        .environment(sync)
        .task {
            if sync == nil { sync = SyncEngine(context: context, config: config) }
            await sync?.sync()
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await sync?.sync() } } }
    }
}
```
(Use the iOS 18+ `Tab(...)` API; if the toolchain prefers `.tabItem`, the builder will tell us — adjust. `SyncEngine` is injected as an optional `@Environment(SyncEngine?.self)`-readable value; if optional-environment is awkward, make `SyncEngine` non-optional by constructing it in `FluxApp` with the container's `mainContext` and inject it there instead — pick whichever compiles cleanly and keep it simple.)

- [ ] **Verify + commit** `feat(ios): app shell, TabView, modelContainer`.

---

## Task 5: Library tab

**Files:** `Library/LibraryView.swift`.

- [ ] **LibraryView.swift** — native `List` bound to `@Query`, filters in the predicate, swipe actions, pull-to-refresh:
```swift
import SwiftUI
import SwiftData
import FluxAPI

struct LibraryView: View {
    @Environment(AppConfig.self) private var config
    @Environment(SyncEngine?.self) private var sync
    @Environment(\.modelContext) private var context
    @State private var typeFilter: String? = nil          // nil = all
    @State private var unreadOnly = true

    var body: some View {
        NavigationStack {
            Group {
                if !config.isConfigured {
                    ContentUnavailableView("Set up your server", systemImage: "gear",
                        description: Text("Add your URL and token in Settings."))
                } else {
                    LibraryList(typeFilter: typeFilter, unreadOnly: unreadOnly)
                }
            }
            .navigationTitle("Library")
            .toolbar { /* Menu for typeFilter + unread toggle */ }
            .refreshable { await sync??.sync() }
        }
    }
}

private struct LibraryList: View {
    @Environment(\.modelContext) private var context
    @Query private var items: [Item]
    init(typeFilter: String?, unreadOnly: Bool) {
        _items = Query(filter: #Predicate<Item> { item in
            (typeFilter == nil || item.type == typeFilter!) &&
            (!unreadOnly || item.readState == "unread")
        }, sort: \Item.createdAt, order: .reverse)
    }
    var body: some View {
        if items.isEmpty {
            ContentUnavailableView("Nothing here", systemImage: "tray",
                description: Text("Pull to refresh, or add items on the web."))
        } else {
            List(items) { item in
                NavigationLink { Text(item.title) /* P2: real detail */ } label: { ItemRow(item: item) }
                    .swipeActions {
                        Button(item.readState == "read" ? "Unread" : "Read") { setRead(item) }.tint(.blue)
                        Button("Archive") { archive(item) }.tint(.orange)
                    }
            }
            .listStyle(.plain)
        }
    }
    private func setRead(_ item: Item) { changeReadState(item, to: item.readState == "read" ? "unread" : "read") }
    private func archive(_ item: Item) { changeReadState(item, to: "archived") }
    private func changeReadState(_ item: Item, to state: String) {
        item.readState = state
        let payload = "{\"id\":\"\(item.id)\",\"readState\":\"\(state)\"}"
        context.insert(PendingChange(kind: "setReadState", payloadJSON: payload))
        try? context.save()
        // Fire-and-forget online push happens on next sync()/flushOutbox; optionally trigger now.
    }
}

private struct ItemRow: View {
    let item: Item
    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: item.artworkUrl.flatMap(URL.init)) { img in img.resizable().scaledToFill() }
                placeholder: { Color.secondary.opacity(0.15) }
                .frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.body).lineLimit(2)
                if let s = item.source { Text(s).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer()
            if item.status != "ready" {
                Text(item.status).font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.quaternary, in: Capsule())
            }
        }
    }
}
```
(Build the `Menu` toolbar for type/unread filters. Keep the payload JSON construction simple but correct — better to `JSONEncoder` a small `Codable` struct than string-interpolate; use `JSONEncoder` if cleaner. Adjust environment-injection of `SyncEngine` to match whatever Task 4 settled on.)

- [ ] **Verify + commit** `feat(ios): Library tab (list, filters, read/archive swipe, pull-to-refresh)`.

---

## Task 6: Build green + screenshots (verification)

- [ ] **Build:** apple-platform-builder runs `xcodebuild -scheme Flux -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build` → success. Fix any compile errors (relay to the implementer subagent). Iterate to green.
- [ ] **Run + screenshot (manual/visual):** boot the sim, install/launch, and `simctl io … screenshot` the: (a) unconfigured Library empty state, (b) Settings form, (c) — after entering the live Railway URL + token and pulling to refresh — a populated Library, (d) a filter applied, (e) a swipe action. Capture and review the screenshots for layout sanity. (Requires the live API base URL + a token; if unavailable, verify the empty/Settings states only and note that.)
- [ ] **Commit** any fixes. P1 done when the app builds and the Library spine works against the real API.

## Self-Review (plan author)
- **Spec coverage:** shell+TabView (T4); Keychain config+Settings (T2); SwiftData models (T1); SyncEngine delta+outbox+cursor (T3); Library list/filters/swipe/refresh/empty (T5); build+screenshot verify (T6). Placeholder Highlights/Ask tabs + placeholder detail ✅.
- **Native/simple/perf:** SwiftData `@Query` `#Predicate` filtering (T5), native `List`/`AsyncImage`/`Tab`/`ContentUnavailableView`/`Form`, two `@Observable` services, no third-party deps. ✅
- **Type consistency:** model field names map from the real `FluxModels.swift` DTOs (implementer must read them); `FluxClient.sync(since:)`/`setReadState` signatures matched; `Deletion.type`/`.id` used in `applyDeletion`; cursor is `Date` (matches `SyncResponse.syncedAt: Date`).
- **Note:** the `SyncEngine` environment-injection (optional vs constructed-in-App) is flagged for the implementer to land whichever compiles cleanly — both are simple; not a placeholder, a small build-time choice.
