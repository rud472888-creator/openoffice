import XCTest
import UIKit
import WebKit
@testable import EveryOffice

final class EditorSaveLifecycleTests: XCTestCase {
    @MainActor
    func testSaveRequestedBeforeOpenIsWrittenAfterEditorOpens() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = DocumentLibrary(directory: root.appendingPathComponent("library"))
        let document = try library.create(markdown: false)
        let expected = Data("Saved after opening: 한글".utf8)
        let page = """
        <!doctype html><script>
        window.everyOffice = {
          saveDocument() {
            window.webkit.messageHandlers.everyOffice.postMessage({
              type: 'save', revision: 0, base64: '\(expected.base64EncodedString())'
            });
          }
        };
        window.webkit.messageHandlers.everyOffice.postMessage({type: 'opened'});
        </script>
        """
        try Data(page.utf8).write(to: root.appendingPathComponent("index.html"))
        let coordinator = OfficeWebView.Coordinator(library: library, document: document, kind: "txt")
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(coordinator, name: "everyOffice")
        let view = WKWebView(frame: .zero, configuration: configuration)
        coordinator.webView = view
        view.navigationDelegate = coordinator
        let server = LocalEditorAssetServer(root: root)
        coordinator.assetServer = server
        defer { coordinator.releaseWebView() }
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previousWindow = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.frame = scene.coordinateSpace.bounds
        window.rootViewController = UIViewController()
        window.rootViewController?.view = view
        window.makeKeyAndVisible()
        defer { window.isHidden = true; previousWindow?.makeKeyAndVisible() }

        // A background/save action during document loading must remain pending.
        coordinator.requestSave()
        XCTAssertFalse(coordinator.saving)
        XCTAssertFalse(library.savingDocumentIDs.contains(document.id))
        let index: URL = try await withCheckedThrowingContinuation { continuation in
            server.start { continuation.resume(with: $0) }
        }
        coordinator.trustedURL = index
        view.load(URLRequest(url: index))
        let deadline = Date().addingTimeInterval(15)
        while coordinator.lastSavedRevision < 0 && Date() < deadline {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertEqual(try Data(contentsOf: document.url), expected)
        XCTAssertTrue(library.readyDocumentIDs.contains(document.id))
        XCTAssertFalse(coordinator.saving)
        XCTAssertFalse(coordinator.saveAgain)
        XCTAssertFalse(library.savingDocumentIDs.contains(document.id))
    }
}
