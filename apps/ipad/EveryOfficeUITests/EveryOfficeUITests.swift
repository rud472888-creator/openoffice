import XCTest
import UIKit
import Vision

final class EveryOfficeUITests: XCTestCase {
    private func launchArguments(resetLibrary: Bool, darkAppearance: Bool = false) -> [String] {
        var arguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "--uitesting-library",
                         darkAppearance ? "--uitesting-dark-appearance" : "--uitesting-light-appearance"]
        if resetLibrary { arguments.append("--uitesting-reset-library") }
        return arguments
    }

    @MainActor
    func testWorkspaceUsesFullDetailWidthInLandscapeAndPortrait() throws {
        continueAfterFailure = false
        let originalOrientation = XCUIDevice.shared.orientation
        defer {
            XCUIDevice.shared.orientation = originalOrientation.isValidInterfaceOrientation ? originalOrientation : .landscapeRight
        }
        let app = XCUIApplication()
        app.launchArguments = launchArguments(resetLibrary: true)
        app.launch()

        for orientation in [UIDeviceOrientation.landscapeLeft, .portrait] {
            XCUIDevice.shared.orientation = orientation
            let rotated = NSPredicate { _, _ in
                orientation.isLandscape ? app.frame.width > app.frame.height : app.frame.height > app.frame.width
            }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: rotated, object: nil)], timeout: 10), .completed)
            let library = app.scrollViews["documentLibrary"]
            XCTAssertTrue(library.waitForExistence(timeout: 10), failureContext("Home must occupy the document detail column.", app: app))
            XCTAssertGreaterThan(library.frame.width, app.frame.width * 0.55,
                failureContext("Home must have room for the workspace instead of leaving an empty third column.", app: app))
            XCTAssertGreaterThanOrEqual(library.frame.maxX, app.frame.maxX - 40,
                failureContext("The home workspace must extend to the trailing edge of the window.", app: app))
            let cardHeight = app.buttons["newDocument"].frame.height
            XCTAssertEqual(app.buttons["newHwp"].label, "New HWP")
            for identifier in ["newDocument", "newWorkbook", "newPresentation", "newHwp", "newNote", "newMarkdown"] {
                let control = app.buttons[identifier]
                XCTAssertTrue(control.isHittable, failureContext("The primary format \(identifier) must be available without scrolling.", app: app))
                XCTAssertGreaterThanOrEqual(control.frame.width, 44)
                XCTAssertGreaterThanOrEqual(control.frame.height, 44)
                XCTAssertEqual(control.frame.height, cardHeight, accuracy: 0.5)
            }
            XCTAssertTrue(app.buttons["moreFormats"].isHittable)
            attachScreenshot(app, name: orientation.isLandscape ? "Home landscape light" : "Home portrait light")
        }

        app.terminate()
        app.launchArguments = launchArguments(resetLibrary: false, darkAppearance: true)
        app.launch()
        XCTAssertTrue(app.scrollViews["documentLibrary"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["newDocument"].isHittable)
        attachScreenshot(app, name: "Home portrait dark")
    }

    @MainActor
    func testSearchShowsEmptyResultAndClearsBackToDocuments() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = launchArguments(resetLibrary: true)
        app.launch()
        XCTAssertTrue(reveal(app.buttons["newNote"], in: app), failureContext("New note must be available for the search flow.", app: app))
        app.buttons["newNote"].tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30), failureContext("The new note must finish opening before returning to search.", app: app))
        app.buttons["showLibrary"].tap()
        let document = app.buttons["document-Untitled.txt"]
        XCTAssertTrue(reveal(document, in: app), failureContext("The created note must appear before filtering.", app: app))
        app.buttons["libraryListView"].tap()
        XCTAssertTrue(app.buttons["libraryListView"].isSelected)
        XCTAssertTrue(document.isHittable)
        attachScreenshot(app, name: "Document list layout")
        app.buttons["libraryGridView"].tap()
        XCTAssertTrue(app.buttons["libraryGridView"].isSelected)
        XCTAssertTrue(document.isHittable)
        let search = app.textFields["documentSearch"]
        XCTAssertTrue(search.waitForExistence(timeout: 10), failureContext("The home workspace must expose its search field.", app: app))
        for _ in 0..<5 {
            if search.isHittable { break }
            app.scrollViews["documentLibrary"].swipeDown()
        }
        XCTAssertTrue(search.isHittable, failureContext("Search must be reachable after scrolling to the workspace header.", app: app))
        search.tap()
        let query = "no-document-matches-this-query"
        search.typeText(query + "\n")
        XCTAssertTrue(app.staticTexts["No matching documents"].waitForExistence(timeout: 10), failureContext("An unmatched search must explain the empty result.", app: app))
        XCTAssertFalse(document.exists, failureContext("An unmatched document must leave the results.", app: app))
        attachScreenshot(app, name: "Search with no matching documents")
        app.buttons["Clear search"].tap()
        XCTAssertTrue(reveal(document, in: app), failureContext("Clearing search must restore the local document.", app: app))
    }

    @MainActor
    func testMoreFormatsCreatesHTMLDocument() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = launchArguments(resetLibrary: true)
        app.launch()
        let more = app.buttons["moreFormats"]
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        let html = app.buttons["newHtml"]
        XCTAssertTrue(html.waitForExistence(timeout: 10), failureContext("Additional formats must remain available from the compact menu.", app: app))
        html.tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.navigationBars["Untitled.html"].exists)
        attachScreenshot(app, name: "HTML created from additional formats")
        app.buttons["showLibrary"].tap()
        XCTAssertTrue(reveal(app.buttons["document-Untitled.html"], in: app))
    }

    @MainActor
    func testFavoritePersistsAndCanBeRemovedFromFavorites() throws {
        continueAfterFailure = false
        let originalOrientation = XCUIDevice.shared.orientation
        defer { XCUIDevice.shared.orientation = originalOrientation }
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = launchArguments(resetLibrary: true)
        app.launch()
        XCTAssertTrue(reveal(app.buttons["newNote"], in: app), failureContext("New note must be available for the favorites flow.", app: app))
        app.buttons["newNote"].tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30), failureContext("The new note must finish opening before favoriting.", app: app))
        let favorite = app.buttons["favoriteDocument"]
        XCTAssertTrue(favorite.waitForExistence(timeout: 10), failureContext("The editor must expose its favorite action.", app: app))
        favorite.tap()
        app.terminate()
        app.launchArguments = launchArguments(resetLibrary: false)
        app.launch()
        attachScreenshot(app, name: "Home before opening Favorites after relaunch")
        let favorites = app.descendants(matching: .any).matching(identifier: "librarySection-favorites").firstMatch
        XCTAssertTrue(favorites.waitForExistence(timeout: 10), failureContext("The sidebar must expose the Favorites destination after relaunch.", app: app))
        favorites.tap()
        let document = app.buttons["document-Untitled.txt"]
        XCTAssertTrue(reveal(document, in: app), failureContext("Favorites must retain the saved document after relaunch.", app: app))
        attachScreenshot(app, name: "Favorites after relaunch")
        document.tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30), failureContext("The favorite document must finish reopening.", app: app))
        favorite.tap()
        app.buttons["showLibrary"].tap()
        XCTAssertTrue(app.scrollViews["documentLibrary"].waitForExistence(timeout: 10), failureContext("Returning home must show the Favorites workspace.", app: app))
        XCTAssertFalse(document.exists, failureContext("Removing the favorite must remove it from the Favorites view.", app: app))
        let recent = app.descendants(matching: .any).matching(identifier: "librarySection-recent").firstMatch
        XCTAssertTrue(recent.waitForExistence(timeout: 10), failureContext("The sidebar must expose All documents after leaving the editor.", app: app))
        recent.tap()
        XCTAssertTrue(reveal(document, in: app), failureContext("Removing a favorite must preserve its file in Recent.", app: app))
    }

    @MainActor
    func testCreateEditAndRestoreLocalNote() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = launchArguments(resetLibrary: true)
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
        assertSourceText("A note saved on my iPad.", in: editor, app: app)
        XCTAssertTrue(app.staticTexts["Saved on this iPad"].waitForExistence(timeout: 30),
            failureContext("The note must finish saving through the native bridge before relaunch.", app: app))
        app.terminate()

        app.launchArguments = launchArguments(resetLibrary: false)
        app.launch()
        let document = app.buttons["document-Untitled.txt"]
        XCTAssertTrue(reveal(document, in: app), failureContext("The saved note must be visible after relaunch.", app: app))
        document.tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30))
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        assertSourceText("A note saved on my iPad.", in: editor, app: app)
    }

    @MainActor
    func testCreateEditAndRestoreDOCXThroughBundledEditor() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = launchArguments(resetLibrary: true)
        app.launch()
        let newDocument = app.buttons["newDocument"]
        let documentVisible = reveal(newDocument, in: app)
        attachScreenshot(app, name: "Home before creating a DOCX")
        XCTAssertTrue(documentVisible, failureContext("The home workspace must show New document at launch.", app: app))
        newDocument.tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30), failureContext("DOCX must finish opening before editing.", app: app))
        XCTAssertFalse(app.scrollViews["documentTabs"].exists)
        let paragraph = app.webViews.textViews.matching(identifier: "Untitled.docx").firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 30), failureContext("The bundled DOCX page must load through WKWebView.", app: app))
        paragraph.tap()
        paragraph.typeText("An office document saved on iPad.")
        assertEditorContains("An office document saved on iPad.", in: paragraph, app: app)
        XCTAssertTrue(app.staticTexts["Saved on this iPad"].waitForExistence(timeout: 30),
            failureContext("The edited DOCX must finish saving before relaunch.", app: app))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "DOCX editor on iPad"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.terminate()

        app.launchArguments = launchArguments(resetLibrary: false)
        app.launch()
        let document = app.buttons["document-Untitled.docx"]
        XCTAssertTrue(reveal(document, in: app), failureContext("The saved DOCX must be visible after relaunch.", app: app))
        document.tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30),
            failureContext("The saved DOCX must finish reopening before reading its content.", app: app))
        XCTAssertTrue(paragraph.waitForExistence(timeout: 30),
            failureContext("The reopened DOCX must expose its editable paragraph.", app: app))
        assertEditorContains("An office document saved on iPad.", in: paragraph, app: app)
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
        // Allow the system compositor to finish rotation before capturing the display.
        Thread.sleep(forTimeInterval: 1)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func failureContext(_ message: String, app: XCUIApplication) -> String {
        let tree = app.debugDescription
        let attachment = XCTAttachment(string: tree)
        attachment.name = "Complete accessibility tree at assertion failure"
        attachment.lifetime = .keepAlways
        add(attachment)
        attachScreenshot(app, name: "UI assertion failure")
        return message + "\nApplication frame: \(app.frame); device orientation: \(XCUIDevice.shared.orientation.rawValue)"
            + "\nAccessibility tree (first 12000 characters; complete tree attached):\n" + String(tree.prefix(12000))
    }

    @MainActor
    private func assertEditorContains(_ expected: String, in editor: XCUIElement, app: XCUIApplication,
                                      file: StaticString = #filePath, line: UInt = #line) {
        let matches = NSPredicate { _, _ in (editor.value as? String)?.contains(expected) == true }
        let complete = XCTNSPredicateExpectation(predicate: matches, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [complete], timeout: 15), .completed,
            failureContext("The editor must contain the complete input. Actual value: \(String(describing: editor.value))", app: app),
            file: file, line: line)
    }

    @MainActor
    private func assertSourceText(_ expected: String, in editor: XCUIElement, app: XCUIApplication,
                                  file: StaticString = #filePath, line: UInt = #line) {
        // WebKit's contenteditable AX snapshot can lag input. Reopened new
        // notes can include the desktop writer's final newline and WebKit AX
        // block separators. The real-bundle test checks exact file bytes.
        let matches = NSPredicate { _, _ in
            guard let value = editor.value as? String else { return false }
            var content = value
            while let last = content.unicodeScalars.last, last.value == 10 || last.value == 13 {
                content.unicodeScalars.removeLast()
            }
            return content == expected
        }
        let complete = XCTNSPredicateExpectation(predicate: matches, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [complete], timeout: 15), .completed,
            failureContext("The entire source text must appear. Actual value: \(String(describing: editor.value))", app: app),
            file: file, line: line)
    }

    @MainActor
    func testRenameDuplicateAndSwitchDocumentTabs() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = launchArguments(resetLibrary: true)
        app.launch()
        XCUIDevice.shared.orientation = .landscapeRight
        let newNote = app.buttons["newNote"]
        XCTAssertTrue(reveal(newNote, in: app), failureContext("New note must be available.", app: app))
        newNote.tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30))
        let editor = app.webViews.textViews.firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        editor.tap()
        editor.typeText("Keep this original note.")
        assertSourceText("Keep this original note.", in: editor, app: app)
        XCTAssertTrue(app.staticTexts["Saved on this iPad"].waitForExistence(timeout: 30),
            failureContext("The note must finish saving before its file actions become available.", app: app))
        app.buttons["documentActions"].tap()
        app.buttons["Rename"].tap()
        let name = app.textFields["documentName"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.tap()
        let oldName = name.value as? String ?? "Untitled"
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: oldName.count) + "Project notes")
        app.buttons["saveDocumentName"].tap()
        XCTAssertTrue(app.navigationBars["Project notes.txt"].waitForExistence(timeout: 10))
        app.buttons["documentActions"].tap()
        app.buttons["Duplicate"].tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30))
        let duplicateTab = app.buttons["tab-Project notes Copy.txt"]
        XCTAssertTrue(duplicateTab.waitForExistence(timeout: 10))
        assertSourceText("Keep this original note.", in: editor, app: app)
        let originalTab = app.buttons["tab-Project notes.txt"]
        if !originalTab.isHittable { app.scrollViews["documentTabs"].swipeRight() }
        originalTab.tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 30))
        assertSourceText("Keep this original note.", in: editor, app: app)
        attachScreenshot(app, name: "Renamed document and duplicate in tabs")
    }

    @MainActor
    func testCreateEditAndRestoreHWPThroughLocalStudio() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = launchArguments(resetLibrary: true)
        app.launch()
        let newHwp = app.buttons["newHwp"]
        XCTAssertTrue(reveal(newHwp, in: app), failureContext("The bundled HWP template must be available.", app: app))
        newHwp.tap()
        XCTAssertTrue(app.staticTexts["webEditorReady"].waitForExistence(timeout: 60), failureContext("The HWP engine must finish loading the document.", app: app))
        let input = app.webViews.descendants(matching: .any).matching(identifier: "문서 편집 입력").firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 60), failureContext("The local HTTP HWP studio and WASM input must load.", app: app))
        XCTAssertFalse(app.scrollViews["documentTabs"].exists)
        let webView = app.webViews.firstMatch
        let tools = webView.switches["Editing tools"]
        XCTAssertTrue(tools.waitForExistence(timeout: 10))
        XCTAssertEqual(tools.value as? String, "0")
        tools.tap()
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '1'"), object: tools)], timeout: 5), .completed)
        attachScreenshot(app, name: "Expanded HWP editing tools")
        tools.tap()
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '0'"), object: tools)], timeout: 5), .completed)
        attachScreenshot(app, name: "HWP studio before canvas input")
        // The studio uses an IME sink. A user taps the visible page to focus it.
        webView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).tap()
        app.typeText("Evergreen note survives reopening")
        XCTAssertTrue(app.staticTexts["Saved on this iPad"].waitForExistence(timeout: 30), failureContext("HWP changes must save through the native bridge.", app: app))
        attachScreenshot(app, name: "HWP canvas after input")
        app.terminate()
        app.launchArguments = launchArguments(resetLibrary: false)
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
