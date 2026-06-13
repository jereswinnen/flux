import SwiftUI
import FluxAPI

struct SettingsView: View {
    @Environment(AppConfig.self) private var config
    @State private var connectionStatus = ConnectionStatus.idle

    var body: some View {
        @Bindable var config = config
        Form {
            Section("Server") {
                TextField("Server URL", text: $config.baseURL)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                SecureField("API token", text: $config.token)
            }
            Section {
                Button("Test connection") {
                    Task { await testConnection() }
                }
                .disabled(connectionStatus == .testing)

                if connectionStatus == .testing {
                    Text("Testing…")
                        .foregroundStyle(.secondary)
                } else if connectionStatus == .success {
                    Label("Connected", systemImage: "checkmark.circle")
                        .foregroundStyle(.green)
                } else if case .failure(let msg) = connectionStatus {
                    Label(msg, systemImage: "xmark.circle")
                        .foregroundStyle(.red)
                        .font(.callout)
                }
            }
        }
        .navigationTitle("Settings")
        .onChange(of: config.baseURL) { _, _ in connectionStatus = .idle }
        .onChange(of: config.token) { _, _ in connectionStatus = .idle }
    }

    private func testConnection() async {
        connectionStatus = .testing
        do {
            _ = try await config.makeClient()?.sync()
            connectionStatus = .success
        } catch {
            connectionStatus = .failure(error.localizedDescription)
        }
    }
}

// MARK: - ConnectionStatus

private enum ConnectionStatus: Equatable {
    case idle
    case testing
    case success
    case failure(String)
}
