// FluxClient.swift
// Async/await Swift client for the Flux API.
//
// Requires: Swift 5.9+, iOS 16+ / macOS 13+ (structured concurrency).
// No external dependencies — uses URLSession and Foundation.
//
// All methods are `async throws`. The actor guarantees serial access to shared
// state; you can safely call methods from any Task or concurrent context.

import Foundation

// MARK: - FluxClient

/// Async/await client for the Flux REST API.
///
/// ```swift
/// let client = FluxClient(
///     baseURL: URL(string: "https://your-app.railway.app")!,
///     token: "your-api-auth-token"   // nil when API_AUTH_TOKEN is unset
/// )
/// let items = try await client.items()
/// ```
public actor FluxClient {

    private let baseURL: URL
    private let token: String?
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(baseURL: URL, token: String? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.session = session

        let dec = JSONDecoder()
        // The API emits ISO-8601 with fractional seconds (JS `.toISOString()` →
        // `2026-06-13T20:56:28.714Z`). `.iso8601` can't parse the fractional part,
        // so decode by hand: try with fractional seconds first, then without.
        dec.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            let withFractional = ISO8601DateFormatter()
            withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = withFractional.date(from: raw) { return date }
            let plain = ISO8601DateFormatter()
            plain.formatOptions = [.withInternetDateTime]
            if let date = plain.date(from: raw) { return date }
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Invalid ISO-8601 date: \(raw)")
            )
        }
        self.decoder = dec

        // Match the server's wire format on the way out, too.
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .custom { date, encoder in
            let fmt = ISO8601DateFormatter()
            fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var container = encoder.singleValueContainer()
            try container.encode(fmt.string(from: date))
        }
        self.encoder = enc
    }

    // MARK: - Private Helpers

    private func url(_ path: String, query: [String: String?] = [:]) -> URL {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )!
        let items = query.compactMapValues { $0 }
            .map { URLQueryItem(name: $0.key, value: $0.value) }
        if !items.isEmpty { components.queryItems = items }
        return components.url!
    }

    private func request(
        _ method: String,
        path: String,
        query: [String: String?] = [:],
        body: (some Encodable)? = nil as String?
    ) throws -> URLRequest {
        var req = URLRequest(url: url(path, query: query))
        req.httpMethod = method
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try encoder.encode(body)
        }
        return req
    }

    private func perform<T: Decodable>(_ req: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: req)
        if let http = response as? HTTPURLResponse,
           !(200..<300).contains(http.statusCode) {
            throw FluxError.httpError(statusCode: http.statusCode, body: data)
        }
        return try decoder.decode(T.self, from: data)
    }

    /// Performs a request and discards the body (used for DELETE/void calls).
    private func performVoid(_ req: URLRequest) async throws {
        let (_, response) = try await session.data(for: req)
        if let http = response as? HTTPURLResponse,
           !(200..<300).contains(http.statusCode) {
            throw FluxError.httpError(statusCode: http.statusCode, body: nil)
        }
    }

    // MARK: - Items

    /// List all library items.
    public func items() async throws -> [ItemDTO] {
        let res: Envelope<[ItemDTO]> = try await perform(try request("GET", path: "/api/items"))
        return res.items
    }

    /// Add a YouTube video or article by URL.
    public func addItem(url itemURL: String) async throws -> ItemDTO {
        struct Body: Encodable { let url: String }
        let res: SingleItem = try await perform(
            try request("POST", path: "/api/items", body: Body(url: itemURL))
        )
        return res.item
    }

    /// Add a podcast episode using explicit metadata (iTunes-driven flow).
    public func addPodcastItem(_ input: PodcastItemInput) async throws -> ItemDTO {
        let res: SingleItem = try await perform(
            try request("POST", path: "/api/items", body: input)
        )
        return res.item
    }

    /// Fetch the full item bundle: item + transcript + insights + entities + highlights.
    public func item(id: String) async throws -> ItemDetail {
        try await perform(try request("GET", path: "/api/items/\(id)"))
    }

    /// Update the read state of an item.
    public func setReadState(id: String, _ state: ItemReadState) async throws -> ItemDTO {
        struct Body: Encodable { let readState: ItemReadState }
        let res: SingleItem = try await perform(
            try request("PATCH", path: "/api/items/\(id)", body: Body(readState: state))
        )
        return res.item
    }

    /// Delete an item from the library (and cascade-deletes transcript, insights, highlights).
    public func deleteItem(id: String) async throws {
        try await performVoid(try request("DELETE", path: "/api/items/\(id)"))
    }

    /// Re-trigger the processing pipeline for a failed item.
    /// Jumps to analysis if a transcript already exists; otherwise restarts from transcription.
    public func retry(id: String) async throws {
        let _: StatusResponse = try await perform(
            try request("POST", path: "/api/items/\(id)/retry")
        )
    }

    // MARK: - Sync

    /// Incremental sync. Pass the `syncedAt` from the previous response as `since`;
    /// omit (nil) for a full sync. Always use the DB-clock cursor, not the client clock.
    public func sync(since: Date? = nil) async throws -> SyncResponse {
        var query: [String: String?] = [:]
        if let since {
            let formatter = ISO8601DateFormatter()
            query["since"] = formatter.string(from: since)
        }
        return try await perform(try request("GET", path: "/api/sync", query: query))
    }

    // MARK: - Highlights

    /// List highlights, optionally filtered.
    ///
    /// - Parameters:
    ///   - type: Filter by parent item type ("podcast" | "youtube" | "article").
    ///   - q: ILIKE search on highlight text and note.
    ///   - itemId: Restrict to highlights belonging to a specific item.
    public func highlights(
        type: ItemType? = nil,
        q: String? = nil,
        itemId: String? = nil
    ) async throws -> [HighlightDTO] {
        let query: [String: String?] = [
            "type": type?.rawValue,
            "q": q,
            "itemId": itemId
        ]
        let res: HighlightsEnvelope = try await perform(
            try request("GET", path: "/api/highlights", query: query)
        )
        return res.highlights
    }

    /// Create a highlight.
    ///
    /// **Returns `RawHighlight`** (the raw DB insert result), NOT `HighlightDTO`.
    /// The `item` sub-object and `jumpHref` are absent. The `embedding` field
    /// (1536 floats) is present but can safely be ignored.
    /// Refetch from `highlights(itemId:)` to obtain full `HighlightDTO` objects.
    public func createHighlight(
        itemId: String,
        kind: HighlightKind,
        text: String,
        note: String? = nil,
        locator: HighlightLocator? = nil
    ) async throws -> RawHighlight {
        struct Body: Encodable {
            let itemId: String
            let kind: HighlightKind
            let text: String
            let note: String?
            let locator: HighlightLocator?
        }
        let res: RawHighlightEnvelope = try await perform(try request(
            "POST",
            path: "/api/highlights",
            body: Body(itemId: itemId, kind: kind, text: text, note: note, locator: locator)
        ))
        return res.highlight
    }

    /// Update a highlight's note. Pass an empty string to clear the note.
    public func updateHighlightNote(id: String, note: String) async throws {
        struct Body: Encodable { let note: String }
        let _: StatusResponse = try await perform(
            try request("PATCH", path: "/api/highlights/\(id)", body: Body(note: note))
        )
    }

    /// Delete a highlight (also inserts a tombstone for sync).
    public func deleteHighlight(id: String) async throws {
        let _: StatusResponse = try await perform(
            try request("DELETE", path: "/api/highlights/\(id)")
        )
    }

    // MARK: - Ask

    /// One-shot RAG answer with cited sources.
    /// Returns `answer == nil` when no library sources match or the query is too short.
    public func ask(query: String) async throws -> AskResponse {
        struct Body: Encodable { let query: String }
        return try await perform(
            try request("POST", path: "/api/answer", body: Body(query: query))
        )
    }

    // MARK: - Library Search

    /// Hybrid library search — returns matching items and transcript moments.
    public func search(query: String) async throws -> SearchResponse {
        struct Body: Encodable { let query: String }
        return try await perform(
            try request("POST", path: "/api/library/search", body: Body(query: query))
        )
    }

    // MARK: - Conversations

    /// List conversations. Pass `itemId` to scope to an item, or `scope: "library"`
    /// for library-wide (non-item) conversations. Exactly one must be provided.
    public func conversations(
        itemId: String? = nil,
        scope: String? = nil
    ) async throws -> [ConversationRow] {
        let query: [String: String?] = ["itemId": itemId, "scope": scope]
        let res: ConversationsEnvelope = try await perform(
            try request("GET", path: "/api/conversations", query: query)
        )
        return res.conversations
    }

    /// Create a conversation. Pass `itemId` to scope it to an item; nil for library scope.
    public func createConversation(itemId: String? = nil) async throws -> ConversationRow {
        struct Body: Encodable { let itemId: String? }
        let res: ConversationEnvelope = try await perform(
            try request("POST", path: "/api/conversations", body: Body(itemId: itemId))
        )
        return res.conversation
    }

    /// Fetch a conversation with all its messages in chronological order.
    public func conversation(id: String) async throws -> ConversationDetail {
        try await perform(try request("GET", path: "/api/conversations/\(id)"))
    }

    /// Rename a conversation.
    public func renameConversation(id: String, title: String) async throws {
        struct Body: Encodable { let title: String }
        let _: StatusResponse = try await perform(
            try request("PATCH", path: "/api/conversations/\(id)", body: Body(title: title))
        )
    }

    /// Delete a conversation and all its messages.
    public func deleteConversation(id: String) async throws {
        let _: StatusResponse = try await perform(
            try request("DELETE", path: "/api/conversations/\(id)")
        )
    }
}

// MARK: - Private Response Envelopes

private struct Envelope<T: Decodable>: Decodable {
    let items: T
}

private struct SingleItem: Decodable { let item: ItemDTO }
private struct HighlightsEnvelope: Decodable { let highlights: [HighlightDTO] }
private struct RawHighlightEnvelope: Decodable { let highlight: RawHighlight }
private struct StatusResponse: Decodable { let status: String }
private struct ConversationsEnvelope: Decodable { let conversations: [ConversationRow] }
private struct ConversationEnvelope: Decodable { let conversation: ConversationRow }

// MARK: - Error

public enum FluxError: Error, LocalizedError {
    case httpError(statusCode: Int, body: Data?)

    public var errorDescription: String? {
        switch self {
        case .httpError(let code, let body):
            let bodyString = body.flatMap { String(data: $0, encoding: .utf8) } ?? "(no body)"
            return "Flux API error \(code): \(bodyString)"
        }
    }
}
