import SwiftUI
import PDFKit
import Observation

struct PDFDocumentEditor: View {
    let library: DocumentLibrary
    let document: OfficeDocument
    @State private var state = PDFEditorState()

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
    func updateUIView(_ view: PDFView, context: Context) {}
}
