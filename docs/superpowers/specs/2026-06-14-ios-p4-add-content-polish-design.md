# iOS App — P4: Add Content, Polish & Simplification — Design

**Date:** 2026-06-14
**Status:** Approved design, ready for implementation planning

**Context:** Final planned phase of the native iOS app (`ios/Flux.xcodeproj`, synced folder `ios/Flux/`, iOS 26, local `FluxAPI` package). P1 shell+sync+Library; P2 detail/reader/playback/highlights; P3 Highlights tab + streaming Ask + Search. P4 adds **content creation** (URL + podcast search), **polish** (global mini-player, inline citation chips, conversation rename/delete, entity detail), and a **simplification sweep** that prunes the FluxAPI surface to exactly what the app uses (owner directive: "clean and modern, no unnecessary things/structs").

**Architecture principles (unchanged):** native SwiftUI + SwiftData + Observation + system frameworks; no third-party packages; **minimal abstraction** — reuse existing DTOs, no new structs/view-models unless a screen genuinely needs them; predicate-level filtering; streaming/network off the main actor.

## Decisions (from brainstorming)
- **Add content:** URL paste (article/YouTube) **and** in-app podcast search (iTunes → episodes → add).
- **Polish:** all four — global mini-player, inline citation chips, conversation rename/delete, entity detail navigation.
- **Simplification:** prune ALL unused FluxAPI methods/DTOs (owner: "prune all unused").

## Verified API surface
- **Podcast add (backend ready):** `GET /api/itunes/search?q=&type=podcast|episode` → `{results}` (`ShowResult`/`EpisodeResult`); `GET /api/itunes/episodes?feedUrl=` → `{showName, artworkUrl, episodes: FeedEpisode[]}`; `POST /api/items` with the podcast input (already wrapped by `FluxClient.addPodcastItem(_:)`/`PodcastItemInput`). URL add via existing `addItem(url:)`.
- **Entity detail (NO endpoint yet — must create):** DB functions exist — `getEntityBySlug(db,slug)`, `itemsMentioningEntity(db,entityId)` → `[{id,title,podcastName,artworkUrl,publishedAt,createdAt,context,approxTimestampSec}]`, `coMentionedEntities(db,entityId,limit)` → `[{id,name,slug,type,imageUrl,sharedItems}]`. `entities` columns: id,name,slug,type,description,summary,imageUrl,wikipediaUrl,externalIds{itunesId,isbn,googleBooksId},metadata{author,publishedYear}.
- **Conversation rename/delete:** `FluxClient.renameConversation(id:title:)`, `deleteConversation(id:)` already exist.
- **Confirmed unused by the app (prune):** `ask(query:)` (+ orphaned `AskResponse`, `EntitySearchResult`), `highlights(...)`, `updateHighlightNote(id:note:)`, `items()`.

## Components

### P4.1 — Add content
**FluxAPI (new):**
- DTOs: `PodcastShow {collectionId, name, artistName, artworkUrl?, feedUrl?}`, `FeedEpisode {title, guid?, audioUrl, audioType?, publishedAt?, durationSec?, description?}`, `EpisodesResponse {showName?, artworkUrl?, episodes:[FeedEpisode]}`.
- Methods: `searchPodcasts(query:) async throws -> [PodcastShow]` (GET `/api/itunes/search?q=&type=podcast`), `episodesForFeed(feedUrl:) async throws -> EpisodesResponse`.
- Reuse `addItem(url:)` and `addPodcastItem(_:)`.

**iOS:**
- `Add/AddContentView.swift` — a sheet presented from a **+** toolbar button in `LibraryView`. A `Picker` toggles two modes:
  - **Link:** a URL `TextField` + Add → `addItem(url:)`; on success dismiss + `sync()`.
  - **Podcast:** a search field → `searchPodcasts` → list of `PodcastShow`; tapping a show pushes `PodcastEpisodesView` (`episodesForFeed` → `FeedEpisode` list); tapping an episode → `addPodcastItem(PodcastItemInput(...))` (map feed episode + show fields), dismiss + `sync()`.
- A small `@Observable AddContentModel` holds mode/query/results/inFlight (network + form state warrants it; keep it lean).

