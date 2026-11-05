import XCTest
import UIKit
import WebKit
@testable import EveryOffice

final class BundledEditorBridgeTests: XCTestCase {
    @MainActor
    func testDOCXEditorOpensAndSavesThroughWebKit() async throws {
        try await exercise(resource: "DocumentEditor", kind: "docx", template: "Blank.docx", format: .zip, unchanged: true)
    }

    @MainActor
    func testXLSXEditorOpensAndSavesThroughWebKit() async throws {
        try await exercise(resource: "SpreadsheetEditor", kind: "xlsx", template: "Blank.xlsx", format: .zip)
    }

    @MainActor
    func testPPTXEditorOpensAndSavesThroughWebKit() async throws {
        try await exercise(resource: "PresentationEditor", kind: "pptx", template: "Blank.pptx", format: .zip)
    }

    @MainActor
    func testHWPStudioOpensAndSavesThroughWebKit() async throws {
        try await exercise(resource: "HwpEditor", kind: "hwp", template: "Blank.hwp", format: .hwp, unchanged: true)
    }

    @MainActor
    func testXMindEditorOpensAndSavesThroughWebKit() async throws {
        try await exercise(resource: "FormatsEditor", kind: "xmind", template: "Blank.xmind", format: .zip)
    }

    @MainActor
    func testEPUBEditorOpensAndSavesThroughWebKit() async throws {
        try await exercise(resource: "FormatsEditor", kind: "epub", template: "Blank.epub", format: .zip)
    }

    @MainActor
    func testHTMLEditorOpensAndSavesThroughWebKit() async throws {
        try await exercise(resource: "FormatsEditor", kind: "html", template: "Blank.html", format: .html)
    }

    @MainActor
    func testDrawioEditorOpensAndSavesThroughWebKit() async throws {
        try await exercise(resource: "FormatsEditor", kind: "drawio", template: "Blank.drawio", format: .drawio)
    }

    @MainActor
    func testMarkdownEditorPreservesNoOpSourceThroughWebKit() async throws {
        let source = Data("\u{FEFF}---\r\ntitle: Native\r\n---\r\n# Native WK acceptance\r\n\r\nExact source.\r\n".utf8)
        try await exercise(resource: "MarkdownEditor", kind: "md", source: source, format: .text, unchanged: true)
    }

    private enum SavedFormat { case zip, hwp, html, drawio, text }

    @MainActor
    private func exercise(resource: String, kind: String, template: String? = nil, source: Data? = nil,
                          format: SavedFormat, unchanged: Bool = false) async throws {
        let started = Date()
        let deadline = started.addingTimeInterval(60)
        func remaining() -> TimeInterval { max(0.1, deadline.timeIntervalSinceNow) }
        let resources = try XCTUnwrap(Bundle.main.resourceURL)
        let root = resources.appendingPathComponent(resource, isDirectory: true)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path), "Missing bundled editor: \(resource)")
        let bytes: Data
        if let source { bytes = source }
        else { bytes = try Data(contentsOf: resources.appendingPathComponent("Templates").appendingPathComponent(try XCTUnwrap(template))) }
        let harness = try EditorHarness(root: root, outputExtension: kind)
        defer {
            let attachment = XCTAttachment(string: harness.diagnostics)
            attachment.name = "\(resource)-\(kind)-bridge-messages"
            attachment.lifetime = .keepAlways
            add(attachment)
            harness.stop()
        }
        harness.start()
        await fulfillment(of: [harness.ready], timeout: remaining())
        XCTAssertTrue(harness.readyReceived, "\(resource)/\(kind) ready phase: \(harness.diagnostics)")
        guard harness.readyReceived else { return }
        let payload: [String: Any] = ["name": "Native.\(kind)", "kind": kind, "base64": bytes.base64EncodedString(), "language": "en", "locale": "en"]
        harness.call("await window.everyOffice.openDocument(payload); return true;", arguments: ["payload": payload])
        await fulfillment(of: [harness.opened], timeout: remaining())
        XCTAssertTrue(harness.openedReceived, "\(resource)/\(kind) opened phase: \(harness.diagnostics)")
        guard harness.openedReceived else { return }
        harness.call("await window.everyOffice.saveDocument(); return true;")
        await fulfillment(of: [harness.saved], timeout: remaining())
        XCTAssertTrue(harness.errors.isEmpty, "\(resource)/\(kind): \(harness.diagnostics)")
        let saved = try XCTUnwrap(harness.savedData, "\(resource)/\(kind) save phase: \(harness.diagnostics)")
        XCTAssertFalse(saved.isEmpty)
        switch format {
        case .zip: XCTAssertEqual(Array(saved.prefix(4)), [0x50, 0x4b, 0x03, 0x04], "\(kind) must remain a ZIP-based document")
        case .hwp: XCTAssertEqual(Array(saved.prefix(8)), [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], "HWP must retain its compound-file format")
        case .html:
            let text = try XCTUnwrap(String(data: saved, encoding: .utf8))
            XCTAssertTrue(text.contains("<") && text.contains(">"), "HTML must remain UTF-8 markup")
        case .drawio:
            let text = try XCTUnwrap(String(data: saved, encoding: .utf8))
            XCTAssertTrue(text.contains("<mxfile") || text.contains("<mxGraphModel"), "draw.io must remain its XML format")
        case .text: XCTAssertNotNil(String(data: saved, encoding: .utf8))
        }
        if unchanged { XCTAssertEqual(saved, bytes, "\(resource)/\(kind) guarantees original-byte no-op saves") }
        XCTAssertLessThanOrEqual(Date().timeIntervalSince(started), 60, "The complete route contract must finish within 60 seconds")
    }
}

