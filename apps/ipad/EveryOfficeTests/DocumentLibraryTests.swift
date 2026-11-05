import XCTest
@testable import EveryOffice

final class DocumentLibraryTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }

    @MainActor
    private func makeLibrary() -> DocumentLibrary {
        DocumentLibrary(directory: root.appendingPathComponent("library"))
    }

    @MainActor
    func testImportsCopiesAndPreservesOfficeBytesAndDuplicateNames() throws {
        let source = root.appendingPathComponent("Sample.docx")
        let bytes = Data([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff])
        try bytes.write(to: source)
        let library = makeLibrary()
        let first = try library.importDocument(from: source)
        let second = try library.importDocument(from: source)
        XCTAssertNotEqual(first.id, second.id)
        XCTAssertEqual(first.filename, second.filename)
        XCTAssertEqual(try Data(contentsOf: first.url), bytes)
        XCTAssertEqual(try Data(contentsOf: source), bytes)
        XCTAssertEqual(makeLibrary().documents.count, 2)
    }

    @MainActor
    func testTextPersistsAndFavoritesSurviveRelaunch() throws {
        let library = makeLibrary()
        let note = try library.create(markdown: true)
        try library.saveText("# Hello\n안녕하세요 🌿", document: note)
        try library.toggleFavorite(note)
        let restored = makeLibrary()
        let document = try XCTUnwrap(restored.documents.first)
        XCTAssertEqual(try restored.readText(document), "# Hello\n안녕하세요 🌿")
        XCTAssertTrue(document.isFavorite)
        XCTAssertEqual(document.kind, .markdown)
    }

    @MainActor
    func testRejectsBinaryTextWithoutOverwritingIt() throws {
        let source = root.appendingPathComponent("binary.txt")
        let bytes = Data([0xff, 0xfe, 0x00])
        try bytes.write(to: source)
        let library = makeLibrary()
        let document = try library.importDocument(from: source)
        XCTAssertThrowsError(try library.readText(document))
        XCTAssertEqual(try Data(contentsOf: document.url), bytes)
    }

    @MainActor
    func testRejectsDirectoriesAndOversizeImport() throws {
        let library = makeLibrary()
        XCTAssertThrowsError(try library.importDocument(from: root))
        let large = root.appendingPathComponent("large.pdf")
        FileManager.default.createFile(atPath: large.path, contents: Data())
        let handle = try FileHandle(forWritingTo: large)
        try handle.truncate(atOffset: UInt64(DocumentLibrary.maximumImportBytes + 1))
        try handle.close()
        XCTAssertThrowsError(try library.importDocument(from: large))
        XCTAssertTrue(library.documents.isEmpty)
    }

    @MainActor
    func testDeleteOnlyRemovesLibraryCopyAndCannotResurrectIt() throws {
        let source = root.appendingPathComponent("original.txt")
        try Data("Original".utf8).write(to: source)
        let library = makeLibrary()
        let copy = try library.importDocument(from: source)
        library.selectedID = copy.id
        try library.delete(copy)
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
        XCTAssertTrue(library.documents.isEmpty)
        XCTAssertNil(library.selectedID)
        XCTAssertThrowsError(try library.saveText("Late save", document: copy))
    }

    @MainActor
    func testUnsavedDocumentCannotBeDeleted() throws {
        let library = makeLibrary()
        let document = try library.create(markdown: false)
        library.savingDocumentIDs.insert(document.id)
        XCTAssertThrowsError(try library.delete(document))
        XCTAssertTrue(FileManager.default.fileExists(atPath: document.url.path))
    }

    @MainActor
    func testCreatesUniqueNoteNamesAndRefusesOfficeTextWrite() throws {
        let library = makeLibrary()
        let first = try library.create(markdown: false)
        let second = try library.create(markdown: false)
        XCTAssertNotEqual(first.filename, second.filename)
        let source = root.appendingPathComponent("keep.docx")
        try Data("Original office bytes".utf8).write(to: source)
        let document = try library.importDocument(from: source)
        XCTAssertThrowsError(try library.saveText("replacement", document: document))
        XCTAssertEqual(try Data(contentsOf: document.url), Data("Original office bytes".utf8))
    }

    @MainActor
    func testMalformedFavoritesCannotHideDocuments() throws {
        let library = makeLibrary()
        let note = try library.create(markdown: false)
        try Data("invalid json".utf8).write(to: root.appendingPathComponent("library/favorites.json"))
        XCTAssertEqual(makeLibrary().documents.first?.id, note.id)
    }

    @MainActor
    func testFailedTextSaveRetainsDraftAndSuccessfulRetryClearsIt() throws {
        let library = makeLibrary()
        let note = try library.create(markdown: false)
        let oversized = String(repeating: "x", count: DocumentLibrary.maximumTextBytes + 1)
        XCTAssertThrowsError(try library.saveText(oversized, document: note))
        XCTAssertEqual(library.textDrafts[note.id], oversized)
        XCTAssertTrue(library.savingDocumentIDs.contains(note.id))
        XCTAssertEqual(try Data(contentsOf: note.url), Data())
        try library.saveText("Recovered draft", document: note)
        XCTAssertNil(library.textDrafts[note.id])
        XCTAssertFalse(library.savingDocumentIDs.contains(note.id))
        XCTAssertEqual(try library.readText(note), "Recovered draft")
    }
}
