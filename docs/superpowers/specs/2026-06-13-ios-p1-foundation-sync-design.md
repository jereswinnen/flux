# iOS App — P1: Foundation & Sync — Design

**Date:** 2026-06-13
**Status:** Approved design, ready for implementation planning

**Context:** Phase 1 of the native iOS app (`ios/` in the flux repo; Xcode project `Flux.xcodeproj`, synchronized source folder `ios/Flux/`, iOS 26 target, local `FluxAPI` SwiftPM package linked). Full-offline architecture: a SwiftData local store hydrated by `GET /api/sync`, with optimistic writes + an offline outbox. P1 delivers the app shell, config, the SwiftData store + sync engine, and the **Library** tab — the whole data spine, end to end. Later phases: P2 item detail/reading/playback/highlights, P3 highlights tab + ask + search, P4 add-content + polish.

**Verified env:** Xcode 26.4, iOS 26 simulators (iPhone 17 Pro booted). The `apple-platform-builder` agent runs `xcodebuild`; `simctl` screenshots verify UI.

## Architecture

SwiftUI app, **SwiftData** as the offline source of truth. The UI binds to SwiftData via `@Query`; the network only feeds the store (reads) and receives writes (optimistic + outbox). `FluxAPI` (the linked package) handles HTTP; config (base URL + bearer token) lives in the Keychain.

### Architecture principles (per the owner's directive: native, clean, simple, fast)
- **Native + system frameworks only.** SwiftUI, SwiftData, Observation (`@Observable`), `AsyncImage`, `NavigationStack`, `TabView`, `List` + `.swipeActions`/`.refreshable`, `Security` (Keychain), `URLSession` (inside `FluxAPI`). **No third-party packages** beyond our own `FluxAPI`. No reinventing what the platform provides.
- **No needless abstraction.** Views bind directly to `@Query`; behavior lives in a *small* number of single-purpose `@Observable` services (`AppConfig`, `SyncEngine`) injected via `.environment`. No MVVM/VIPER boilerplate, no protocol-wrapper-per-type, no generic "manager" layers. A view that just needs data uses `@Query` and reads it.
- **Performance.** Filtering/sorting happens **in the `@Query` `#Predicate`/`SortDescriptor`** (SwiftData does it in SQLite), not by loading everything and filtering arrays in Swift. `List` rows are lightweight and identity-stable; images via `AsyncImage`. Sync work is `async` off the main actor; writes to the `ModelContext` are batched and saved once.
- **Minimal custom code by design.** The only inherently-custom pieces are the tiny `KeychainStore` (Security has no SwiftUI wrapper) and the lean `SyncEngine`/outbox (the API requires delta sync) — each is one small, focused type, not a framework.

## Components (P1)

