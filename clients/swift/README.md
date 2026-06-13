# Flux Swift Client

A zero-dependency Swift package for the Flux API, built on `URLSession` and Swift structured concurrency.

| File | Contents |
|------|----------|
| `Sources/FluxAPI/FluxModels.swift` | All `Codable` structs/enums mirroring the API DTOs |
| `Sources/FluxAPI/FluxClient.swift` | `actor FluxClient` — typed async/await methods for every endpoint |

**Requirements**: Swift 5.9+, iOS 16+ / macOS 13+ (structured concurrency + `URLSession` async).

---

## Adding to your project

### As a local SwiftPM dependency (recommended)

In Xcode: **File → Add Package Dependencies → Add Local…** and point it at the `clients/swift/` directory. Then add **FluxAPI** to your target's frameworks.

Or in your own `Package.swift`:

```swift
dependencies: [
    .package(path: "../flux/clients/swift"),
],
targets: [
    .target(name: "MyApp", dependencies: ["FluxAPI"]),
]
```

### Copy-paste (no package manager)

Drop the two files in `Sources/FluxAPI/` directly into your Xcode app target. No `import FluxAPI` needed — everything is in the same module.

---

## Server setup

1. Deploy Flux to Railway and note your public app URL.
2. Set `API_AUTH_TOKEN` on Railway to a secret string of your choice.
3. Set `APP_URL` to the same public URL (required for same-origin bypass logic).

The middleware enforces `Authorization: Bearer <token>` on all `/api/*` routes
(except the Modal webhook at `/api/modal/callback`) when `API_AUTH_TOKEN` is set.

---

## Initialising the client

```swift
import FluxAPI   // omit when copy-pasting files directly into your target

let client = FluxClient(
    baseURL: URL(string: "https://your-flux-app.railway.app")!,
    token: "your-api-auth-token"   // nil or omit when API_AUTH_TOKEN is unset server-side
)
```

The client is an `actor` — safe to use from any `Task` or async context.
All methods are `async throws`; errors are `FluxError.httpError(statusCode:body:)` or
network-level `URLError`.

---

## Example workflows

### List the library

```swift
let items: [ItemDTO] = try await client.items()
for item in items {
    print(item.title, item.status, item.readState)
    // item.source = show/channel/author (JSON key is "source", not "podcastName")
    // item.videoId = non-nil only for youtube items
}
```

### Load item detail and mark as read

```swift
let detail: ItemDetail = try await client.item(id: itemId)
// detail.item        — ItemDTO
// detail.transcript  — TranscriptDTO? (nil until transcribed)
// detail.insights    — InsightsDTO?   (nil until analyzed)
// detail.entities    — [MentionedEntity] (enriched, from the entities table)
// detail.highlights  — [HighlightDTO]

let updated: ItemDTO = try await client.setReadState(id: itemId, .read)
```

### Add a YouTube video or article

```swift
let item = try await client.addItem(url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
// item.status is "processing" — poll or use sync() to watch it transition to "ready"
```

### Add a podcast episode (iTunes-driven flow)

```swift
let input = PodcastItemInput(
    title: "Episode 42: Deep Sleep",
    audioUrl: "https://cdn.example.com/ep42.mp3",
    podcastName: "Sleep Science Podcast",
    artworkUrl: "https://cdn.example.com/artwork.jpg",
    durationSec: 3_612,
    itunesTrackId: 1_234_567_890
)
let item = try await client.addPodcastItem(input)
```

### Ask a question (one-shot RAG)

```swift
let response: AskResponse = try await client.ask(query: "What did they say about sleep quality?")
if let answer = response.answer {
    // answer cites library sources as [1], [2], … matching response.sources array order
    print(answer)
    for source in response.sources {
        print(source.itemTitle, source.startSec, source.kind) // .item / .highlight / .web
    }
}
// response.entities — matched entity cards (name, slug, type, mentionCount)
```

### Global library search

```swift
let results: SearchResponse = try await client.search(query: "climate tipping points")
// results.items   — up to 6 matching ItemDTOs
// results.moments — up to 6 transcript chunks with startSec for deep-linking
for moment in results.moments {
    print(moment.itemTitle, "at \(moment.startSec)s:", moment.content.prefix(80))
}
```

### Incremental sync loop (offline-first)

