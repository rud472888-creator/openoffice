import XCTest
@testable import EveryOffice

final class DocumentConversionPolicyTests: XCTestCase {
    func testOnlyMatchingCsvConversionSaveCanCompleteSourceSession() {
        XCTAssertTrue(DocumentConversionPolicy.completesSource(sourceExtension: "csv", destinationKind: "xlsx", conversionSave: true, savedRevision: 3, currentRevision: 3))
        XCTAssertTrue(DocumentConversionPolicy.completesSource(sourceExtension: "xls", destinationKind: "xlsx", conversionSave: true, savedRevision: 3, currentRevision: 3))
        XCTAssertTrue(DocumentConversionPolicy.completesSource(sourceExtension: "ods", destinationKind: "xlsx", conversionSave: true, savedRevision: 3, currentRevision: 3))
        XCTAssertFalse(DocumentConversionPolicy.completesSource(sourceExtension: "csv", destinationKind: "xlsx", conversionSave: true, savedRevision: 2, currentRevision: 3))
        XCTAssertFalse(DocumentConversionPolicy.completesSource(sourceExtension: "csv", destinationKind: "xlsx", conversionSave: false, savedRevision: 3, currentRevision: 3))
        XCTAssertFalse(DocumentConversionPolicy.completesSource(sourceExtension: "hwp", destinationKind: "hwpx", conversionSave: true, savedRevision: 3, currentRevision: 3))
        XCTAssertFalse(DocumentConversionPolicy.completesSource(sourceExtension: "docx", destinationKind: "docx", conversionSave: true, savedRevision: 3, currentRevision: 3))
    }
}
