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

    func testHighlightsFeed() throws {
        let tab = app.tabBars.buttons["Highlights"]
        XCTAssertTrue(tab.waitForExistence(timeout: 5))
        tab.tap()
        Thread.sleep(forTimeInterval: 2.0)
        saveScreenshot("flux-highlights.png")
    }

    func testSearch() throws {
        let tab = app.tabBars.buttons["Search"]
        XCTAssertTrue(tab.waitForExistence(timeout: 5))
        tab.tap()
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("design")
        // Wait for live results to render (debounce + network), then screenshot.
        let result = app.staticTexts["Brian Lovin - How to level up with AI as a designer"]
        let appeared = result.waitForExistence(timeout: 15)
        saveScreenshot("flux-search.png")
        XCTAssertTrue(appeared, "Search results for 'design' did not appear")
    }

    func testAddPodcastSearch() throws {
        openLibrary()
        let add = app.navigationBars.buttons["plus"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 5), "Add (+) button not found")
        add.tap()
        let podcast = app.segmentedControls.buttons["Podcast"].firstMatch
        XCTAssertTrue(podcast.waitForExistence(timeout: 5), "Podcast segment not found")
        podcast.tap()
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        field.tap()
        field.typeText("founders\n")
        // A known show row should appear once the iTunes search returns.
        XCTAssertTrue(app.staticTexts["Founders"].waitForExistence(timeout: 15), "Podcast search returned no shows")
        saveScreenshot("flux-add-podcast.png")
    }

    /// Read-only: opens the Ask tab and an existing conversation (no new chat / message),
    /// so the harness never writes to the live account.
    func testAskConversation() throws {
        let askTab = app.tabBars.buttons["Ask"]
        XCTAssertTrue(askTab.waitForExistence(timeout: 5))
        askTab.tap()
        Thread.sleep(forTimeInterval: 2.0)   // let the conversation list load
        // Open the first existing conversation if there is one; otherwise just capture the
        // list/empty state. Either way we create nothing.
        let firstRow = app.cells.firstMatch
        if firstRow.waitForExistence(timeout: 5) {
            firstRow.tap()
            Thread.sleep(forTimeInterval: 2.0)
        }
        saveScreenshot("flux-ask.png")
    }
}
