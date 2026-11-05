import XCTest

final class EveryOfficeUITests: XCTestCase {
    @MainActor
    func testCreateEditAndRestoreLocalNote() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "--uitesting-reset-library"]
        app.launch()
        let newNote = app.buttons["newNote"]
        XCTAssertTrue(newNote.waitForExistence(timeout: 20))
        newNote.tap()
        let editor = app.textViews["documentTextEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        editor.tap()
        editor.typeText("A note saved on my iPad.")
        XCTAssertEqual(editor.value as? String, "A note saved on my iPad.")
        app.terminate()

        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let document = app.buttons["document-Untitled.txt"]
        XCTAssertTrue(document.waitForExistence(timeout: 15))
        document.tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        XCTAssertEqual(editor.value as? String, "A note saved on my iPad.")
    }

    @MainActor
    func testCreateEditAndRestoreDOCXThroughBundledEditor() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "--uitesting-reset-library"]
        app.launch()
        let newDocument = app.buttons["newDocument"]
        XCTAssertTrue(newDocument.waitForExistence(timeout: 20))
        newDocument.tap()
        let paragraph = app.webViews.textViews.firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 30), "The bundled DOCX page must load through WKWebView.")
        paragraph.tap()
        paragraph.typeText("An office document saved on iPad.")
        XCTAssertTrue(app.staticTexts["Saved on this iPad"].waitForExistence(timeout: 20))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "DOCX editor on iPad"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.terminate()

        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let document = app.buttons["document-Untitled.docx"]
        XCTAssertTrue(document.waitForExistence(timeout: 15))
        document.tap()
        XCTAssertTrue(paragraph.waitForExistence(timeout: 30))
        XCTAssertTrue((paragraph.value as? String)?.contains("An office document saved on iPad.") == true)
    }
}
