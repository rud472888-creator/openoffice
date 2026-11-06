import SwiftUI
import UniformTypeIdentifiers

struct DocumentDetailView: View {
    let library: DocumentLibrary
    let document: OfficeDocument
    @State private var sharing = false
    @State private var shareDismissed = false
    @State private var shareCommand: HWPShareCommand?
    private var isHWP: Bool { ["hwp", "hwpx"].contains(document.url.pathExtension.lowercased()) }
    @State private var renamingDocument: OfficeDocument?

    var body: some View {
        VStack(spacing: 0) {
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
                    Button {
                        do { try library.closeDocument(document) } catch { library.present(error) }
                    } label: { Label("Close document", systemImage: "xmark") }
                } label: { Label("Document actions", systemImage: "ellipsis.circle") }
                .disabled(library.savingDocumentIDs.contains(document.id))
                .accessibilityIdentifier("documentActions")
                Button {
                    do { try library.toggleFavorite(document) } catch { library.present(error) }
                } label: {
                    Label("Favorite", systemImage: document.isFavorite ? "star.fill" : "star")
                }
                .accessibilityIdentifier("favoriteDocument")
                Button { shareDismissed = false; sharing = true } label: { Label("Share", systemImage: "square.and.arrow.up") }
                .accessibilityIdentifier("shareDocument")
                .disabled(library.savingDocumentIDs.contains(document.id))
            }
        }
        .sheet(isPresented: $sharing, onDismiss: {
            shareDismissed = true
            finishShareIfReady()
        }) {
            DocumentShareSheet(url: document.url, commands: isHWP ? HWPShareCommand.allCases : []) { command in
                shareCommand = command
                sharing = false
                finishShareIfReady()
            }
        }
        .sheet(item: $renamingDocument) { document in RenameDocumentSheet(library: library, document: document) }
    }
    private func finishShareIfReady() {
        guard shareDismissed, let command = shareCommand else { return }
        shareCommand = nil
        if command == .saveAs {
            do { library.namedExport = try NamedDocumentExport(filename: document.filename, data: Data(contentsOf: document.url)) }
            catch { library.present(error) }
        } else {
            OfficeWebView.Coordinator.retained[document.id]?.performShareCommand(command)
        }
    }

}

enum HWPShareCommand: String, CaseIterable {
    case pdf, print, saveAs, convert
    var title: String {
        switch self {
        case .pdf: String(localized: "Export PDF")
        case .print: String(localized: "Print")
        case .saveAs: String(localized: "Save As…")
        case .convert: String(localized: "Export a copy")
        }
    }
    var symbol: String {
        switch self {
        case .pdf: "doc.richtext"
        case .print: "printer"
        case .saveAs: "doc.on.doc"
        case .convert: "arrow.triangle.2.circlepath"
        }
    }
}

private final class HWPActivity: UIActivity {
    let command: HWPShareCommand
    let selected: (HWPShareCommand) -> Void
    let sourceExtension: String
    init(_ command: HWPShareCommand, sourceExtension: String, selected: @escaping (HWPShareCommand) -> Void) {
        self.sourceExtension = sourceExtension
        self.command = command
        self.selected = selected
        super.init()
    }
    override var activityType: UIActivity.ActivityType? { .init("app.everyoffice." + command.rawValue) }
    override var activityTitle: String? {
        command == .convert ? command.title + " (" + (sourceExtension == "hwp" ? "HWPX" : "HWP") + ")" : command.title
    }
    override var activityImage: UIImage? { UIImage(systemName: command.symbol) }
    override func canPerform(withActivityItems items: [Any]) -> Bool { items.contains { $0 is URL } }
    override func perform() { selected(command); activityDidFinish(true) }
}

private struct DocumentShareSheet: UIViewControllerRepresentable {
    let url: URL
    let commands: [HWPShareCommand]
    let finished: (HWPShareCommand?) -> Void
    func makeUIViewController(context: Context) -> UIActivityViewController {
        var selected: HWPShareCommand?
        let activities = commands.map { HWPActivity($0, sourceExtension: url.pathExtension.lowercased()) { selected = $0 } }
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: activities)
        if !commands.isEmpty { controller.excludedActivityTypes = [.print] }
        controller.completionWithItemsHandler = { _, completed, _, _ in finished(completed ? selected : nil) }
        return controller
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

struct NamedDocumentExport: FileDocument {
    static var readableContentTypes: [UTType] { [.data] }
    let filename: String
    let data: Data
    var contentType: UTType { UTType(filenameExtension: (filename as NSString).pathExtension) ?? .data }
    init(filename: String, data: Data) { self.filename = filename; self.data = data }
    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw LibraryError.invalidFile }
        self.init(filename: configuration.file.preferredFilename ?? "", data: data)
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
