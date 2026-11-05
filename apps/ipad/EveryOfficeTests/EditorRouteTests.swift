import XCTest
@testable import EveryOffice

final class EditorRouteTests: XCTestCase {
    func testStructuredDocumentsUseTheirDedicatedEditors() {
        XCTAssertEqual(EditorRoute.route(forExtension: "DOCX"), .web(resource: "DocumentEditor", kind: "docx"))
        XCTAssertEqual(EditorRoute.route(forExtension: "hwp"), .web(resource: "HwpEditor", kind: "hwp"))
        XCTAssertEqual(EditorRoute.route(forExtension: "hwpx"), .web(resource: "HwpEditor", kind: "hwpx"))
        for ext in ["html", "htm", "xmind", "epub", "drawio", "dio"] {
            XCTAssertEqual(EditorRoute.route(forExtension: ext), .web(resource: "FormatsEditor", kind: ext))
        }
    }

    func testNativeAndPreviewRoutesRemainAvailable() {
        XCTAssertEqual(EditorRoute.route(forExtension: "md"), .web(resource: "MarkdownEditor", kind: "md"))
        XCTAssertEqual(EditorRoute.route(forExtension: "txt"), .web(resource: "MarkdownEditor", kind: "txt"))
        XCTAssertEqual(EditorRoute.route(forExtension: "csv"), .text)
        XCTAssertEqual(EditorRoute.route(forExtension: "PDF"), .pdf)
        XCTAssertEqual(EditorRoute.route(forExtension: "unknown"), .preview)
    }
}
