import SwiftUI
import UniformTypeIdentifiers

struct LibraryView: View {
    @Bindable var library: DocumentLibrary
    @State private var section: LibrarySection? = .recent
    @State private var search = ""
    @State private var importing = false
    @State private var showingAbout = false
    @State private var pendingDeletion: OfficeDocument?
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var preferredCompactColumn: NavigationSplitViewColumn = .content

    private var filteredDocuments: [OfficeDocument] {
        library.documents.filter { document in
            (section != .favorites || document.isFavorite) &&
            (search.isEmpty || document.filename.localizedStandardContains(search))
        }
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility, preferredCompactColumn: $preferredCompactColumn) {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 10) {
                    Image(systemName: "square.stack.3d.up.fill")
                        .font(.title2).foregroundStyle(OfficeTheme.accent)
                    Text(verbatim: "every office").font(.title3.weight(.bold))
                }
                .padding(.horizontal, 20).padding(.top, 24)

                List(selection: $section) {
                    Label("Recent", systemImage: "clock").tag(LibrarySection.recent)
                    Label("Favorites", systemImage: "star").tag(LibrarySection.favorites)
                }
                .listStyle(.sidebar).scrollContentBackground(.hidden)

                VStack(alignment: .leading, spacing: 12) {
                    Button { importing = true } label: { Label("Import from Files", systemImage: "folder.badge.plus") }
                    Button { showingAbout = true } label: { Label("About", systemImage: "info.circle") }
                }
                .buttonStyle(.plain).foregroundStyle(OfficeTheme.secondary)
                .padding(20)
            }
            .background(OfficeTheme.surface)
            .navigationSplitViewColumnWidth(min: 220, ideal: 250, max: 320)
        } content: {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    if section != .favorites {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Your workspace, on iPad.").font(.largeTitle.weight(.bold))
                            Text("Create a note or bring your documents from Files.")
                                .foregroundStyle(OfficeTheme.secondary)
                        }
                        .padding(.top, 8)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                            NewDocumentCard(title: "New document", symbol: "doc.text", color: OfficeTheme.documentBlue, identifier: "newDocument") { createOffice("docx") }
                            NewDocumentCard(title: "New workbook", symbol: "tablecells", color: OfficeTheme.sheetGreen, identifier: "newWorkbook") { createOffice("xlsx") }
                            NewDocumentCard(title: "New presentation", symbol: "rectangle.on.rectangle", color: OfficeTheme.slideOrange, identifier: "newPresentation") { createOffice("pptx") }
                            NewDocumentCard(title: "New note", symbol: "doc.plaintext", color: OfficeTheme.documentBlue, identifier: "newNote") { create(markdown: false) }
                            NewDocumentCard(title: "New Markdown", symbol: "text.alignleft", color: OfficeTheme.ink, identifier: "newMarkdown") { create(markdown: true) }
                            NewDocumentCard(title: "Import", symbol: "folder", color: OfficeTheme.sheetGreen, identifier: "importCard") { importing = true }
                        }
                    }

                    HStack {
                        Text(LocalizedStringKey(section == .favorites ? "Favorites" : "Recent documents")).font(.title2.weight(.semibold))
                        Spacer()
                        Text(filteredDocuments.count, format: .number).foregroundStyle(OfficeTheme.secondary)
                    }

                    if filteredDocuments.isEmpty {
                        ContentUnavailableView(LocalizedStringKey(search.isEmpty ? "No documents yet" : "No matching documents"),
                            systemImage: search.isEmpty ? "doc" : "magnifyingglass",
                            description: Text("Import a file or create a note to get started."))
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 16)], spacing: 16) {
                            ForEach(filteredDocuments) { document in
                                Button { library.selectedID = document.id } label: {
                                    DocumentCard(document: document, selected: library.selectedID == document.id)
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("document-\(document.filename)")
                                .contextMenu {
                                    Button { perform { try library.toggleFavorite(document) } } label: {
                                        Label(LocalizedStringKey(document.isFavorite ? "Remove favorite" : "Add favorite"), systemImage: document.isFavorite ? "star.slash" : "star")
                                    }
                                    ShareLink(item: document.url)
                                        .disabled(library.savingDocumentIDs.contains(document.id))
                                    Button(role: .destructive) { pendingDeletion = document } label: { Label("Delete", systemImage: "trash") }
                                }
                            }
                        }
                    }
                }
                .padding(24)
            }
            .background(OfficeTheme.subtle)
            .accessibilityIdentifier("documentLibrary")
            .navigationTitle(LocalizedStringKey(section == .favorites ? "Favorites" : "Home"))
            .searchable(text: $search, prompt: "Search documents")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { importing = true } label: { Label("Import", systemImage: "square.and.arrow.down") }
                        .accessibilityIdentifier("importDocument")
                }
            }
            .navigationSplitViewColumnWidth(min: 320, ideal: 560)
        } detail: {
            if let document = library.selectedDocument {
                DocumentDetailView(library: library, document: document).id(document.id)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button { showLibrary() } label: { Label("Home", systemImage: "house") }
                                .accessibilityIdentifier("showLibrary")
                        }
                    }
            } else {
                ContentUnavailableView("Select a document", systemImage: "doc.text.magnifyingglass",
                    description: Text("Your files stay on this iPad unless you share them."))
                    .background(OfficeTheme.subtle)
            }
        }
        .navigationSplitViewStyle(.balanced)
        .onChange(of: library.selectedID, initial: true) { _, selectedID in
            preferredCompactColumn = selectedID == nil ? .content : .detail
            columnVisibility = selectedID == nil ? .all : .doubleColumn
        }
        .onChange(of: section) { _, _ in showLibrary() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            perform {
                for url in try result.get() { library.selectedID = try library.importDocument(from: url).id }
            }
        }
        .alert("Unable to complete", isPresented: Binding(get: { library.errorMessage != nil }, set: { if !$0 { library.errorMessage = nil } })) {
            Button("OK", role: .cancel) { library.errorMessage = nil }
            if !library.pendingSaveActions.isEmpty { Button("Retry save") { library.retryPendingSaves() } }
        } message: { Text(verbatim: library.errorMessage ?? "") }
        .confirmationDialog("Delete this local copy?", isPresented: Binding(get: { pendingDeletion != nil }, set: { if !$0 { pendingDeletion = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                if let document = pendingDeletion { perform { try library.delete(document) } }
                pendingDeletion = nil
            }
        } message: { Text("The file you imported from Files will stay unchanged.") }
        .sheet(isPresented: $showingAbout) { AboutView() }
        .foregroundStyle(OfficeTheme.ink)
    }

    private func create(markdown: Bool) {
        perform { library.selectedID = try library.create(markdown: markdown).id }
    }

    private func showLibrary() {
        library.selectedID = nil
        preferredCompactColumn = .content
        columnVisibility = .all
    }

    private func createOffice(_ ext: String) {
        perform { library.selectedID = try library.createOffice(extension: ext).id }
    }

    private func perform(_ action: () throws -> Void) {
        do { try action() } catch { library.present(error) }
    }
}

