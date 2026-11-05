import XCTest
import Vision

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
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30))
        let editor = app.webViews.textViews.firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 10), failureContext("Creating a note must open its editor.", app: app))
        editor.tap()
        editor.typeText("A note saved on my iPad.")
        XCTAssertEqual(editor.value as? String, "A note saved on my iPad.")
        XCTAssertTrue(app.staticTexts["Saved on this iPad"].waitForExistence(timeout: 30),
            failureContext("The note must finish saving through the native bridge before relaunch.", app: app))
        app.terminate()

        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let document = app.buttons["document-Untitled.txt"]
        XCTAssertTrue(reveal(document, in: app), failureContext("The saved note must be visible after relaunch.", app: app))
        document.tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30))
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
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30), failureContext("DOCX must finish opening before editing.", app: app))
        let paragraph = app.webViews.textViews.matching(identifier: "Untitled.docx").firstMatch
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

    @MainActor
    func testRenameDuplicateAndSwitchDocumentTabs() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "--uitesting-reset-library"]
        app.launch()
        let newNote = app.buttons["newNote"]
        XCTAssertTrue(reveal(newNote, in: app), failureContext("New note must be available.", app: app))
        newNote.tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30))
        let editor = app.webViews.textViews.firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        editor.tap()
        editor.typeText("Keep this original note.")
        XCTAssertTrue(app.staticTexts["Saved on this iPad"].waitForExistence(timeout: 30),
            failureContext("The note must finish saving before its file actions become available.", app: app))
        app.buttons["documentActions"].tap()
        app.buttons["Rename"].tap()
        let name = app.textFields["documentName"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.tap()
        let oldName = name.value as? String ?? "Untitled"
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: oldName.count))
        name.typeText("Project notes")
        app.buttons["saveDocumentName"].tap()
        XCTAssertTrue(app.navigationBars["Project notes.txt"].waitForExistence(timeout: 10))
        app.buttons["documentActions"].tap()
        app.buttons["Duplicate"].tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30))
        let duplicateTab = app.buttons["tab-Project notes Copy.txt"]
        XCTAssertTrue(duplicateTab.waitForExistence(timeout: 10))
        XCTAssertEqual(editor.value as? String, "Keep this original note.")
        let originalTab = app.buttons["tab-Project notes.txt"]
        if !originalTab.isHittable { app.scrollViews["documentTabs"].swipeRight() }
        originalTab.tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30))
        XCTAssertEqual(editor.value as? String, "Keep this original note.")
        attachScreenshot(app, name: "Renamed document and duplicate in tabs")
    }

    @MainActor
    func testCreateEditAndRestoreHWPThroughLocalStudio() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "--uitesting-reset-library"]
        app.launch()
        let newHwp = app.buttons["newHwp"]
        XCTAssertTrue(reveal(newHwp, in: app), failureContext("The bundled HWP template must be available.", app: app))
        newHwp.tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 60), failureContext("The HWP engine must finish loading the document.", app: app))
        let input = app.webViews.descendants(matching: .any).matching(identifier: "문서 편집 입력").firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 60), failureContext("The local HTTP HWP studio and WASM input must load.", app: app))
        let webView = app.webViews.firstMatch
        attachScreenshot(app, name: "HWP studio before canvas input")
        // The studio uses an IME sink. A user taps the visible page to focus it.
        webView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).tap()
        app.typeText("Evergreen note survives reopening")
        XCTAssertTrue(app.staticTexts["Saved on this iPad"].waitForExistence(timeout: 30), failureContext("HWP changes must save through the native bridge.", app: app))
        attachScreenshot(app, name: "HWP canvas after input")
        app.terminate()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let document = app.buttons["document-Untitled.hwp"]
        XCTAssertTrue(reveal(document, in: app), failureContext("The saved HWP must remain in the library.", app: app))
        document.tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 60), failureContext("The HWP engine must finish reopening the saved document.", app: app))
        XCTAssertTrue(input.waitForExistence(timeout: 60), failureContext("The saved HWP must reopen in the studio.", app: app))
        let rendered = try recognizedText(in: webView)
        attachScreenshot(app, name: "HWP reopened canvas")
        XCTAssertTrue(rendered.localizedCaseInsensitiveContains("Evergreen") && rendered.localizedCaseInsensitiveContains("reopening"),
            "The reopened HWP canvas must contain the saved text. Recognized text: \(rendered.prefix(1500))")
    }

    @MainActor
    private func recognizedText(in element: XCUIElement) throws -> String {
        guard let image = element.screenshot().image.cgImage else { return "" }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
    }
}
