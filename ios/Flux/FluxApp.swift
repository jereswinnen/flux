import SwiftUI
import SwiftData

@main
struct FluxApp: App {
    @State private var config = AppConfig()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(config)
        }
        .modelContainer(for: [Item.self, Highlight.self, PendingChange.self, ItemDetailCache.self])
    }
}
