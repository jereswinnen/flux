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

    var isConfigured: Bool {
        !baseURL.isEmpty && URL(string: baseURL) != nil
    }

    func makeClient() -> FluxClient? {
        guard let url = URL(string: baseURL), !baseURL.isEmpty else { return nil }
        return FluxClient(baseURL: url, token: token.isEmpty ? nil : token)
    }
}
