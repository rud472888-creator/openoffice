import SwiftUI
import UniformTypeIdentifiers

struct DocumentDetailView: View {
    let library: DocumentLibrary
    let document: OfficeDocument
    @State private var exporting = false
    @State private var exportFile: ExportedDocument?

    var body: some View {
        Group {
            if document.kind.isTextEditable {
                TextDocumentEditor(library: library, document: document)
            } else if document.url.pathExtension.lowercased() == "docx" {
                WebDocumentEditor(library: library, document: document, resource: "DocumentEditor")
            } else if document.url.pathExtension.lowercased() == "xlsx" {
                WebDocumentEditor(library: library, document: document, resource: "SpreadsheetEditor")
            } else if document.url.pathExtension.lowercased() == "pptx" {
                WebDocumentEditor(library: library, document: document, resource: "PresentationEditor")
            } else if document.kind == .pdf {
                PDFDocumentEditor(library: library, document: document)
            } else {
                DocumentPreview(document: document)
            }
        }
        .navigationTitle(document.filename)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    do { try library.toggleFavorite(document) } catch { library.present(error) }
                } label: {
                    Label("Favorite", systemImage: document.isFavorite ? "star.fill" : "star")
                }
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
