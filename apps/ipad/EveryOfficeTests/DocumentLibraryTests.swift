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

    @MainActor
    func testRenameKeepsIdentityExtensionAndBytesAndSurvivesReload() throws {
        let library = makeLibrary()
        let note = try library.create(markdown: true)
        try library.saveText("# Original content", document: note)
        library.selectedID = note.id
        try library.toggleFavorite(note)
        let renamed = try library.rename(note, to: "Planning notes")
        XCTAssertEqual(renamed.id, note.id)
        XCTAssertEqual(renamed.filename, "Planning notes.md")
        XCTAssertTrue(renamed.isFavorite)
        XCTAssertEqual(library.selectedID, note.id)
        XCTAssertEqual(try library.readText(renamed), "# Original content")
        XCTAssertFalse(FileManager.default.fileExists(atPath: note.url.path))
        XCTAssertEqual(makeLibrary().documents.first?.filename, "Planning notes.md")
        XCTAssertThrowsError(try library.rename(renamed, to: "../Outside"))
        XCTAssertThrowsError(try library.rename(renamed, to: "Hidden\nName"))
    }

    @MainActor
    func testDuplicateUsesNewIdentityAndPreservesContentAndFormat() throws {
        let library = makeLibrary()
        let note = try library.create(markdown: false)
        try library.saveText("Keep both copies", document: note)
        let copy = try library.duplicate(note)
        XCTAssertNotEqual(copy.id, note.id)
        XCTAssertNotEqual(copy.filename, note.filename)
        XCTAssertEqual(copy.url.pathExtension, note.url.pathExtension)
        XCTAssertEqual(try Data(contentsOf: copy.url), try Data(contentsOf: note.url))
        try library.saveText("Change only the duplicate", document: copy)
        XCTAssertEqual(try library.readText(note), "Keep both copies")
        library.savingDocumentIDs.insert(note.id)
        XCTAssertThrowsError(try library.duplicate(note))
        XCTAssertThrowsError(try library.rename(note, to: "Pending"))
    }

    @MainActor
    func testTabsDoNotDuplicateAndClosingNeverDeletesDocument() throws {
        let library = makeLibrary()
        let first = try library.create(markdown: false)
        let second = try library.create(markdown: true)
        library.selectedID = first.id
        library.selectedID = second.id
        library.selectedID = first.id
        XCTAssertEqual(library.openDocumentIDs, [first.id, second.id])
        library.savingDocumentIDs.insert(first.id)
        XCTAssertThrowsError(try library.closeTab(first))
        library.savingDocumentIDs.remove(first.id)
        try library.closeTab(first)
        XCTAssertEqual(library.selectedID, second.id)
        XCTAssertTrue(FileManager.default.fileExists(atPath: first.url.path))
        try library.closeTab(second)
        XCTAssertNil(library.selectedID)
        XCTAssertEqual(library.documents.count, 2)
    }

    @MainActor
    func testConvertedImportCreatesIndependentDocumentAndRejectsUnsafeNames() throws {
        let source = root.appendingPathComponent("legacy.doc")
        let original = Data("Legacy original".utf8)
        try original.write(to: source)
        let library = makeLibrary()
        let legacy = try library.importDocument(from: source)
        let converted = try library.importCopy(data: Data("Converted DOCX".utf8), name: "legacy.docx", kind: "docx")
        XCTAssertNotEqual(converted.id, legacy.id)
        XCTAssertEqual(converted.url.pathExtension, "docx")
        XCTAssertEqual(try Data(contentsOf: legacy.url), original)
        XCTAssertThrowsError(try library.importCopy(data: Data(), name: "../escape.docx", kind: "docx"))
        XCTAssertThrowsError(try library.importCopy(data: Data(), name: "wrong.txt", kind: "docx"))
        XCTAssertThrowsError(try library.importCopy(data: Data(), name: "run.exe", kind: "exe"))
    }

    @MainActor
    func testReadingPositionPersistsPerDocumentAndViewPreferencesAreGlobal() throws {
        let library = makeLibrary()
        let first = try library.create(markdown: false)
        let second = try library.create(markdown: true)
        let original = try Data(contentsOf: first.url)
        try library.saveReadingState(["position": ["spineIndex": 2, "blockId": "chapter-two"], "viewPrefs": ["fontScale": 1.2, "lineHeight": 1.6, "dark": true]], document: first)
        let restored = makeLibrary()
        XCTAssertEqual((restored.readingState(for: first)["position"] as? [String: Any])?["spineIndex"] as? Int, 2)
        XCTAssertNil(restored.readingState(for: second)["position"])
        XCTAssertEqual((restored.readingState(for: second)["viewPrefs"] as? [String: Any])?["fontScale"] as? Double, 1.2)
        XCTAssertEqual(try Data(contentsOf: first.url), original)
        XCTAssertThrowsError(try library.saveReadingState(["position": ["spineIndex": -1]], document: first))
        XCTAssertThrowsError(try library.saveReadingState(["viewPrefs": ["fontScale": 9.0, "lineHeight": 1.6, "dark": false]], document: first))
    }
}
