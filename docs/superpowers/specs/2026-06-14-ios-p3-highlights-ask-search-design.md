# iOS App — P3: Highlights, Ask (streaming chat), Search — Design

**Date:** 2026-06-14
**Status:** Approved design, ready for implementation planning

**Context:** Phase 3 of the native iOS app (`ios/Flux.xcodeproj`, synchronized folder `ios/Flux/`, iOS 26, local `FluxAPI` SwiftPM package). P1 delivered the shell + sync + Library; P2 delivered item detail/reader/playback/highlights. P3 fills the two placeholder tabs (**Highlights**, **Ask**) and adds a **Search** tab. Later: P4 (Add-content + polish; item-scoped niceties, mini-player).

**Architecture principles (unchanged):** native SwiftUI + SwiftData + Observation + system frameworks; no third-party packages beyond `FluxAPI`; minimal abstraction; performance (predicate-level filtering; streaming off the main actor). 

## Decisions (from brainstorming)

- **Ask:** full **streaming chat** — multi-turn, live token streaming, "searching the web" status, grouped sources. Conversation **list + threads**, history fetched server-side (online; conversations are NOT in the offline sync). **Item-scoping included:** an "Ask about this" entry from item detail.
- **Search:** a dedicated **5th tab**. Hybrid library search (`/api/library/search`) → item matches + transcript moments; tap → open item (seek for podcasts).
- **Highlights:** flat **reverse-chronological** feed reading the already-synced local `Highlight` store, with a **type filter** + **text/note search**; tap → jump to source item (seek timestamped ones). Offline-capable.

## API surface (verified)

`FluxClient` already exposes everything except chat streaming:
- `ask(query:) -> AskResponse` — (one-shot; not used in P3 since we chose streaming)
- `search(query:) -> SearchResponse` `{ items: [ItemDTO], moments: [SearchMoment] }`
- `highlights(type:q:itemId:) -> [HighlightDTO]` (all-nil = all)
- `conversations(itemId:scope:) -> [ConversationRow]`, `createConversation(itemId:) -> ConversationRow`, `conversation(id:) -> ConversationDetail` `{ conversation, messages: [MessageRow] }`
- `MessageRow { id, conversationId, role, content, sources: [SourceDTO]?, createdAt }`; `ConversationRow { id, itemId?, title, createdAt, updatedAt }`

