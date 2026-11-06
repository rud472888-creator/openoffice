import SwiftUI
import UniformTypeIdentifiers

struct DocumentDetailView: View {
    let library: DocumentLibrary
    let document: OfficeDocument
    @State private var exporting = false
    @State private var exportFile: ExportedDocument?
    @State private var renamingDocument: OfficeDocument?

    var body: some View {
        VStack(spacing: 0) {
            if library.openDocuments.count > 1 { DocumentTabsView(library: library) }
            switch EditorRoute.route(for: document) {
            case .text:
                TextDocumentEditor(library: library, document: document)
            case .web(let resource, let kind):
                WebDocumentEditor(library: library, document: document, resource: resource, kind: kind)
            case .pdf:
                PDFDocumentEditor(library: library, document: document)
            case .preview:
                DocumentPreview(document: document).id(document.url)
            }
        }
        .navigationTitle(document.filename)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(removing: .sidebarToggle)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Menu {
                    Button { renamingDocument = document } label: { Label("Rename", systemImage: "pencil") }
                    Button {
                        do { library.selectedID = try library.duplicate(document).id } catch { library.present(error) }
                    } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
                    ShareLink(item: document.url)
                    Button {
                        do { try library.closeTab(document) } catch { library.present(error) }
                    } label: { Label("Close tab", systemImage: "xmark") }
                } label: { Label("Document actions", systemImage: "ellipsis.circle") }
                .disabled(library.savingDocumentIDs.contains(document.id))
                .accessibilityIdentifier("documentActions")
                Button {
                    do { try library.toggleFavorite(document) } catch { library.present(error) }
                } label: {
                    Label("Favorite", systemImage: document.isFavorite ? "star.fill" : "star")
                }
                .accessibilityIdentifier("favoriteDocument")
                Button {
                    do {
                        exportFile = ExportedDocument(data: try Data(contentsOf: document.url))
                        exporting = true
                    } catch { library.present(error) }
                } label: { Label("Export a copy", systemImage: "square.and.arrow.up") }
                .disabled(library.savingDocumentIDs.contains(document.id))
            }
        }
        .fileExporter(isPresented: $exporting, document: exportFile, contentType: document.contentType,
            defaultFilename: document.filename) { result in
            if case .failure(let error) = result { library.present(error) }
        }
        .sheet(item: $renamingDocument) { document in RenameDocumentSheet(library: library, document: document) }
    }
}

struct ExportedDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.data] }
    let data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw LibraryError.invalidFile }
        self.data = data
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
