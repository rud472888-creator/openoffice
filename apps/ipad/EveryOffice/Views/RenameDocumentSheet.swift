import SwiftUI

struct RenameDocumentSheet: View {
    let library: DocumentLibrary
    let document: OfficeDocument
    @State private var name: String
    @State private var errorMessage: String?
    @Environment(\.dismiss) private var dismiss

    init(library: DocumentLibrary, document: OfficeDocument) {
        self.library = library
        self.document = document
        _name = State(initialValue: document.name)
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityIdentifier("documentName")
                Text(verbatim: document.url.pathExtension.uppercased()).foregroundStyle(OfficeTheme.secondary)
                if let errorMessage { Text(verbatim: errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("Rename")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        do { try library.rename(document, to: name); dismiss() }
                        catch { errorMessage = error.localizedDescription }
                    }
                    .accessibilityIdentifier("saveDocumentName")
                }
            }
        }
        .presentationDetents([.medium])
    }
}
