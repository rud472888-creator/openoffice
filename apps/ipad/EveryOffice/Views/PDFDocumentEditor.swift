import SwiftUI
import PDFKit
import Observation

struct PDFDocumentEditor: View {
    let library: DocumentLibrary
    let document: OfficeDocument
    @State private var state = PDFEditorState()
    @State private var drawingPage: PDFPage?
    @State private var tools: PDFToolsRequest?

    var body: some View {
        VStack(spacing: 0) {
            if let pdf = state.document {
                PDFCanvas(document: pdf, state: state)
                Text("Select text, then tap Highlight to mark it.")
                    .font(.caption).foregroundStyle(OfficeTheme.secondary)
                    .padding(12).frame(maxWidth: .infinity).background(OfficeTheme.subtle)
            } else {
                ContentUnavailableView("Unable to open", systemImage: "lock.doc",
                    description: Text("This PDF may be encrypted or damaged."))
            }
        }
        .task {
            if let pdf = PDFDocument(url: document.url), !pdf.isLocked { state.document = pdf }
        }
        .toolbar {
            ToolbarItem(placement: .secondaryAction) {
                Menu {
                    Button("Pages") {
                        if let data = state.document?.dataRepresentation(), let working = PDFDocument(data: data) { tools = PDFToolsRequest(kind: .pages, pdf: working, page: nil) }
                    }
                    .disabled(state.document?.allowsDocumentAssembly != true)
                    Button("Search") { if let pdf = state.document { tools = PDFToolsRequest(kind: .search, pdf: pdf, page: nil) } }
                    Button("Add note") {
                        if let pdf = state.document, let page = state.view?.currentPage ?? pdf.page(at: 0) { tools = PDFToolsRequest(kind: .note, pdf: pdf, page: page) }
                    }
                    .disabled(state.document?.allowsCommenting != true)
                    Button("Save") {
                        do {
                            guard let data = state.document?.dataRepresentation() else { throw LibraryError.invalidFile }
                            try library.saveData(data, document: document)
                        } catch { library.present(error) }
                    }
                    .disabled(state.document?.allowsFormFieldEntry != true && state.document?.allowsCommenting != true)
                } label: { Label("PDF tools", systemImage: "slider.horizontal.3") }
                .disabled(state.document == nil)
            }
            ToolbarItem(placement: .secondaryAction) {
                Button { drawingPage = state.view?.currentPage ?? state.document?.page(at: 0) } label: {
                    Label("Draw", systemImage: "pencil.tip.crop.circle")
                }
                .disabled(state.document?.allowsCommenting != true)
            }
            ToolbarItem(placement: .secondaryAction) { PrintDocumentButton(document: document).disabled(state.document?.allowsPrinting != true) }
            ToolbarItem(placement: .secondaryAction) {
                Button {
                    guard let pdf = state.document, pdf.allowsCommenting,
                          let view = state.view, let selection = view.currentSelection else { return }
                    var additions: [(PDFPage, PDFAnnotation)] = []
                    for line in selection.selectionsByLine() {
                        for page in line.pages {
                            let bounds = line.bounds(for: page)
                            guard !bounds.isEmpty else { continue }
                            let annotation = PDFAnnotation(bounds: bounds, forType: .highlight, withProperties: nil)
                            annotation.color = UIColor.systemYellow.withAlphaComponent(0.45)
                            page.addAnnotation(annotation)
                            additions.append((page, annotation))
                        }
                    }
                    do {
                        guard let data = pdf.dataRepresentation() else { throw LibraryError.invalidFile }
                        try library.saveData(data, document: document)
                        view.clearSelection()
                    } catch {
                        for (page, annotation) in additions { page.removeAnnotation(annotation) }
                        library.present(error)
                    }
                } label: { Label("Highlight", systemImage: "highlighter") }
                .disabled(state.document?.allowsCommenting != true)
            }
        }
        .sheet(isPresented: Binding(get: { drawingPage != nil }, set: { if !$0 { drawingPage = nil } })) {
            if let page = drawingPage, let pdf = state.document {
                PDFDrawingSheet(library: library, document: document, pdf: pdf, page: page)
            }
        }
        .sheet(item: $tools) { request in
            switch request.kind {
            case .pages:
                PDFPageManagerSheet(library: library, document: document, working: request.pdf) { state.document = $0 }
            case .search:
                PDFSearchSheet(pdf: request.pdf) { selection in
                    state.view?.currentSelection = selection
                    state.view?.highlightedSelections = [selection]
                    state.view?.go(to: selection)
                }
            case .note:
                if let page = request.page { PDFTextNoteSheet(library: library, document: document, pdf: request.pdf, page: page) }
            }
        }
    }
}

@Observable
private final class PDFEditorState {
    var document: PDFDocument?
    weak var view: PDFView?
}

private struct PDFCanvas: UIViewRepresentable {
    let document: PDFDocument
    let state: PDFEditorState

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.document = document
        state.view = view
        return view
    }
    func updateUIView(_ view: PDFView, context: Context) { if view.document !== document { view.document = document } }
}

private struct PDFToolsRequest: Identifiable {
    enum Kind { case pages, search, note }
    let id = UUID()
    let kind: Kind
    let pdf: PDFDocument
    let page: PDFPage?
}