Store `syncedAt` in `UserDefaults` or your local DB as the sync cursor.
Always use the server's `syncedAt`, not the client clock, to avoid skew.

```swift
func performSync() async throws {
    let key = "flux.syncedAt"
    let cursor = UserDefaults.standard.object(forKey: key) as? Date

    let sync = try await client.sync(since: cursor)

    for item in sync.items {
        localDB.upsert(item)                   // create or update by item.id
    }
    for highlight in sync.highlights {
        localDB.upsert(highlight)              // create or update by highlight.id
    }
    for deletion in sync.deletions {
        localDB.delete(type: deletion.type, id: deletion.id)  // "item" or "highlight"
    }

    // Advance cursor — use syncedAt, NOT Date()
    UserDefaults.standard.set(sync.syncedAt, forKey: key)
}
```

On first launch, omit `since` (passes nil → epoch) for a full sync.
Subsequent calls pass the stored `syncedAt`.

### Highlights

```swift
// List all highlights
let all: [HighlightDTO] = try await client.highlights()

// Filter by item type or item ID
let podcastHighlights = try await client.highlights(type: .podcast)
let itemHighlights    = try await client.highlights(itemId: someItemId)

// Search highlight text/notes
let found = try await client.highlights(q: "dopamine")

// Create (returns RawHighlight, NOT HighlightDTO)
let raw: RawHighlight = try await client.createHighlight(
    itemId: itemId,
    kind: .transcript,
    text: "The brain consolidates memories during slow-wave sleep.",
    locator: HighlightLocator(sec: 312, segmentStart: nil, index: nil,
                              charStart: nil, charEnd: nil, location: nil)
)
// raw.id, raw.itemId, raw.kind, raw.text — no `.item` or `.jumpHref`
// Refetch for the full DTO with item snapshot and jumpHref:
let dtos = try await client.highlights(itemId: itemId)

// Update note
try await client.updateHighlightNote(id: raw.id, note: "Remember to check this study.")

// Delete (inserts a tombstone for sync consumers)
try await client.deleteHighlight(id: raw.id)
```

### Conversations

```swift
// Library-wide conversations
let libConvos = try await client.conversations(scope: "library")

// Item-scoped conversations
let itemConvos = try await client.conversations(itemId: itemId)

// Create
let convo = try await client.createConversation(itemId: itemId)

// Load with messages
let detail: ConversationDetail = try await client.conversation(id: convo.id)
for msg in detail.messages {
    print(msg.role, msg.content)
    // msg.sources is [SourceDTO]? for assistant messages
}

// Rename / delete
try await client.renameConversation(id: convo.id, title: "Sleep discussion")
try await client.deleteConversation(id: convo.id)
```

### Retry a failed item

```swift
try await client.retry(id: itemId)
// Item status resets to "processing" or "analyzing"; poll via sync() to track progress.
```

---

## Field-name notes

| Swift property | JSON key | Note |
|----------------|----------|------|
| `ItemDTO.source` | `"source"` | Show/channel/author. JSON key IS `source` (not `podcastName`) |
| `ItemDTO.videoId` | `"videoId"` | Non-nil only for `youtube` items |
| `HighlightDTO.jumpHref` | `"jumpHref"` | Relative URL; prepend `APP_URL` for a full link |
| `SourceDTO.source` | `"source"` | Alias for `podcastName`; both fields are present in the JSON |
| `SourceDTO.kind` | `"kind"` | Computed discriminator: `item` / `highlight` / `web` |
| `SyncResponse.syncedAt` | `"syncedAt"` | Use as `since` cursor — DB clock, not client clock |
| `Deletion.id` | `"id"` | Maps to `entityId` column in the `deletions` table |

---

## What is NOT wrapped (v1)

**Streaming chat (`/api/chat`)** — the streaming endpoint uses Server-Sent Events and
is intentionally omitted from this v1 client. For one-shot question answering use
`ask(query:)` instead. Full SSE support will be added in a future version.

---

## Error handling

```swift
do {
    let items = try await client.items()
} catch FluxError.httpError(let code, let body) {
    switch code {
    case 401: print("Check your API token")
    case 404: print("Not found")
    default:  print("HTTP \(code):", body.flatMap { String(data: $0, encoding: .utf8) } ?? "")
    }
} catch {
    // URLError, DecodingError, etc.
    print("Error:", error)
}
```
