import XCTest
import PDFKit
import UIKit
@testable import EveryOffice

final class PDFInkTests: XCTestCase {
    func testPageCoordinatesRespectCropOriginAndRotation() {
        let bounds = CGRect(x: 10, y: 20, width: 100, height: 200)
        let corner = CGPoint.zero
        XCTAssertEqual(PDFInkGeometry(bounds: bounds, rotation: 0).pagePoint(fromCanvas: corner, canvasSize: bounds.size), CGPoint(x: 10, y: 220))
        XCTAssertEqual(PDFInkGeometry(bounds: bounds, rotation: 90).pagePoint(fromCanvas: corner, canvasSize: CGSize(width: 200, height: 100)), CGPoint(x: 10, y: 20))
        XCTAssertEqual(PDFInkGeometry(bounds: bounds, rotation: 180).pagePoint(fromCanvas: corner, canvasSize: bounds.size), CGPoint(x: 110, y: 20))
        XCTAssertEqual(PDFInkGeometry(bounds: bounds, rotation: 270).pagePoint(fromCanvas: corner, canvasSize: CGSize(width: 200, height: 100)), CGPoint(x: 110, y: 220))
    }

    @MainActor
    func testInkRoundTripRetainsPageTextAndEditableInkAnnotation() throws {
        let bounds = CGRect(x: 0, y: 0, width: 200, height: 300)
        let original = UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
            context.beginPage()
            ("Original page" as NSString).draw(at: CGPoint(x: 20, y: 20), withAttributes: [.font: UIFont.systemFont(ofSize: 12)])
        }
        let pdf = try XCTUnwrap(PDFDocument(data: original))
        let page = try XCTUnwrap(pdf.page(at: 0))
        let ink = try XCTUnwrap(PDFInkAnnotation.make(points: [CGPoint(x: 20, y: 80), CGPoint(x: 100, y: 80)],
            geometry: PDFInkGeometry(bounds: bounds, rotation: 0), lineWidth: 2, color: .blue))
        page.addAnnotation(ink)
        let saved = try XCTUnwrap(pdf.dataRepresentation())
        let restored = try XCTUnwrap(PDFDocument(data: saved))
        XCTAssertTrue(restored.string?.contains("Original page") == true)
        let restoredPage = try XCTUnwrap(restored.page(at: 0))
        XCTAssertEqual(restoredPage.annotations.count, 1)
        let restoredInk = try XCTUnwrap(restoredPage.annotations.first)
        XCTAssertEqual(restoredInk.type, "Ink")
        XCTAssertEqual(restoredInk.paths?.count, 1)
        XCTAssertEqual(try XCTUnwrap(restoredInk.paths?.first).bounds.midY, 220, accuracy: 1)
    }

    @MainActor
    func testPageReorderDeleteAndRotationPreserveRemainingPageContents() throws {
        let bounds = CGRect(x: 0, y: 0, width: 200, height: 300)
        let data = UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
            for name in ["First page", "Second page", "Third page"] {
                context.beginPage()
                (name as NSString).draw(at: CGPoint(x: 20, y: 20), withAttributes: [.font: UIFont.systemFont(ofSize: 12)])
            }
        }
        let pdf = try XCTUnwrap(PDFDocument(data: data))
        let first = try XCTUnwrap(pdf.page(at: 0))
        let third = try XCTUnwrap(pdf.page(at: 2))
        third.rotation = 90
        try PDFPageEditing.apply([third, first], to: pdf)
        let restored = try XCTUnwrap(PDFDocument(data: XCTUnwrap(pdf.dataRepresentation())))
        XCTAssertEqual(restored.pageCount, 2)
        XCTAssertTrue(restored.page(at: 0)?.string?.contains("Third page") == true)
        XCTAssertTrue(restored.page(at: 1)?.string?.contains("First page") == true)
        XCTAssertEqual(restored.page(at: 0)?.rotation, 90)
        XCTAssertFalse(restored.string?.contains("Second page") == true)
        XCTAssertThrowsError(try PDFPageEditing.apply([], to: pdf))
        XCTAssertThrowsError(try PDFPageEditing.apply([first, first], to: pdf))
    }
}
