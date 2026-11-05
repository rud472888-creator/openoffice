import SwiftUI

struct TextDocumentEditor: View {
    let library: DocumentLibrary
    let document: OfficeDocument
    @State private var text = ""
    @State private var loaded = false
    @State private var preview = false
    @State private var loadError: String?
    @State private var lastSavedText = ""
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 0) {
            if let loadError {
                ContentUnavailableView("Unable to open", systemImage: "exclamationmark.triangle", description: Text(verbatim: loadError))
            } else if loaded {
                if preview {
                    ScrollView {
                        Text(markdownPreview).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(32)
                    }
                    .background(OfficeTheme.surface)
                } else {
                    TextEditor(text: $text)
                        .font(.system(.body, design: .monospaced))
                        .scrollContentBackground(.hidden)
                        .padding(16).background(OfficeTheme.surface)
                        .accessibilityIdentifier("documentTextEditor")
                }
                HStack {
                    Text(LocalizedStringKey(library.textDrafts[document.id] != nil ? "Save failed" : "Saved on this iPad"))
                    Spacer()
                    Text(document.url.pathExtension.uppercased()).textCase(.uppercase)
                }
                .font(.caption).foregroundStyle(OfficeTheme.secondary)
                .padding(12).background(OfficeTheme.subtle)
            } else { ProgressView() }
        }
        .task {
            do { text = try library.readText(document); lastSavedText = text; loaded = true }
            catch { loadError = error.localizedDescription }
        }
        .onChange(of: text) { _, _ in if loaded, text != lastSavedText { save() } }
        .onChange(of: scenePhase) { _, phase in if phase != .active, loaded { save() } }
        .toolbar {
            if loaded, document.kind == .markdown {
                ToolbarItem(placement: .secondaryAction) {
                    Button { preview.toggle() } label: {
                        Label(LocalizedStringKey(preview ? "Edit" : "Preview"), systemImage: preview ? "pencil" : "eye")
                    }
                }
            }
            if library.textDrafts[document.id] != nil {
                ToolbarItem(placement: .secondaryAction) { Button("Retry save") { save() } }
            }
        }
    }

    private var markdownPreview: AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }

    private func save() {
        do { try library.saveText(text, document: document); lastSavedText = text }
        catch { library.present(error) }
    }
}
