import Foundation
import Observation
import FluxAPI

@Observable
final class AppConfig {
    var baseURL: String { didSet { KeychainStore.set("baseURL", baseURL) } }
    var token: String { didSet { KeychainStore.set("token", token) } }

    init() {
        let storedURL = KeychainStore.get("baseURL") ?? ""
        // UI tests inject the server via `-fluxServerURL <url>` so they can run against
        // the live API without tapping through Settings. Never set in normal use.
        let argURL = Self.launchArgument("-fluxServerURL")
        let resolvedURL = argURL ?? storedURL
        baseURL = resolvedURL
        if !resolvedURL.isEmpty && resolvedURL != storedURL {
            KeychainStore.set("baseURL", resolvedURL)
        }
        token = KeychainStore.get("token") ?? ""
    }

    /// Returns the value following `flag` in the process launch arguments, if present.
    private static func launchArgument(_ flag: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let idx = args.firstIndex(of: flag), args.indices.contains(idx + 1) else { return nil }
        return args[idx + 1]
    }

    var isConfigured: Bool {
        !baseURL.isEmpty && URL(string: baseURL) != nil
    }

    func makeClient() -> FluxClient? {
        guard let url = URL(string: baseURL), !baseURL.isEmpty else { return nil }
        return FluxClient(baseURL: url, token: token.isEmpty ? nil : token)
    }
}
