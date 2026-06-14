import SwiftUI

/// The one artwork thumbnail used everywhere (rows, headers, players, search, entities).
/// A hairline border keeps dark album art visible against a dark background, and the
/// placeholder/failure fallback is consistent across the app.
struct Artwork: View {
    let url: String?
    var size: CGFloat = 44
    var cornerRadius: CGFloat = 8

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        AsyncImage(url: url.flatMap(URL.init)) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFill()
            case .failure:
                placeholder.overlay(Image(systemName: "photo").foregroundStyle(.tertiary))
            default:
                placeholder
            }
        }
        .frame(width: size, height: size)
        .clipShape(shape)
        .overlay(shape.strokeBorder(.separator, lineWidth: 0.5))
    }

    private var placeholder: some View { Color.secondary.opacity(0.15) }
}
