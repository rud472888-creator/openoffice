import Foundation
import Observation

@MainActor
@Observable
final class DocumentLibrary {
    private(set) var documents: [OfficeDocument] = []
    var selectedID: UUID? {
        didSet {
            if let selectedID, documents.contains(where: { $0.id == selectedID }), !openDocumentIDs.contains(selectedID) {
                openDocumentIDs.append(selectedID)
            }
        }
    }
    private(set) var openDocumentIDs: [UUID] = []
    var errorMessage: String?
    var savingDocumentIDs: Set<UUID> = []
    var readyDocumentIDs: Set<UUID> = []
    var preparingPDF = false
    var generatedPDF: GeneratedPDFPresentation?
    @ObservationIgnored var generatedFileCompletion: ((Bool) -> Void)?
    private(set) var textDrafts: [UUID: String] = [:]
    @ObservationIgnored var pendingSaveActions: [UUID: () -> Void] = [:]
    private let directory: URL
    private let fileManager: FileManager
    private var favorites: Set<UUID> = []
    private var readingMetadata = EditorReadingMetadata()
    nonisolated static let maximumImportBytes: Int64 = 100 * 1_024 * 1_024
    nonisolated static let maximumTextBytes = 10 * 1_024 * 1_024

    init(directory: URL? = nil, fileManager: FileManager = .default) {
        self.fileManager = fileManager
        self.directory = directory ?? fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Library", isDirectory: true)
        do {
            #if DEBUG
            if directory == nil, ProcessInfo.processInfo.arguments.contains("--uitesting-reset-library"),
               fileManager.fileExists(atPath: self.directory.path) {
                try fileManager.removeItem(at: self.directory)
            }
            #endif
            try fileManager.createDirectory(at: self.directory, withIntermediateDirectories: true)
            if let data = try? Data(contentsOf: favoritesURL) {
                favorites = Set((try? JSONDecoder().decode([UUID].self, from: data)) ?? [])
            }
            if let data = try? Data(contentsOf: readingMetadataURL), let stored = try? JSONDecoder().decode(EditorReadingMetadata.self, from: data) { readingMetadata = stored }
            try reload()
        } catch { present(error) }
    }

    private var favoritesURL: URL { directory.appendingPathComponent("favorites.json") }
    private var readingMetadataURL: URL { directory.appendingPathComponent(".reading-state.json") }
    var selectedDocument: OfficeDocument? { documents.first { $0.id == selectedID } }
    var openDocuments: [OfficeDocument] { openDocumentIDs.compactMap { id in documents.first { $0.id == id } } }

    func present(_ error: Error) { errorMessage = error.localizedDescription }
    func retryPendingSaves() { for action in Array(pendingSaveActions.values) { action() } }

    func readingState(for document: OfficeDocument) -> [String: Any] { readingMetadata.payload(for: document.id) }

    func saveReadingState(_ message: [String: Any], document: OfficeDocument) throws {
        guard documents.contains(where: { $0.id == document.id }) else { throw LibraryError.missingDocument }
        var updated = readingMetadata
        try updated.update(id: document.id, message: message)
        try JSONEncoder().encode(updated).write(to: readingMetadataURL, options: .atomic)
        readingMetadata = updated
    }

    func closeTab(_ document: OfficeDocument) throws {
        guard !savingDocumentIDs.contains(document.id) else { throw LibraryError.pendingSave }
        guard let index = openDocumentIDs.firstIndex(of: document.id) else { return }
        openDocumentIDs.remove(at: index)
        if selectedID == document.id {
            selectedID = openDocumentIDs.isEmpty ? nil : openDocumentIDs[min(index, openDocumentIDs.count - 1)]
        }
    }

    @discardableResult
    func rename(_ document: OfficeDocument, to proposedName: String) throws -> OfficeDocument {
        try requireSaved(document)
        let name = proposedName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !name.hasPrefix("."), !name.hasSuffix("."),
              !name.contains("/"), !name.contains("\\"), !name.contains(":"),
              !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              name.utf8.count <= 180 else { throw LibraryError.invalidName }
        let ext = document.url.pathExtension
        let filename = ext.isEmpty ? name : "\(name).\(ext)"
        let destination = document.url.deletingLastPathComponent().appendingPathComponent(filename)
        if destination != document.url { try fileManager.moveItem(at: document.url, to: destination) }
        try reload()
        guard let renamed = documents.first(where: { $0.id == document.id }) else { throw LibraryError.missingDocument }
        return renamed
    }

