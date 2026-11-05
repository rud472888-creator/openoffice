import XCTest
import PDFKit
@testable import EveryOffice

final class SVGPagePDFRendererTests: XCTestCase {
    private func message(svg: String, width: Double = 200, height: Double = 100) -> [String: Any] {
        ["svg": svg, "width": width, "height": height]
    }

    func testRejectsActiveContentExternalImagesAndEntityDeclarations() {
        for svg in [
            "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
            "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>",
            "<svg xmlns='http://www.w3.org/2000/svg'><image href='https://example.com/pixel.png'/></svg>",
            "<svg xmlns='http://www.w3.org/2000/svg'><foreignObject/></svg>",
            "<!DOCTYPE svg [<!ENTITY test 'unsafe'>]><svg xmlns='http://www.w3.org/2000/svg'>&test;</svg>"
        ] { XCTAssertFalse(SVGPrintPage.isSafeSVG(svg), String(svg.prefix(100))) }
    }

    func testAllowsLocalSvgDefinitionsAndRejectsInvalidDimensions() throws {
        let svg = "<svg xmlns='http://www.w3.org/2000/svg'><defs><path id='line' d='M0 0L10 10'/></defs><use href='#line'/></svg>"
        XCTAssertTrue(SVGPrintPage.isSafeSVG(svg))
        XCTAssertThrowsError(try SVGPrintPage(message: message(svg: svg, width: .infinity)))
        XCTAssertThrowsError(try SVGPrintPage(message: message(svg: svg, width: -1)))
        XCTAssertThrowsError(try SVGPrintPage(message: message(svg: svg, height: 4_001)))
        XCTAssertThrowsError(try SVGPrintPage.pages(from: ["pages": []]))
        XCTAssertThrowsError(try SVGPrintPage.pages(from: ["pages": Array(repeating: message(svg: svg), count: 251)]))
    }

    func testHtmlPageRejectsActiveContentAndAllowsStaticTables() throws {
        let html = "<style>table{border-collapse:collapse}</style><table><tr><td>Static cell</td></tr></table>"
        XCTAssertTrue(SVGPrintPage.isSafeHTML(html))
        XCTAssertNoThrow(try SVGPrintPage(message: ["html": html, "width": 200.0, "height": 100.0]))
        XCTAssertThrowsError(try SVGPrintPage(message: ["svg": "<svg/>", "html": html, "width": 200.0, "height": 100.0]))
        for invalid in ["<script>alert(1)</script>", "<p onclick='alert(1)'>Text</p>", "<iframe src='data:text/html,test'></iframe>", "<!DOCTYPE html><p>Text</p>", "<meta http-equiv='refresh' content='0;https://example.com'>", "<img src='https://example.com/image.png'>"] {
            XCTAssertFalse(SVGPrintPage.isSafeHTML(invalid), invalid)
        }
    }

    @MainActor
    func testWebKitRenderingCombinesVectorPagesWithRequestedSizes() async throws {
        let first = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 100'><rect width='200' height='100' fill='white'/><text x='10' y='30' font-size='14'>Native page one</text></svg>"
        let second = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 200'><rect width='300' height='200' fill='white'/><text x='10' y='30' font-size='14'>Native page two</text></svg>"
        let pages = try [SVGPrintPage(message: message(svg: first)), SVGPrintPage(message: message(svg: second, width: 300, height: 200))]
        let renderer = SVGPagePDFRenderer()
        let bytes = try await renderer.render(pages)
        let pdf = try XCTUnwrap(PDFDocument(data: bytes))
        XCTAssertEqual(pdf.pageCount, 2)
        XCTAssertEqual(try XCTUnwrap(pdf.page(at: 0)).bounds(for: .mediaBox).width, 200, accuracy: 1)
        XCTAssertEqual(try XCTUnwrap(pdf.page(at: 1)).bounds(for: .mediaBox).height, 200, accuracy: 1)
        XCTAssertTrue(pdf.string?.contains("Native page one") == true)
        XCTAssertTrue(pdf.string?.contains("Native page two") == true)
    }

    @MainActor
    func testContinuousHtmlPaginationRetainsContentBeyondFirstPage() async throws {
        let html = "<div style='height:160px'>First paginated content</div><p>Last paginated marker</p>"
        let page = try SVGPrintPage(message: ["html": html, "width": 200.0, "height": 100.0, "paginate": true])
        let renderer = SVGPagePDFRenderer()
        let data = try await renderer.render([page])
        let pdf = try XCTUnwrap(PDFDocument(data: data))
        XCTAssertGreaterThan(pdf.pageCount, 1)
        XCTAssertTrue(pdf.string?.contains("Last paginated marker") == true)
    }
}
