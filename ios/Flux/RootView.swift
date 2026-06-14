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
            Tab("Search", systemImage: "magnifyingglass") {
                SearchView()
            }
            Tab("Highlights", systemImage: "highlighter") {
                HighlightsView()
            }
            Tab("Ask", systemImage: "sparkles") {
                AskView()
            }
            Tab("Settings", systemImage: "gear") {
                NavigationStack { SettingsView() }
            }
        }
        // The mini-player inset must be applied BEFORE the .environment injections so it
        // sits inside their scope — otherwise MiniPlayerBar reads a nil AudioPlayer.
        .safeAreaInset(edge: .bottom) { MiniPlayerBar() }
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
