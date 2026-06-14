import XCTest

/// UI smoke tests that double as a screenshot harness for visual verification.
/// Each test drives the app against the live API (injected via the `-fluxServerURL`
/// launch argument that `AppConfig` reads) and saves a PNG to `/tmp` for review.
final class FluxUITests: XCTestCase {
    private var app: XCUIApplication!

    private static let serverURL = "https://flux-production-32de.up.railway.app"

    override func setUpWithError() throws {
        continueAfterFailure = true
        app = XCUIApplication()
        app.launchArguments = ["-fluxServerURL", Self.serverURL]
        app.launch()
        // Give the initial sync a moment to populate the Library.
        Thread.sleep(forTimeInterval: 4.0)
    }

    // MARK: - Helpers

    private func saveScreenshot(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        try? png.write(to: URL(fileURLWithPath: "/tmp/\(name)"))
    }

    private func openLibrary() {
        let tab = app.tabBars.buttons["Library"]
        if tab.waitForExistence(timeout: 5) { tab.tap() }
    }

    /// Tap the first Library row whose label contains `titleFragment`. Returns whether it opened.
    @discardableResult
    private func openItem(containing titleFragment: String, timeout: TimeInterval = 10) -> Bool {
        let predicate = NSPredicate(format: "label CONTAINS %@", titleFragment)
        let element = app.descendants(matching: .any).matching(predicate).firstMatch
        guard element.waitForExistence(timeout: timeout) else { return false }
        element.tap()
        Thread.sleep(forTimeInterval: 3.0)
        return true
    }

    // MARK: - Tests

    func testArticleReader() throws {
        openLibrary()
        XCTAssertTrue(openItem(containing: "AI Broke Interviews"), "Article not found in Library")
        saveScreenshot("flux-article.png")
    }

    func testAudioPlayer() throws {
        openLibrary()
        XCTAssertTrue(openItem(containing: "Jony Ive"), "Podcast not found in Library")
        saveScreenshot("flux-player.png")
    }
}
