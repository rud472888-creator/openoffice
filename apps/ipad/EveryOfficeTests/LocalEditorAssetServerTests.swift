import XCTest
@testable import EveryOffice

final class LocalEditorAssetServerTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws { try FileManager.default.removeItem(at: directory) }

    func testResolverRejectsTraversalAndIncorrectTokens() throws {
        let root = directory.appendingPathComponent("assets", isDirectory: true)
        let resolver = EditorAssetResolver(root: root, token: "secret-token")
        let expected = root.appendingPathComponent("studio/index.html").standardizedFileURL.resolvingSymlinksInPath()
        XCTAssertEqual(resolver.resourceURL(for: "/secret-token/studio/index.html?v=1"), expected)
        XCTAssertEqual(resolver.resourceURL(for: "/secret-token/studio/"), expected)
        for target in ["/wrong/index.html", "/secret-token/../document.docx",
                       "/secret-token/%2e%2e/document.docx", "/secret-token/studio%2f..%2f..%2fdocument.docx",
                       "/secret-token/%00", "/secret-token/%5csecret", "/secret-token//index.html",
                       "http://localhost/secret-token/index.html", "//secret-token/index.html", ""] {
            XCTAssertNil(resolver.resourceURL(for: target), target)
        }
    }

    func testResolverRejectsSymlinksOutsideResourceRoot() throws {
        let root = directory.appendingPathComponent("assets", isDirectory: true)
        let outside = directory.appendingPathComponent("documents", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("escape"), withDestinationURL: outside)
        XCTAssertNil(EditorAssetResolver(root: root, token: "token").resourceURL(for: "/token/escape/document.docx"))
        // Cover absent leaves, existing leaves, and dangling links separately.
        try Data("private".utf8).write(to: outside.appendingPathComponent("document.docx"))
        XCTAssertNil(EditorAssetResolver(root: root, token: "token").resourceURL(for: "/token/escape/document.docx"))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("dangling"),
            withDestinationURL: directory.appendingPathComponent("missing"))
        XCTAssertNil(EditorAssetResolver(root: root, token: "token").resourceURL(for: "/token/dangling/document.docx"))
        try Data("asset".utf8).write(to: root.appendingPathComponent("index.html"))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("alias.html"),
            withDestinationURL: root.appendingPathComponent("index.html"))
        XCTAssertNil(EditorAssetResolver(root: root, token: "token").resourceURL(for: "/token/alias.html"))
    }

    func testResolverDecodesUnicodeAndUsesWasmAndFontMimeTypes() {
        let resolver = EditorAssetResolver(root: directory, token: "token")
        XCTAssertEqual(resolver.resourceURL(for: "/token/My%20Font.woff2"), directory.appendingPathComponent("My Font.woff2").resolvingSymlinksInPath())
        XCTAssertEqual(EditorAssetResolver.mimeType(for: directory.appendingPathComponent("engine.wasm")), "application/wasm")
        XCTAssertEqual(EditorAssetResolver.mimeType(for: directory.appendingPathComponent("font.woff2")), "font/woff2")
        XCTAssertEqual(EditorAssetResolver.mimeType(for: directory.appendingPathComponent("module.mjs")), "text/javascript; charset=utf-8")
    }

    func testServerServesOnlyTokenAssetsAndRejectsWrites() async throws {
        let bytes = Data("<!doctype html><p>Offline editor</p>".utf8)
        try bytes.write(to: directory.appendingPathComponent("index.html"))
        let server = LocalEditorAssetServer(root: directory)
        defer { server.stop() }
        let index: URL = try await withCheckedThrowingContinuation { continuation in
            server.start { continuation.resume(with: $0) }
        }
        XCTAssertEqual(index.host, "localhost")
        XCTAssertTrue(server.allowsNavigation(to: index))
        XCTAssertFalse(server.allowsNavigation(to: URL(string: "https://example.com/index.html")!))
        XCTAssertFalse(server.allowsNavigation(to: URL(string: "http://localhost:\(index.port!)/wrong/index.html")!))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 15
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(from: index)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual(data, bytes)
        var head = URLRequest(url: index)
        head.httpMethod = "HEAD"
        let (headData, headResponse) = try await session.data(for: head)
        XCTAssertEqual((headResponse as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertTrue(headData.isEmpty)
        var post = URLRequest(url: index)
        post.httpMethod = "POST"
        let (_, postResponse) = try await session.data(for: post)
        XCTAssertEqual((postResponse as? HTTPURLResponse)?.statusCode, 405)
        let wrong = URL(string: "http://localhost:\(index.port!)/wrong/index.html")!
        let (_, missingResponse) = try await session.data(from: wrong)
        XCTAssertEqual((missingResponse as? HTTPURLResponse)?.statusCode, 404)
    }

    func testStoppedServerCompletesStartupWithCancellation() async {
        let server = LocalEditorAssetServer(root: directory)
        server.stop()
        let completed = expectation(description: "Stopped asset server reports startup cancellation")
        completed.assertForOverFulfill = true
        server.start { result in
            switch result {
            case .success: XCTFail("A stopped server must not start a listener")
            case .failure(let error): XCTAssertEqual((error as? URLError)?.code, .cancelled)
            }
            completed.fulfill()
        }
        await fulfillment(of: [completed], timeout: 2)
    }
}
