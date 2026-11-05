import SwiftUI
import PDFKit

struct PDFPageManagerSheet: View {
    let library: DocumentLibrary
    let document: OfficeDocument
    let working: PDFDocument
    let onSaved: (PDFDocument) -> Void
    @State private var pages: [PDFPage]
    @State private var revision = 0
    @State private var errorMessage: String?
    @Environment(\.dismiss) private var dismiss

    init(library: DocumentLibrary, document: OfficeDocument, working: PDFDocument, onSaved: @escaping (PDFDocument) -> Void) {
        self.library = library
        self.document = document
        self.working = working
        self.onSaved = onSaved
        _pages = State(initialValue: (0..<working.pageCount).compactMap { working.page(at: $0) })
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(pages.indices, id: \.self) { index in
                    HStack {
                        Image(uiImage: pages[index].thumbnail(of: CGSize(width: 60, height: 80), for: .cropBox))
                            .resizable().scaledToFit().frame(width: 60, height: 80)
                        Text(index + 1, format: .number)
                        Spacer()
                        Button { pages[index].rotation = (pages[index].rotation + 90) % 360; revision += 1 } label: {
                            Label("Rotate", systemImage: "rotate.right")
                        }
                        .buttonStyle(.borderless)
                    }
                    .id("\(index)-\(revision)")
                }
                .onMove { pages.move(fromOffsets: $0, toOffset: $1) }
                .onDelete { indices in if pages.count > indices.count { pages.remove(atOffsets: indices) } }
                if let errorMessage { Text(verbatim: errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("Pages")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .secondaryAction) { EditButton() }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() } }
            }
            .interactiveDismissDisabled()
        }
    }

    private func save() {
        do {
            try PDFPageEditing.apply(pages, to: working)
            guard !pages.isEmpty, let data = working.dataRepresentation() else { throw LibraryError.invalidFile }
            try library.saveData(data, document: document)
            onSaved(working)
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}

struct PDFSearchSheet: View {
    let pdf: PDFDocument
    let onSelect: (PDFSelection) -> Void
    @State private var query = ""
    @State private var matches: [PDFSelection] = []
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(Array(matches.enumerated()), id: \.offset) { _, match in
                Button {
                    onSelect(match)
                    dismiss()
                } label: { Text(verbatim: match.string ?? "").lineLimit(3) }
            }
            .searchable(text: $query, prompt: "Search")
            .onSubmit(of: .search) { matches = query.isEmpty ? [] : pdf.findString(query, withOptions: .caseInsensitive) }
            .navigationTitle("Search")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct PDFTextNoteSheet: View {
    let library: DocumentLibrary
    let document: OfficeDocument
    let pdf: PDFDocument
    let page: PDFPage
    @State private var text = ""
    @State private var errorMessage: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack {
                TextEditor(text: $text).padding().accessibilityLabel("Text")
                if let errorMessage { Text(verbatim: errorMessage).foregroundStyle(.red).padding() }
            }
            .navigationTitle("Add note")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() }.disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            }
            .interactiveDismissDisabled(!text.isEmpty)
        }
    }

    private func save() {
        let bounds = page.bounds(for: .cropBox)
        let margin = min(36, min(bounds.width, bounds.height) * 0.1)
        let width = max(1, min(240, bounds.width - margin * 2))
        let height = max(1, min(72, bounds.height - margin * 2))
        let annotation = PDFAnnotation(bounds: CGRect(x: bounds.minX + margin, y: bounds.maxY - margin - height, width: width, height: height), forType: .freeText, withProperties: nil)
        annotation.contents = text
        annotation.font = .systemFont(ofSize: 14)
        annotation.fontColor = .black
        annotation.color = .clear
        page.addAnnotation(annotation)
        do {
            guard let data = pdf.dataRepresentation() else { throw LibraryError.invalidFile }
            try library.saveData(data, document: document)
            dismiss()
        } catch { page.removeAnnotation(annotation); errorMessage = error.localizedDescription }
    }
}
