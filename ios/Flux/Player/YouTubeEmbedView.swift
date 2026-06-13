import SwiftUI
import WebKit

struct YouTubeEmbedView: UIViewRepresentable {
    let videoId: String

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.isScrollEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.loadedVideoId != videoId else { return }
        context.coordinator.loadedVideoId = videoId
        let embed = "https://www.youtube.com/embed/\(videoId)?playsinline=1&modestbranding=1"
        let html = """
        <!DOCTYPE html><html><head><meta name="viewport" content="initial-scale=1.0"/>
        <style>html,body{margin:0;padding:0;background:transparent;height:100%}iframe{width:100%;height:100%;border:0}</style>
        </head><body>
        <iframe src="\(embed)" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe>
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: URL(string: "https://www.youtube.com"))
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var loadedVideoId: String?
    }
}
