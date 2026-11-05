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
        XCTAssertEqual(EditorRoute.route(forExtension: "csv"), .web(resource: "SpreadsheetEditor", kind: "csv"))
        XCTAssertEqual(EditorRoute.route(forExtension: "tsv"), .web(resource: "SpreadsheetEditor", kind: "tsv"))
        XCTAssertEqual(EditorRoute.route(forExtension: "xls"), .web(resource: "SpreadsheetEditor", kind: "xls"))
        XCTAssertEqual(EditorRoute.route(forExtension: "ods"), .web(resource: "SpreadsheetEditor", kind: "ods"))
        XCTAssertEqual(EditorRoute.route(forExtension: "PDF"), .pdf)
        XCTAssertEqual(EditorRoute.route(forExtension: "unknown"), .preview)
    }

    func testEmbeddedDrawioPicturesUseEditorWithoutCapturingOrdinaryImages() {
        XCTAssertEqual(EditorRoute.route(forFilename: "Diagram.drawio.svg"), .web(resource: "FormatsEditor", kind: "svg"))
        XCTAssertEqual(EditorRoute.route(forFilename: "Diagram.drawio.png"), .web(resource: "FormatsEditor", kind: "png"))
        XCTAssertEqual(EditorRoute.route(forFilename: "Picture.png"), .preview)
        XCTAssertEqual(EditorRoute.route(forFilename: "Vector.svg"), .preview)
    }
}
