import XCTest
@testable import EveryOffice

final class EditorNavigationPolicyTests: XCTestCase {
    private let index = URL(string: "http://localhost:12345/token/index.html")!

    private func allows(_ value: String, mainFrame: Bool = false) -> Bool {
        EditorNavigationPolicy.allows(target: URL(string: value)!, mainFrame: mainFrame, trustedURL: index) { url in
            url.scheme == "http" && url.host == "localhost" && url.port == 12345 && url.path.hasPrefix("/token/")
        }
    }

    func testMainFrameCannotNavigateAwayFromExactTrustedIndex() {
        XCTAssertTrue(allows(index.absoluteString, mainFrame: true))
        for url in ["about:blank", "about:srcdoc", "http://localhost:12345/token/studio/index.html", "https://example.com", "blob:http://localhost:12345/identifier"] {
            XCTAssertFalse(allows(url, mainFrame: true), url)
        }
    }

    func testPreviewFramesCanUseSrcdocBlankAndSameOriginBlobs() {
        for url in ["about:blank", "about:srcdoc", "about:blank#preview", "blob:http://localhost:12345/identifier", "http://localhost:12345/token/drawio/index.html"] {
            XCTAssertTrue(allows(url), url)
        }
        for url in ["data:text/html,unsafe", "javascript:alert(1)", "https://example.com", "http://localhost:12345/wrong/index.html", "blob:https://example.com/identifier", "blob:http://localhost:23456/identifier", "file:///private/document.docx"] {
            XCTAssertFalse(allows(url), url)
        }
    }
}
