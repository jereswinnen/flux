import SwiftUI
import FluxAPI

struct SettingsView: View {
    @Environment(AppConfig.self) private var config
    @State private var connectionStatus = ConnectionStatus.idle
    @State private var revealToken = false

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(v) (\(b))"
    }

    var body: some View {
        @Bindable var config = config
        Form {
            Section("Server") {
                TextField("Server URL", text: $config.baseURL)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                HStack {
                    Group {
                        if revealToken {
                            TextField("API token", text: $config.token)
                        } else {
                            SecureField("API token", text: $config.token)
                        }
                    }
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    Button { revealToken.toggle() } label: {
                        Image(systemName: revealToken ? "eye.slash" : "eye")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(revealToken ? "Hide token" : "Show token")
                }
            }

            Section {
                Button("Test connection") {
                    Task { await testConnection() }
                }
                .disabled(connectionStatus == .testing)
            } footer: {
                switch connectionStatus {
                case .idle:
                    EmptyView()
                case .testing:
                    Text("Testing…")
                case .success:
                    Label("Connected", systemImage: "checkmark.circle").foregroundStyle(.green)
                case .failure(let msg):
                    Label(msg, systemImage: "xmark.circle").foregroundStyle(.red)
                }
            }

            Section {
                LabeledContent("Version", value: appVersion)
            }
        }
        .navigationTitle("Settings")
        .onChange(of: config.baseURL) { _, _ in connectionStatus = .idle }
        .onChange(of: config.token) { _, _ in connectionStatus = .idle }
    }

    private func testConnection() async {
        connectionStatus = .testing
        guard let client = config.makeClient() else {
            connectionStatus = .failure("No server URL configured.")
            return
        }
        do {
            // Bounded check — ask only for changes since "now" so the payload stays tiny.
            _ = try await client.sync(since: Date())
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
