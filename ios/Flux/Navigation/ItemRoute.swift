import SwiftUI
import SwiftData

/// A navigation value to open an item by id (optionally seeking, for podcasts).
/// Used by Search, Highlights, and Ask sources, where we hold an id, not an `Item`.
struct ItemRoute: Hashable {
    let itemId: String
    let seekSec: Double?
}

/// Identifies an item-scoped conversation to present modally from item detail.
struct ScopedAskRoute: Hashable, Identifiable {
    let conversationId: String
    let itemId: String
    var id: String { conversationId }
}

/// Resolves an `ItemRoute` to the local `Item` and renders its detail, or a
/// "not in your library" note if it isn't synced locally.
struct ItemRouteDestination: View {
    let route: ItemRoute
    @Query private var items: [Item]

    init(route: ItemRoute) {
        self.route = route
        let id = route.itemId
        _items = Query(filter: #Predicate<Item> { $0.id == id })
    }

    var body: some View {
        if let item = items.first {
            ItemDetailView(item: item, initialSeekSec: route.seekSec)
        } else {
            ContentUnavailableView(
                "Not in your library",
                systemImage: "tray",
                description: Text("This item isn't synced to your device.")
            )
        }
    }
}
