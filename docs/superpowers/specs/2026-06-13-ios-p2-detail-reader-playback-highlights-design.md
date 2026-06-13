# iOS App — P2: Item Detail, Reader, Playback & Highlights — Design

**Date:** 2026-06-13
**Status:** Approved design, ready for implementation planning

**Context:** Phase 2 of the native iOS app (`ios/Flux.xcodeproj`, synchronized folder `ios/Flux/`, iOS 26, local `FluxAPI` SwiftPM package). P1 delivered the app shell, Keychain config, SwiftData store (`Item`/`Highlight`/`PendingChange`), the `SyncEngine` (delta pull + outbox flush), and the Library tab. P2 replaces the placeholder detail view with the real thing: a per-type detail screen (article reader / podcast player / YouTube embed), full web parity for insights/transcript/entities/highlights, native media playback, and highlight create/delete. Later phases: P3 Highlights tab + Ask + Search; P4 Add-content + polish.

**Architecture principles (unchanged from P1, per owner's directive):** native SwiftUI + SwiftData + Observation + system frameworks only (AVFoundation, MediaPlayer, WebKit, UIKit interop via `UIViewRepresentable`). No third-party packages beyond our own `FluxAPI`. No needless abstraction — a small number of single-purpose `@Observable` services injected via `.environment`; views bind to `@Query`. Filtering/sorting in the `#Predicate`. Minimal custom code by design.

## Decisions (from brainstorming)

- **Playback:** full native — AVPlayer audio with background playback + lock-screen/Control Center controls; YouTube via embedded `WKWebView`.
- **Highlight creation:** native text selection in the article reader (custom edit-menu "Highlight" action). Takeaways/quotes get a tap affordance. Transcript-segment highlight *creation* deferred (display works).
- **Offline reading:** cache the detail bundle in SwiftData on open (read-later offline); refresh in background when online.
- **Detail richness:** full parity with the web item page — insights, transcript, entities, highlights.
- **Read state:** stays manual (swipe action only); opening an item does NOT auto-mark read.
- **Phase shape:** one unified P2, structured as distinct task groups (reader / playback / highlights / shared sections).

## API surface (verified, no client changes needed)

`GET /api/items/{id}` → `ItemDetail` (already fully modeled in `FluxModels.swift`):
```
ItemDetail { item: ItemDTO, transcript: TranscriptDTO?, insights: InsightsDTO?, entities: [MentionedEntity], highlights: [HighlightDTO] }
TranscriptDTO { fullText, segments: [TranscriptSegment], contentHtml: String? }   // contentHtml = sanitized article body
TranscriptSegment { start, end, text, words? }
InsightsDTO { id, itemId, summary?, takeaways?, topics?, chapters: [Chapter]?, quotes: [Quote]?, entities? }
Chapter { title, startSec }   Quote { text, approxTimestampSec }
MentionedEntity { id, name, slug, type, description?, imageUrl?, metadata?, context?, approxTimestampSec?, mentionCount }
```
- `FluxClient.item(id:) async throws -> ItemDetail` — already exists.
- `FluxClient.createHighlight(itemId:kind:text:note:locator:) async throws -> RawHighlight` — already exists. POST body `{itemId, kind, text, note?, locator?}`; server computes the embedding.
- `FluxClient.deleteHighlight(id:) async throws` — already exists.
- **Highlight anchoring (matches web):** `kind` discriminator + `locator`. `article` → empty locator, anchored by **text-quote match** of `text`. `takeaway` → `{index}`. `quote` → `{index, sec?}`. `transcript` → `{sec}`. `kindle` → `{location}`. The `HighlightLocator` shape is already in `FluxModels.swift`.

## Components (P2)

### 1. Detail cache (SwiftData) — `ios/Flux/Models/ItemDetailCache.swift`
- `@Model final class ItemDetailCache`: `@Attribute(.unique) var itemId: String`, `contentHtml: String?`, `transcriptJSON: String?`, `insightsJSON: String?`, `entitiesJSON: String?`, `fetchedAt: Date`.
- The transcript/insights/entities are stored as JSON-encoded strings (the `FluxAPI` Codable DTOs encoded with `JSONEncoder`) and decoded on read — keeps the SwiftData model flat and avoids mirroring every nested DTO as a `@Model`. A tiny `decoded()` accessor returns the typed DTOs (`TranscriptDTO?`, `InsightsDTO?`, `[MentionedEntity]`).
- Add `ItemDetailCache.self` to the `.modelContainer` in `FluxApp.swift`.

### 2. Detail loader — `ios/Flux/Sync/DetailLoader.swift`
- `@MainActor @Observable final class DetailLoader` constructed with `ModelContext` + `AppConfig` (mirrors `SyncEngine`'s shape; injected via `.environment`).
- `func load(itemId:) async`: (1) if a cache row exists, leave it (the view already shows it); (2) if configured + online, `client.item(id:)`, encode the three blobs + `contentHtml`, upsert the `ItemDetailCache` row, and upsert the returned `highlights` into the `Highlight` store (so freshly-server-side highlights appear); (3) `try context.save()`. Exposes `var loading: Set<String>` (item ids in flight) and `var lastError: String?` for per-item UI.
- No prefetch — purely on-open lazy load. The lightweight delta sync (P1) is unchanged.

### 3. Detail screen — `ios/Flux/Detail/ItemDetailView.swift`
- Entry point pushed from `LibraryView`'s `NavigationLink` (replaces the P1 placeholder). Reads the `Item` (from `@Query`/passed object) + observes `ItemDetailCache` for that id.
- `.task { await detailLoader.load(itemId: item.id) }` — shows cached content immediately, refreshes in background.
- Header: artwork, title, source, status chip (reuse the P1 `ItemRow` styling vocabulary), published date.
- Switches on `item.type`:
  - `"article"` → `ArticleReaderView` (body) — **see §4**.
  - `"podcast"` → `AudioPlayerBar` (top, sticky) + transcript/insights/entities/highlights sections.
  - `"youtube"` → `YouTubeEmbedView` (top) + transcript/insights/entities/highlights sections.
- Shared sections rendered below the type-specific area (collapsible/sectioned `List` or `ScrollView` + `LazyVStack`): **Insights**, **Transcript**, **Entities**, **Highlights** (§5).

### 4. Article reader — `ios/Flux/Detail/ArticleReaderView.swift` + `HTMLTextView.swift`
- `HTMLTextView` (`UIViewRepresentable` over `UITextView`): converts `contentHtml` → `NSAttributedString` via the system HTML importer (`NSAttributedString(data:options:[.documentType:.html,.characterEncoding:utf8])`), then applies our serif body typography (font, line spacing, text color for light/dark) over the whole range. `isEditable = false`, `isSelectable = true`, `isScrollEnabled = false` (height drives the SwiftUI scroll). Conversion is done once and memoized in the coordinator.
- **Performance note (flagged risk):** the system importer is WebKit-backed and main-thread; fine for typical articles, can jank on very large ones. We start native (no custom parser) and only escalate to a small structured HTML→`NSAttributedString` builder if a real article janks.
- **Create highlight (native selection):** a custom edit-menu action via `UIEditMenuInteraction`/`editMenu(for:)` titled **"Highlight"**; on tap, read the selected substring (`textView.text(in: selectedTextRange)`) and call back into SwiftUI → `createHighlight(itemId:, kind:.article, text: selection, locator: nil)` through the outbox (§6).
- **Display existing highlights:** for each local `Highlight` with `itemId == item.id && kind == "article"`, find the first range of its `text` in the attributed string and apply a highlight background attribute (same first-match strategy as the web `markRange`). Tapping a marked range presents a delete confirmation. Re-applied whenever the highlight set changes.

### 5. Shared sections — `ios/Flux/Detail/Sections/`
- `InsightsSection.swift` — summary paragraph; takeaways (bulleted; each with a "Highlight" affordance → `kind:.takeaway, locator:{index}`); topics (chips); chapters (title + `startSec`, tappable to seek the audio player when present); notable quotes (each with a "Highlight" affordance → `kind:.quote, locator:{index, sec: approxTimestampSec}`).
- `TranscriptSection.swift` — segments list (`start` timestamp + text). For podcasts, tapping a segment seeks `AudioPlayer` to `segment.start`. Display only; segment highlight creation deferred.
- `EntitiesSection.swift` — `MentionedEntity` cards (image via `AsyncImage`, name, type, description, mention count). Non-navigating in P2 (no entity detail screen yet).
- `HighlightsSection.swift` — all local `Highlight`s for this item (any kind), newest first, with swipe/tap **delete** (§6).

### 6. Highlight write path (outbox)
- **Create:** insert a local `Highlight` immediately (optimistic; generate a temp UUID), enqueue `PendingChange(kind:"createHighlight", payloadJSON:{itemId, kind, text, note?, locator?})`, and `SyncEngine.flushOutbox()` pushes it. On server success the next delta sync reconciles the real id (the optimistic row is replaced by upsert keyed on server id; the temp row is removed by matching itemId+text+kind, or simply superseded — see plan for the reconcile rule).
- **Delete:** remove the local `Highlight` immediately, enqueue `PendingChange(kind:"deleteHighlight", payloadJSON:{id})`. If the id is a temp/un-synced id, drop the pending create instead of sending a delete.
- Extend `SyncEngine.flushOutbox()`'s switch (built in P1, only `setReadState` exercised) to handle `createHighlight` (calls `client.createHighlight`) and `deleteHighlight` (calls `client.deleteHighlight`).

### 7. Audio player — `ios/Flux/Player/AudioPlayer.swift` + `AudioPlayerBar.swift`
- `@MainActor @Observable final class AudioPlayer` (one instance, injected via `.environment`): wraps `AVPlayer`. API: `load(item:)`, `play()`, `pause()`, `seek(to:)`, `skip(±15)`, `setRate(_)`; published `isPlaying`, `currentTime`, `duration`, `rate`, `currentItemId`.
- **Background audio:** `AVAudioSession.sharedInstance().setCategory(.playback)` + activate on play; add the `audio` `UIBackgroundMode` (Info.plist / `INFOPLIST_KEY_UIBackgroundModes` — pbxproj change, see plan).
- **Lock screen / Control Center:** `MPNowPlayingInfoCenter` (title/source/artwork/duration/elapsed) + `MPRemoteCommandCenter` (play/pause/skip/seek).
- Time updates via `addPeriodicTimeObserver`; the scrubber binds to `currentTime` and seeks on drag-end.
- `AudioPlayerBar` (SwiftUI): artwork + title, play/pause, ±15s, a scrubber with elapsed/remaining, a speed menu (0.8/1.0/1.25/1.5/2.0). Lives at the top of the podcast detail. (A global mini-player across tabs is P4 polish — out of scope here.)

### 8. YouTube embed — `ios/Flux/Player/YouTubeEmbedView.swift`
- `WKWebView` (`UIViewRepresentable`) loading `https://www.youtube.com/embed/{videoId}?playsinline=1&modestbranding=1`. `allowsInlineMediaPlayback = true`. 16:9 aspect.

## Data flow
`tap row → ItemDetailView → detailLoader.load(id) (cache-first, refresh online) → render type-specific view + shared sections from ItemDetailCache.decoded() + local Highlights`. Highlight create/delete mutate SwiftData immediately + enqueue outbox → `SyncEngine` pushes → next delta sync reconciles. Audio plays via the shared `AudioPlayer`; transcript/chapter taps seek it.

## Error handling
- Detail fetch failure with a cached copy → show cached, silent background-refresh failure (optional subtle indicator). No cache + offline/failure → `ContentUnavailableView` ("Couldn't load — pull or retry when online"); the player/reader still works for whatever synced fields exist (title/source/audioUrl from the `Item`).
- HTML conversion failure → fall back to `transcript.fullText` as plain text.
- Highlight create/delete failure → outbox retries on next sync (last-write-wins server-side); optimistic local state stays.
- Playback error (bad/expired audio URL) → inline error in `AudioPlayerBar`.

## Testing / verification
- **Build:** `xcodebuild` `Flux` scheme on an iPhone 17 simulator (apple-platform-builder) green after each task group.
- **Unit (if a test target exists; else skip):** `ItemDetailCache` encode/decode round-trip of the DTO blobs; the outbox payload encode/decode for create/delete; the article highlight first-match range finder; the temp-id reconcile rule.
- **Manual/visual (simctl screenshots against live Railway API):** an article with body + an applied highlight + the "Highlight" menu; a podcast with the player bar (and lock-screen Now Playing); a YouTube embed; insights/transcript/entities sections; creating and deleting a highlight.

## Scope
**In (P2):** detail cache model + `DetailLoader`; `ItemDetailView` per-type; article reader (HTML render + native-selection highlight create + highlight display/delete); AVPlayer audio with background + lock-screen controls; YouTube embed; Insights/Transcript/Entities/Highlights sections (full parity, display); takeaway/quote highlight creation; outbox create/delete wiring.
**Out (later phases):** Highlights tab feed, Ask, Search (P3); Add-content, global mini-player, entity detail navigation, transcript-segment highlight creation, detail prefetch, push (P4+).