private enum LibrarySection: Hashable { case recent, favorites }

private struct NewDocumentCard: View {
    let title: LocalizedStringKey
    let symbol: String
    let color: Color
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: symbol).font(.title).foregroundStyle(color)
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(OfficeTheme.ink)
            }
            .frame(maxWidth: .infinity, minHeight: 90, alignment: .leading)
            .padding(16)
            .background(OfficeTheme.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(OfficeTheme.border))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }
}

private struct DocumentCard: View {
    let document: OfficeDocument
    let selected: Bool

    private var color: Color {
        switch document.kind {
        case .spreadsheet: OfficeTheme.sheetGreen
        case .presentation: OfficeTheme.slideOrange
        case .pdf: OfficeTheme.pdfRed
        default: OfficeTheme.documentBlue
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: document.kind.symbol).font(.system(size: 36, weight: .light)).foregroundStyle(color)
                Spacer()
                if document.isFavorite { Image(systemName: "star.fill").foregroundStyle(OfficeTheme.accent) }
            }
            .frame(height: 72)
            Text(verbatim: document.name).font(.subheadline.weight(.semibold)).lineLimit(2)
            HStack {
                Text(verbatim: document.url.pathExtension.uppercased()).font(.caption.weight(.medium))
                Spacer()
                Text(document.modifiedAt, style: .date).font(.caption)
            }
            .foregroundStyle(OfficeTheme.secondary)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? OfficeTheme.accentSoft : OfficeTheme.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? OfficeTheme.accent : OfficeTheme.border))
        .accessibilityElement(children: .combine)
    }
}