**Missing → added in P3 (the only new `FluxAPI` work):** a streaming send for `POST /api/chat`. The route returns a Vercel-AI **UI message stream** (SSE, newline-delimited `data:` JSON parts). Request body `{ conversationId, content, itemId? }`. Parts (from the web `use-conversation.ts`): `text-delta` (`.delta`), `tool-input-available` (`toolName=="web_search"`, `.input.query`), `source-url` (`.url`, `.title`, `.sourceId`), `source-document` (`.sourceId`, `.title`), terminator `[DONE]`. **Library `[n]` sources are NOT streamed** — only web sources stream; the canonical assistant message (library + web sources) is persisted server-side in `onFinish`, so the client **refetches `conversation(id:)` after the stream** to get final `MessageRow.sources` (mirrors the web's post-stream poll).

## Components (P3)

### 1. `FluxClient.streamChat` (new, in `clients/swift/Sources/FluxAPI/`)
- `public enum ChatStreamPart { case textDelta(String); case webSearchStatus(query: String?); case webSource(url: String, title: String?); case done }`
- `public func streamChat(conversationId: String, content: String, itemId: String? = nil) -> AsyncThrowingStream<ChatStreamPart, Error>` — POST `/api/chat` with `URLSession.bytes(for:)`, iterate `.lines`, parse each `data:` line's JSON, map to `ChatStreamPart`, finish on `[DONE]` or stream end. Auth header + base URL handled like the other methods.
- Add to the `FluxClient` actor; build-verify with `swift build`.

### 2. Search tab — `ios/Flux/Search/SearchView.swift`
- Add a 5th `Tab("Search", systemImage: "magnifyingglass")` to `RootView` (order: Library, Search, Highlights, Ask, Settings).
- `SearchView` in its own `NavigationStack`: a query field (`.searchable`), **debounced** (~300 ms) calls to `client.search(query:)` (skip queries < 2 chars). Two sections: **Items** (`ItemDTO` rows → tap opens the local `Item` in `ItemDetailView`) and **Moments** (`SearchMoment` rows: artwork, item title, snippet, timestamp → tap opens the item and seeks). Online; show a spinner while searching, empty/idle states. A small `@Observable SearchModel` (or `@State`) holds query/results/loading.
- Opening a result needs the local `Item`: fetch by id from SwiftData (`#Predicate { $0.id == itemId }`). If absent (rare — e.g., archived/unsynced), show a brief "not in your library" note.

### 3. Highlights tab — `ios/Flux/Highlights/HighlightsView.swift`
- Replace the placeholder. `@Query` over local `Highlight`, `SortDescriptor(\.createdAt, order: .reverse)`, predicate driven by a **type filter** (All / Podcasts / Videos / Articles — filtered via the denormalized item type; see note) and a **search term** over `text`/`note`. A `.searchable` field + a `Menu` filter, same vocabulary as Library.
  - **Note on type filter:** `Highlight` currently denormalizes `itemTitle/itemSource/itemArtworkUrl` but NOT item type. Add `itemType: String` to the `Highlight` model (populate in `init(from:)`/`apply` from `dto.item.type`, and in the `HighlightStore` optimistic init from the source `Item.type`). This keeps filtering in the predicate (no join).
- Row: a yellow rule + highlight `text` (2–3 lines), the source item title + small artwork, and a kind chip. Tap → resolve the local `Item` by `itemId` → `ItemDetailView`; if the highlight is timestamped (`kind == transcript/quote`, parse from `jumpHref` `?t=` or carry a `startSec`), seek the player. (Highlights store no locator locally; use `jumpHref`'s `?t=` to derive the seek seconds.)
- Empty state when there are no highlights yet.

### 4. Ask tab — `ios/Flux/Ask/` (conversation list + streaming thread)
- Replace the placeholder with `AskView` in a `NavigationStack`:
  - **`AskView`** — lists `client.conversations()` (newest-first) with a "New" toolbar button (`createConversation()` → push thread). Pull-to-refresh reloads the list. Online; empty state "Ask anything about your library." Loading/error states.
  - **`ConversationView(conversationId:, itemId:?)`** — loads `client.conversation(id:)` into `@State messages: [ChatMessage]` (a local view struct mirroring `MessageRow`). A composer (`TextField` + send button). On send:
    1. Append an optimistic user `ChatMessage` + an empty assistant `ChatMessage` (with a `status`/streaming flag).
    2. Consume `client.streamChat(conversationId:content:itemId:)`: `textDelta` appends to the assistant content; `webSearchStatus` sets the status line ("Searching the web for '…'"); `webSource` accumulates web sources shown live.
    3. On `done`/stream end, `refetch` `client.conversation(id:)` and replace the assistant message with the persisted `MessageRow` (canonical library + web `sources`).
  - Streaming state lives in a small `@Observable ChatViewModel` owned by `ConversationView` (holds messages, isStreaming, status, current Task; supports `stop()` cancelling the stream — keeps the streamed-so-far content). This is the one place a tiny view-model earns its keep (cancellation + incremental mutation).
- **Rendering an assistant message:** the answer as markdown (`AttributedString(markdown:)`, falling back to plain text). Below it, a **Sources** `DisclosureGroup` grouping `sources` by `itemId` (web sources `kind == .web` shown as title + hostname + open-in-browser; library sources as item title + timestamp chips). Tapping a library source opens the item (seek to `startSec`); tapping a web source opens the URL (`SFSafariViewController`/`openURL`). `[n]` citation markers in the text are left as plain text in P3 (inline tappable chips deferred to P4).

### 5. Item-scoped Ask — entry from item detail
- Add an "Ask about this" button to `ItemDetailView` (toolbar or header). It `createConversation(itemId: item.id)` and pushes `ConversationView(conversationId:, itemId: item.id)`. The chat route scopes context to that item (its transcript + saved highlights).

### 6. Cross-tab navigation to a source/seek
- A shared helper to open an item by id and optionally seek: each tab's `NavigationStack` pushes `ItemDetailView(item:)`. Extend `ItemDetailView` with an optional `initialSeekSec: Double?` that, for podcasts, calls `AudioPlayer.load(item:)` + `seek(to:)` on appear. Search moments, timestamped highlights, and library sources all use this.

## Data flow
- **Highlights:** local `@Query` → render; tap → resolve `Item` → `ItemDetailView(+seek)`. No network.
- **Search:** debounced `client.search` → render items/moments → tap → resolve `Item` → detail(+seek). Online.
- **Ask:** `conversations()` list → `conversation(id:)` thread → `streamChat()` (live text/status/web-sources) → on done `conversation(id:)` refetch for canonical sources. Online.

## Error handling
- Offline / request failure in Search & Ask → inline error + retry; Highlights keeps working (local).
- Stream error / user-stop → keep streamed-so-far content; surface a subtle error; the user can resend.
- Source/seek target missing locally → graceful "not in your library" note; web source open failure → ignore.
- Markdown parse failure → render raw text.

## Testing / verification
- **Build:** `swift build` (FluxAPI) + `xcodebuild` `Flux` scheme green after each task group.
- **UI/screenshot harness (FluxUITests):** extend with tests that screenshot the Highlights feed, a Search result, and an Ask conversation mid/post-stream — against the live API.
- **Manual/visual (simctl):** Highlights filter + jump; Search moment → seek; Ask streaming (text appearing, "searching the web" status, grouped sources, tap-through); item-scoped Ask.

## Scope
**In (P3):** `streamChat` + `ChatStreamPart`; Search tab (items + moments, tap-to-open/seek); Highlights tab (reverse-chron, type filter, text search, jump+seek; `Highlight.itemType` added); Ask tab (conversation list, streaming thread with live status + web sources, post-stream canonical refetch, markdown + grouped sources, source tap-through); item-scoped "Ask about this"; `ItemDetailView` optional initial seek.
**Out (later):** inline tappable `[n]` citation chips; @mention composer picker; conversation rename/delete; global mini-player; offline caching of conversations; message edit/regenerate; entity detail navigation.