    @discardableResult
    func duplicate(_ document: OfficeDocument) throws -> OfficeDocument {
        try requireSaved(document)
        let base = "\(document.name) \(String(localized: "Copy"))"
        let ext = document.url.pathExtension
        var count = 1
        var name = base
        func filename() -> String { ext.isEmpty ? name : "\(name).\(ext)" }
        while documents.contains(where: { $0.filename == filename() }) {
            count += 1
            name = "\(base) \(count)"
        }
        return try insert(filename: filename()) { destination in
            try fileManager.copyItem(at: document.url, to: destination)
        }
    }

    private func requireSaved(_ document: OfficeDocument) throws {
        guard !savingDocumentIDs.contains(document.id) else { throw LibraryError.pendingSave }
        guard documents.contains(where: { $0.id == document.id && $0.url == document.url }) else { throw LibraryError.missingDocument }
    }

    @discardableResult
    func importCopy(data: Data, name: String, kind: String) throws -> OfficeDocument {
        let allowed = ["docx", "odt", "xlsx", "pptx", "hwp", "hwpx", "pdf", "html", "md", "txt"]
        guard allowed.contains(kind.lowercased()), URL(fileURLWithPath: name).pathExtension.lowercased() == kind.lowercased(),
              !name.isEmpty, !name.hasPrefix("."), !name.contains("/"), !name.contains("\\"), !name.contains(":"),
              !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }), name.utf8.count <= 240 else { throw LibraryError.invalidName }
        guard Int64(data.count) <= Self.maximumImportBytes else { throw LibraryError.tooLarge }
        return try insert(filename: name) { destination in try data.write(to: destination, options: .atomic) }
    }

    func reload() throws {
        let folders = try fileManager.contentsOfDirectory(at: directory,
            includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])
        var found: [OfficeDocument] = []
        for folder in folders {
            guard let id = UUID(uuidString: folder.lastPathComponent),
                  (try? folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { continue }
            let files = try fileManager.contentsOfDirectory(at: folder,
                includingPropertiesForKeys: [.isRegularFileKey, .contentModificationDateKey, .fileSizeKey],
                options: [.skipsHiddenFiles])
            for file in files {
                let values = try file.resourceValues(forKeys: [.isRegularFileKey, .contentModificationDateKey, .fileSizeKey])
                guard values.isRegularFile == true else { continue }
                found.append(OfficeDocument(id: id, url: file,
                    modifiedAt: values.contentModificationDate ?? .distantPast,
                    byteCount: Int64(values.fileSize ?? 0), isFavorite: favorites.contains(id)))
                break
            }
        }
        documents = found.sorted { $0.modifiedAt > $1.modifiedAt }
    }

    @discardableResult
    func importDocument(from source: URL) throws -> OfficeDocument {
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        var coordinationError: NSError?
        var outcome: Result<OfficeDocument, Error>?
        NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordinationError) { readable in
            outcome = Result {
                let values = try readable.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
                guard values.isRegularFile == true, values.isSymbolicLink != true else { throw LibraryError.invalidFile }
                guard Int64(values.fileSize ?? 0) <= Self.maximumImportBytes else { throw LibraryError.tooLarge }
                return try insert(filename: readable.lastPathComponent) { destination in
                    try fileManager.copyItem(at: readable, to: destination)
                }
            }
        }
        if let coordinationError { throw coordinationError }
        guard let outcome else { throw LibraryError.invalidFile }
        return try outcome.get()
    }

    @discardableResult
    func create(markdown: Bool) throws -> OfficeDocument {
        let base = String(localized: "Untitled")
        let ext = markdown ? "md" : "txt"
        var filename = "\(base).\(ext)"
        var count = 2
        while documents.contains(where: { $0.filename == filename }) {
            filename = "\(base) \(count).\(ext)"
            count += 1
        }
        return try insert(filename: filename) { destination in
            try Data().write(to: destination, options: .atomic)
        }
    }

    @discardableResult
    func createOffice(extension ext: String) throws -> OfficeDocument {
        guard ["docx", "xlsx", "pptx", "hwp", "hwpx", "html", "xmind", "epub", "drawio"].contains(ext),
              let templates = Bundle.main.resourceURL?.appendingPathComponent("Templates"),
              fileManager.fileExists(atPath: templates.appendingPathComponent("Blank.\(ext)").path) else {
            throw LibraryError.missingDocument
        }
        let base = String(localized: "Untitled")
        var filename = "\(base).\(ext)"
        var count = 2
        while documents.contains(where: { $0.filename == filename }) {
            filename = "\(base) \(count).\(ext)"
            count += 1
        }
        return try insert(filename: filename) { destination in
            try fileManager.copyItem(at: templates.appendingPathComponent("Blank.\(ext)"), to: destination)
        }
    }

    private func insert(filename: String, writer: (URL) throws -> Void) throws -> OfficeDocument {
        guard !filename.isEmpty, filename != ".", filename != "..",
              !filename.contains("/"), !filename.hasPrefix(".") else { throw LibraryError.invalidFile }
        let id = UUID()
        let folder = directory.appendingPathComponent(id.uuidString, isDirectory: true)
        try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        do {
            try writer(folder.appendingPathComponent(filename))
            try reload()
            guard let document = documents.first(where: { $0.id == id }) else { throw LibraryError.missingDocument }
            return document
        } catch {
            try? fileManager.removeItem(at: folder)
            throw error
        }
    }

    func readText(_ document: OfficeDocument) throws -> String {
        guard document.kind.isTextEditable else { throw LibraryError.invalidText }
        if let draft = textDrafts[document.id] { return draft }
        let size = try document.url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= Self.maximumTextBytes else { throw LibraryError.textTooLarge }
        let data = try Data(contentsOf: document.url)
        guard let text = String(data: data, encoding: .utf8), !text.contains("\0") else { throw LibraryError.invalidText }
        return text
    }

    func saveText(_ text: String, document: OfficeDocument) throws {
        guard document.kind.isTextEditable else { throw LibraryError.invalidText }
        guard documents.contains(where: { $0.id == document.id && $0.url == document.url }) else { throw LibraryError.missingDocument }
        let data = Data(text.utf8)
        textDrafts[document.id] = text
        savingDocumentIDs.insert(document.id)
        pendingSaveActions[document.id] = { [self] in
            guard let latest = textDrafts[document.id] else { return }
            do { try saveText(latest, document: document) } catch { present(error) }
        }
        guard data.count <= Self.maximumTextBytes else { throw LibraryError.textTooLarge }
        try saveData(data, document: document)
        textDrafts.removeValue(forKey: document.id)
        savingDocumentIDs.remove(document.id)
        pendingSaveActions.removeValue(forKey: document.id)
    }

    func saveData(_ data: Data, document: OfficeDocument) throws {
        guard documents.contains(where: { $0.id == document.id && $0.url == document.url }),
              fileManager.fileExists(atPath: document.url.path) else { throw LibraryError.missingDocument }
        try data.write(to: document.url, options: .atomic)
        try reload()
    }

    func toggleFavorite(_ document: OfficeDocument) throws {
        var updated = favorites
        if updated.contains(document.id) { updated.remove(document.id) } else { updated.insert(document.id) }
        try JSONEncoder().encode(Array(updated)).write(to: favoritesURL, options: .atomic)
        favorites = updated
        try reload()
    }

    func delete(_ document: OfficeDocument) throws {
        guard !savingDocumentIDs.contains(document.id) else { throw LibraryError.pendingSave }
        guard documents.contains(where: { $0.id == document.id && $0.url == document.url }) else { throw LibraryError.missingDocument }
        try fileManager.removeItem(at: document.url.deletingLastPathComponent())
        try closeTab(document)
        try reload()
    }
}