### 1. App shell — replace the template
- `ios/Flux/FluxApp.swift`: `@main struct FluxApp: App` with a `.modelContainer(for: [Item.self, Highlight.self, PendingChange.self])`. Root is `RootView`.
- Delete the placeholder `MyApp`/`ContentView`/`#Playground` in `ContentView.swift` (replace the file's contents; keep the file or rename — synchronized folder, either is fine).
- `ios/Flux/RootView.swift`: a `TabView` with tabs **Library**, **Highlights**, **Ask**, **Settings**. P1 implements Library + Settings; Highlights/Ask are placeholder `Text("Coming soon")` views (filled in P2/P3).

### 2. Config + Keychain
- `ios/Flux/Config/KeychainStore.swift`: tiny wrapper over `Security` framework — `get(_ key)`, `set(_ key, _ value)`, `delete(_ key)` (String values, `kSecClassGenericPassword`).
- `ios/Flux/Config/AppConfig.swift`: an `@Observable` (Observation) class holding `baseURL: String` and `token: String`, backed by Keychain (load on init, persist on set). Exposes `var isConfigured: Bool { !baseURL.isEmpty }` and `func makeClient() -> FluxClient?` (builds `FluxClient(baseURL:token:)` from `FluxAPI`; nil if unconfigured). Provided via `.environment`.
- `ios/Flux/Settings/SettingsView.swift`: a `Form` with fields for **Server URL** and **API token** (SecureField), a **Save** button (writes to `AppConfig`/Keychain), and a "Test connection" button that calls `client.items()` (or a cheap `sync`) and reports success/failure. Until configured, the Library tab shows a "Set up your server in Settings" empty state.

### 3. SwiftData models (`ios/Flux/Models/`)
Mirror the DTOs as `@Model` classes (SwiftData can't store the Codable DTO directly; map DTO→model on sync):
- `Item.swift` — `@Model final class Item`: `@Attribute(.unique) var id: String`, `type: String`, `title: String`, `source: String?`, `audioUrl: String?`, `sourceUrl: String?`, `artworkUrl: String?`, `durationSec: Int?`, `publishedAt: Date?`, `createdAt: Date`, `updatedAt: Date`, `status: String`, `videoId: String?`, `readState: String`. An `init(from dto: ItemDTO)` + `func apply(_ dto: ItemDTO)` (upsert). (Strings for `type`/`status`/`readState` keep SwiftData simple; the `FluxAPI` enums are used at the UI/edge.)
- `Highlight.swift` — `@Model final class Highlight`: `@Attribute(.unique) var id: String`, `itemId: String`, `kind: String`, `text: String`, `note: String?`, `createdAt: Date`, `updatedAt: Date`, plus denormalized `itemTitle: String`, `itemSource: String?`, `itemArtworkUrl: String?` (from `HighlightDTO.item`) so the highlights list renders without a join. `init(from dto: HighlightDTO)` + `apply`.
- `PendingChange.swift` — `@Model final class PendingChange` (the outbox): `id: UUID`, `kind: String` (`"setReadState" | "createHighlight" | "deleteHighlight" | "updateNote"`), `payloadJSON: String`, `createdAt: Date`. Generic so later phases reuse it.

### 4. Sync engine (`ios/Flux/Sync/SyncEngine.swift`)
- An `@Observable` `SyncEngine` constructed with a `ModelContext` + `AppConfig`. Stores the cursor in `UserDefaults` (`"syncCursor"`, ISO string).
- `func sync() async`: if not configured, no-op. (1) **flush outbox** first (see below); (2) `let res = try await client.sync(since: cursor)`; (3) in the context: upsert each `res.items` (fetch by id → `apply`, else insert), upsert each `res.highlights`; for each `res.deletions`: if `type == "item"` delete the `Item` + its `Highlight`s (by `itemId`), if `"highlight"` delete that `Highlight`; (4) `try context.save()`; (5) set cursor = `res.syncedAt`. Wrap in do/catch; expose `var lastError: String?` and `var isSyncing: Bool` for the UI.
- **Outbox flush:** `func flushOutbox() async` — fetch `PendingChange`s oldest-first; for each, decode `payloadJSON` and call the matching `FluxClient` method (`setReadState`, etc.); on success delete the `PendingChange`; on network failure stop (retry next sync). P1 only produces `setReadState` changes (highlight changes come in P2), but the flusher handles the full switch so P2 plugs in.
- Triggered: on app launch (RootView `.task`), on `scenePhase` → `.active`, and on Library pull-to-refresh.

### 5. Library tab (`ios/Flux/Library/LibraryView.swift`)
- A `@Query` over `Item` with a `#Predicate` driven by the current filters (type + read state) and `SortDescriptor(\.createdAt, order: .reverse)`, so SwiftData filters/sorts in SQLite — not array filtering in Swift. Filter UI: a `Menu`/segmented control for **type** (All / Podcasts / Videos / Articles) and **read state** (Unread / All / Archived); changing it updates the query's predicate (a `@Query` re-initialized from filter state, the standard SwiftData pattern).
- Row (`ItemRow`): artwork thumbnail (AsyncImage with placeholder + failure fallback), title, source, and a small status chip when `status != "ready"`.
- **Swipe actions:** mark read/unread, archive (optimistic — mutate the `Item.readState` locally + enqueue a `PendingChange("setReadState")` and try the API immediately if online; the outbox covers offline).
- **Pull-to-refresh** → `syncEngine.sync()`. Show `isSyncing`/`lastError` subtly (a refresh spinner; an error banner).
- Empty states: not-configured → "Set up your server in Settings"; configured but empty → "Your library is empty — add something on the web or pull to refresh."
- Tapping a row → P1 pushes a minimal placeholder detail (`Text(item.title)` + status) ; P2 replaces it with the real reader.

## Data flow
`launch/foreground/pull → SyncEngine.sync() → flush outbox → client.sync(since:cursor) → upsert/delete in SwiftData → save → cursor advances`. UI renders from `@Query`. A read-state tap mutates SwiftData immediately + enqueues an outbox change pushed to the API.

## Error handling
- Unconfigured / bad token → Settings "Test connection" surfaces it; Library shows the setup empty state; sync no-ops.
- Sync/network failure → `lastError` shown as a dismissible banner; local data stays; retry on next trigger. Outbox flush stops on first failure and resumes later (last-write-wins on the server).
- Decoding mismatch → caught, surfaced as `lastError` (and a signal that the API/`FluxAPI` drifted).

## Testing / verification
- **Build:** `xcodebuild` for the `Flux` scheme on an iPhone 17 simulator (via the apple-platform-builder agent) must succeed after each task group.
- **Unit (XCTest in a test target if present, else skip):** DTO→model mapping (`Item(from:)`/`apply`), the outbox payload encode/decode, the sync apply logic (upsert + tombstone) against an in-memory `ModelContainer`.
- **Manual/visual:** `simctl` screenshots of: the setup empty state, a populated Library after sync (point the app at the live Railway API with a token), filters, a swipe mark-read. (I'll capture and review these.)

## Scope
**In (P1):** app shell + TabView; Keychain config + Settings; SwiftData `Item`/`Highlight`/`PendingChange`; `SyncEngine` (delta pull + apply + outbox flush) + cursor; Library tab (list, filters, read/archive swipe, pull-to-refresh, empty/error states); placeholder Highlights/Ask tabs + placeholder detail.
**Out (later phases):** real item detail/reader, podcast/YouTube playback, highlight display/create, the Highlights feed, Ask, Search, Add-content, detail-bundle caching/prefetch, push notifications.