### P4.2 — Polish
- **Global mini-player** — `Player/MiniPlayerBar.swift`: a slim bar shown via `.safeAreaInset(edge:.bottom)` on the `TabView` in `RootView`, visible only when `audio.currentItemId != nil`. Artwork + title + play/pause + progress hairline; tap → `.sheet` with a full `AudioPlayerBar` (reuse). Bound to the shared `AudioPlayer` (no new player logic).
- **Inline citation chips** — in `ConversationView`'s assistant rendering, replace plain markdown `Text` with a renderer that splits the answer on `[n]` tokens and emits tappable chips for any `n` ≤ `sources.count`, each a `NavigationLink(value: ItemRoute(...))` to `sources[n-1]` (+ seek). Non-numeric/out-of-range `[...]` stay literal. Keep markdown for the prose runs (`AttributedString`). A single small helper builds the segments; no new types beyond a private `enum Segment`.
- **Conversation rename/delete** — `AskView` list rows get `.swipeActions`: **Delete** (`deleteConversation` + remove locally) and **Rename** (an `.alert` with a `TextField` → `renameConversation` + update locally).

### P4.3 — Entity detail
**Backend (new route):** `app/api/entities/[slug]/route.ts` (GET) → composes the existing DB functions into:
```
{ entity: {id,name,slug,type,description,summary,imageUrl,wikipediaUrl,externalIds,metadata},
  mentions: [{id,title,podcastName,artworkUrl,context,approxTimestampSec}],
  relatedEntities: [{id,name,slug,type,imageUrl,sharedItems}] }
```
404 when the slug is unknown. (Reuses `getEntityBySlug`/`itemsMentioningEntity`/`coMentionedEntities`; no new DB code.)

**FluxAPI (new):** `EntityDetail {entity:EntityRecord, mentions:[EntityMention], relatedEntities:[RelatedEntity]}`, `EntityRecord {id,name,slug,type,description?,summary?,imageUrl?,wikipediaUrl?,externalIds?,metadata?}` (reuse existing `EntityMetadata`; add `EntityExternalIds {itunesId?,isbn?,googleBooksId?}`), `EntityMention {id,title,podcastName?,artworkUrl?,context?,approxTimestampSec?}`, `RelatedEntity {id,name,slug,type,imageUrl?,sharedItems}`; method `entity(slug:) async throws -> EntityDetail`.

**iOS:** `Entity/EntityDetailView.swift` (online fetch): header (image, name, type, description/summary, external link), **Mentions** (tap → `ItemRoute(itemId:seekSec: approxTimestampSec)`), **Related** (tap → push another `EntityDetailView`). Register a `.navigationDestination(for: EntityRoute.self)` (a `{slug}` value) at each tab root that surfaces entities; wire the existing `EntitiesSection` cards (item detail) to push `EntityRoute`.

### Simplification sweep
- Delete from `FluxClient`: `ask`, `highlights`, `updateHighlightNote`, `items`. Delete from `FluxModels`: `AskResponse`, `EntitySearchResult` (orphaned by removing `ask`). Update `clients/swift/README.md` to match.
- Remove any dead iOS code surfaced; keep additions minimal (reuse `AudioPlayerBar`, `ItemRoute`, `timeString`; avoid parallel DTOs).
- Verify `swift build` + full `xcodebuild` stay green; the OpenAPI spec (HTTP endpoints) is unaffected except adding `GET /api/entities/{slug}`.

## Data flow
- **Add:** sheet → `addItem`/`addPodcastItem` → dismiss → `SyncEngine.sync()` pulls the new item into the Library.
- **Mini-player:** shared `AudioPlayer` state → `MiniPlayerBar` (always reflects current playback across tabs) → expand sheet.
- **Citations/entities:** `ItemRoute`/`EntityRoute` values resolve against SwiftData (`Item`) or the live `entity(slug:)` fetch.

## Error handling
- Add failures (bad URL, network) → inline error in the sheet; no dismiss. Podcast search/episode/entity fetch failures → inline retry; Library/Highlights unaffected (local).
- Entity slug 404 / offline → `ContentUnavailableView`.
- Citation index out of range → render literally.

## Testing / verification
- `swift build` (FluxAPI) + `xcodebuild` (`Flux`) green per group; backend route smoke-tested via `curl` against local/live.
- `FluxUITests`: add screenshot tests for the Add sheet (both modes), the mini-player, an entity detail, and a conversation swipe action.
- Manual/simctl: add a URL + a podcast episode (confirm they appear after sync); mini-player across tabs + expand; tap a citation chip → source; rename + delete a conversation; tap a Mentioned entity → detail → a mention → item.

## Scope
**In (P4):** podcast search + URL add (FluxAPI methods/DTOs + Add sheet); global mini-player; inline citation chips; conversation rename/delete; entity detail (new API route + FluxAPI + iOS screen + wiring); FluxAPI pruning + dead-code cleanup; README/OpenAPI updates.
**Out:** Share Extension; podcast browse/charts; entity search screen; offline caching of conversations/entities; message edit/regenerate; push notifications. (These remain genuinely optional future work.)
