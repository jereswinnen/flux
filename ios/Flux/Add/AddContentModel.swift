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
