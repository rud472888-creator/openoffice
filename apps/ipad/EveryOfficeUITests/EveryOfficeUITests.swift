import XCTest

final class EveryOfficeUITests: XCTestCase {
    @MainActor
    func testCreateEditAndRestoreLocalNote() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "--uitesting-reset-library"]
        app.launch()
        let newNote = app.buttons["newNote"]
        let noteVisible = reveal(newNote, in: app)
        attachScreenshot(app, name: "Home before creating a note")
        XCTAssertTrue(noteVisible, failureContext("The home workspace must show New note at launch.", app: app))
        newNote.tap()
        let editor = app.textViews["documentTextEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 10), failureContext("Creating a note must open its editor.", app: app))
        editor.tap()
        editor.typeText("A note saved on my iPad.")
        XCTAssertEqual(editor.value as? String, "A note saved on my iPad.")
        app.terminate()

        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let document = app.buttons["document-Untitled.txt"]
        XCTAssertTrue(reveal(document, in: app), failureContext("The saved note must be visible after relaunch.", app: app))
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
        let documentVisible = reveal(newDocument, in: app)
        attachScreenshot(app, name: "Home before creating a DOCX")
        XCTAssertTrue(documentVisible, failureContext("The home workspace must show New document at launch.", app: app))
        newDocument.tap()
        let paragraph = app.webViews.textViews.firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 30), failureContext("The bundled DOCX page must load through WKWebView.", app: app))
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
        XCTAssertTrue(reveal(document, in: app), failureContext("The saved DOCX must be visible after relaunch.", app: app))
        document.tap()
        XCTAssertTrue(paragraph.waitForExistence(timeout: 30))
        XCTAssertTrue((paragraph.value as? String)?.contains("An office document saved on iPad.") == true)
    }

    @MainActor
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        let library = app.scrollViews["documentLibrary"]
        _ = element.waitForExistence(timeout: 20)
        // A narrow iPad window can place creation cards or recents below the fold.
        // Scroll only the visible workspace; do not navigate around a hidden home.
        for _ in 0..<5 {
            if element.exists && element.isHittable { return true }
            guard library.exists && library.isHittable else { return false }
            library.swipeUp()
        }
        return element.exists && element.isHittable
    }

    @MainActor
    private func attachScreenshot(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func failureContext(_ message: String, app: XCUIApplication) -> String {
        message + "\nAccessibility tree (first 6000 characters):\n" + String(app.debugDescription.prefix(6000))
    }
}