@MainActor
private final class EditorHarness: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let ready = XCTestExpectation(description: "Bundled editor ready")
    let opened = XCTestExpectation(description: "Bundled document opened")
    let saved = XCTestExpectation(description: "Bundled document saved")
    private(set) var readyReceived = false
    private(set) var openedReceived = false
    private(set) var savedData: Data?
    private(set) var errors: [String] = []
    private var messages: [String] = []
    private var readyFulfilled = false
    private var openedFulfilled = false
    private var savedFulfilled = false
    private let server: LocalEditorAssetServer
    private let webView: WKWebView
    private let window: UIWindow
    private weak var previousKeyWindow: UIWindow?
    private let output: URL
    private var trustedURL: URL?

    var diagnostics: String { (messages + errors.map { "ERROR: \($0)" }).joined(separator: " | ") }

    init(root: URL, outputExtension: String) throws {
        server = LocalEditorAssetServer(root: root)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: .zero, configuration: configuration)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive }) ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first,
            "The app-hosted test needs an iPad window scene")
        window = UIWindow(windowScene: scene)
        previousKeyWindow = scene.windows.first(where: \.isKeyWindow)
        output = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(outputExtension)
        super.init()
        webView.configuration.userContentController.add(self, name: "everyOffice")
        webView.navigationDelegate = self
        let controller = UIViewController()
        controller.view.backgroundColor = .systemBackground
        window.rootViewController = controller
        window.frame = scene.coordinateSpace.bounds
        window.makeKeyAndVisible()
        controller.view.layoutIfNeeded()
        webView.frame = controller.view.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        controller.view.addSubview(webView)
    }

    func start() {
        server.start { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let index): trustedURL = index; webView.load(URLRequest(url: index))
            case .failure(let error): fail(error.localizedDescription)
            }
        }
    }

    func call(_ source: String, arguments: [String: Any] = [:]) {
        webView.callAsyncJavaScript(source, arguments: arguments, in: nil, in: .page, completionHandler: { [weak self] result in
            if case .failure(let error) = result { self?.fail(error.localizedDescription) }
        })
    }

    func stop() {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "everyOffice")
        webView.removeFromSuperview()
        window.isHidden = true
        previousKeyWindow?.makeKeyAndVisible()
        server.stop()
        try? FileManager.default.removeItem(at: output)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let trustedURL, message.frameInfo.isMainFrame, message.frameInfo.request.url == trustedURL,
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        messages.append(type)
        switch type {
        case "ready": readyReceived = true; fulfillReady()
        case "opened": openedReceived = true; fulfillOpened()
        case "save":
            do {
                guard let base64 = body["base64"] as? String, let data = Data(base64Encoded: base64), !data.isEmpty else { throw LibraryError.invalidFile }
                try data.write(to: output, options: .atomic)
                savedData = try Data(contentsOf: output)
                let revision = body["revision"] as? Int ?? 0
                webView.callAsyncJavaScript("if (window.everyOffice.didSave) await window.everyOffice.didSave(revision); return true;",
                    arguments: ["revision": revision], in: nil, in: .page, completionHandler: { [weak self] result in
                    switch result {
                    case .success: self?.fulfillSaved()
                    case .failure(let error): self?.fail(error.localizedDescription)
                    }
                })
            } catch { fail(error.localizedDescription) }
        case "error": fail(body["message"] as? String ?? "The editor reported an error")
        default: break
        }
    }

    private func fail(_ message: String) {
        errors.append(String(message.prefix(1500)))
        fulfillReady()
        fulfillOpened()
        fulfillSaved()
    }
    private func fulfillReady() { if !readyFulfilled { readyFulfilled = true; ready.fulfill() } }
    private func fulfillOpened() { if !openedFulfilled { openedFulfilled = true; opened.fulfill() } }
    private func fulfillSaved() { if !savedFulfilled { savedFulfilled = true; saved.fulfill() } }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = navigationAction.request.url, let frame = navigationAction.targetFrame, let trustedURL else { decisionHandler(.cancel); return }
        let allowed = EditorNavigationPolicy.allows(target: target, mainFrame: frame.isMainFrame, trustedURL: trustedURL) { server.allowsNavigation(to: $0) }
        decisionHandler(allowed ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error.localizedDescription) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error.localizedDescription) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { fail("The WebKit content process terminated") }
}
