import SwiftUI
import SwiftData

struct RootView: View {
    @Environment(\.modelContext) private var context
    @Environment(AppConfig.self) private var config
    @Environment(\.scenePhase) private var scenePhase
    @State private var sync: SyncEngine?
    @State private var detail: DetailLoader?
    @State private var audio = AudioPlayer()

    var body: some View {
        TabView {
            Tab("Library", systemImage: "books.vertical") {
                LibraryView()
            }
            Tab("Highlights", systemImage: "highlighter") {
                Text("Highlights — coming soon")
                    .foregroundStyle(.secondary)
            }
            Tab("Ask", systemImage: "sparkles") {
                Text("Ask — coming soon")
                    .foregroundStyle(.secondary)
            }
            Tab("Settings", systemImage: "gear") {
                NavigationStack { SettingsView() }
            }
        }
        .environment(sync)
        .environment(detail)
        .environment(audio)
        .task {
            if sync == nil {
                sync = SyncEngine(context: context, config: config)
            }
            if detail == nil {
                detail = DetailLoader(context: context, config: config)
            }
            await sync?.sync()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await sync?.sync() }
            }
        }
    }
}
