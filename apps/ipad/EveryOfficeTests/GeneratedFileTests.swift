import XCTest
@testable import EveryOffice

final class GeneratedFileTests: XCTestCase {
    func testGeneratedExportPreservesFilenameAndBytesWithoutLibraryWrite() throws {
        let data = Data("Name,Count\nSample,2\n".utf8)
        let export = try GeneratedPDFPresentation.makeFile(data: data, name: "Summary.csv")
        defer { try? FileManager.default.removeItem(at: export.url.deletingLastPathComponent()) }
        XCTAssertEqual(export.url.lastPathComponent, "Summary.csv")
        XCTAssertEqual(try Data(contentsOf: export.url), data)
        XCTAssertThrowsError(try GeneratedPDFPresentation.makeFile(data: data, name: "../Outside.csv"))
        XCTAssertThrowsError(try GeneratedPDFPresentation.makeFile(data: data, name: "Hidden\nName.csv"))
    }
}
