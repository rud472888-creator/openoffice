import SwiftUI
import UniformTypeIdentifiers

struct LibraryView: View {
    @Bindable var library: DocumentLibrary
    @State private var section: LibrarySection = .all
    @State private var search = ""
    @State private var importing = false
    @State private var showingAbout = false
    @State private var pendingDeletion: OfficeDocument?
    @State private var renamingDocument: OfficeDocument?
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var preferredCompactColumn: NavigationSplitViewColumn = .detail
    @AppStorage("libraryUsesGrid") private var usesGrid = true

    private var filteredDocuments: [OfficeDocument] {
        library.documents.filter { document in
            (section != .favorites || document.isFavorite) &&
            (search.isEmpty || document.filename.localizedStandardContains(search))
        }
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility, preferredCompactColumn: $preferredCompactColumn) {
            sidebar
                .navigationBarTitleDisplayMode(.inline)
                .navigationSplitViewColumnWidth(min: 210, ideal: 232, max: 260)
        } detail: {
            if let document = library.selectedDocument {
                DocumentDetailView(library: library, document: document).id(document.id)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button { showLibrary() } label: { Label("Home", systemImage: "square.grid.2x2") }
                                .accessibilityIdentifier("showLibrary")
                        }
                    }
            } else {
                workspace
                    .navigationTitle("")
                    .navigationBarTitleDisplayMode(.inline)

            }
        }
        .navigationSplitViewStyle(.balanced)
        .onChange(of: library.selectedID, initial: true) { _, selectedID in
            preferredCompactColumn = .detail
            columnVisibility = selectedID == nil ? .all : .detailOnly
        }
        .onChange(of: section) { _, _ in showLibrary() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            perform {
                for url in try result.get() { library.selectedID = try library.importDocument(from: url).id }
            }
        }
        .fileExporter(isPresented: Binding(get: { library.namedExport != nil }, set: { if !$0 { library.namedExport = nil } }),
                      document: library.namedExport, contentType: library.namedExport?.contentType ?? .data,
                      defaultFilename: library.namedExport?.filename) { result in
            if case .failure(let error) = result { library.present(error) }
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
        .sheet(item: $renamingDocument) { document in RenameDocumentSheet(library: library, document: document) }
        .sheet(item: Binding(get: { library.generatedPDF }, set: { value in
            if value == nil { library.generatedFileCompletion?(false); library.generatedFileCompletion = nil }
            library.generatedPDF = value
        })) { presentation in
            GeneratedPDFPresenter(presentation: presentation) { completed in
                library.generatedFileCompletion?(completed)
                library.generatedFileCompletion = nil
                library.generatedPDF = nil
            }
        }
        .overlay(alignment: .bottom) {
            if library.preparingPDF { ProgressView("Preparing PDF…").padding().background(.regularMaterial, in: Capsule()).padding() }
        }
        .foregroundStyle(OfficeTheme.ink)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(verbatim: "EVERY OFFICE")
                .font(.system(size: 25, weight: .semibold, design: .rounded))
                .tracking(-1).padding(.horizontal, 24).padding(.top, 34).padding(.bottom, 36)

            VStack(spacing: 6) {
                sidebarItem("All documents", symbol: "square.grid.2x2", destination: .all,
                            count: library.documents.count)
                sidebarItem("Favorites", symbol: "star", destination: .favorites,
                            count: library.documents.filter(\.isFavorite).count)
            }
            .padding(.horizontal, 12)

            VStack(alignment: .leading, spacing: 4) {
                Text("Recent documents")
                    .font(.caption.weight(.semibold)).foregroundStyle(OfficeTheme.secondary)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.horizontal, 26).padding(.top, 22)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(library.recentDocuments) { document in
                            Button { library.selectedID = document.id } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: document.kind.symbol).frame(width: 20)
                                        .foregroundStyle(OfficeTheme.secondary)
                                    Text(verbatim: document.filename).lineLimit(1).truncationMode(.middle)
                                }
                                .font(.subheadline)
                                .padding(.horizontal, 14)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("sidebarRecent-\(document.filename)")
                        }
                    }
                    .padding(.horizontal, 12)
                }
                .accessibilityIdentifier("sidebarRecents")
            }
            VStack(alignment: .leading, spacing: 8) {
                Button { importing = true } label: {
                    Label("Import from Files", systemImage: "folder.badge.plus")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                Button { showingAbout = true } label: {
                    Label("About", systemImage: "info.circle")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                Divider().overlay(OfficeTheme.border).padding(.vertical, 8)
                Label("On this iPad", systemImage: "internaldrive")
                    .font(.caption).padding(.bottom, 4)
            }
            .font(.subheadline).foregroundStyle(OfficeTheme.secondary)
            .buttonStyle(.plain).padding(24)
        }
        .background(OfficeTheme.sidebar)
    }

    private func sidebarItem(_ title: LocalizedStringKey, symbol: String, destination: LibrarySection, count: Int) -> some View {
        Button { section = destination; showLibrary() } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol).font(.system(size: 17, weight: .medium)).frame(width: 22)
                Text(title).font(.subheadline.weight(section == destination ? .semibold : .medium))
                Spacer(minLength: 4)
                Text(count, format: .number).font(.caption.monospacedDigit())
                    .foregroundStyle(OfficeTheme.secondary)
            }
            .padding(.horizontal, 14).frame(minHeight: 48)
            .foregroundStyle(section == destination ? OfficeTheme.accent : OfficeTheme.ink)
            .background(section == destination ? OfficeTheme.surface : .clear, in: RoundedRectangle(cornerRadius: 10))
            .contentShape(Rectangle())
        }
        .buttonStyle(OfficePressStyle())
        .accessibilityIdentifier("librarySection-\(destination.rawValue)")
        .accessibilityAddTraits(section == destination ? .isSelected : [])
    }

    private var workspace: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 36) {
                    workspaceHeader(wide: geometry.size.width > 740)
                    if section == .all && search.isEmpty { creationShelf }
                    documentsSection
                }
                .frame(maxWidth: 1180, alignment: .leading)
                .padding(.horizontal, geometry.size.width > 900 ? 48 : 24)
                .padding(.top, 24).padding(.bottom, 48)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .accessibilityIdentifier("documentLibrary")
            .background(OfficeTheme.subtle)
        }
    }

    @ViewBuilder
    private func workspaceHeader(wide: Bool) -> some View {
        if wide {
            HStack(alignment: .center, spacing: 32) {
                workspaceTitle
                Spacer(minLength: 16)
                searchField.frame(width: 300)
            }
        } else {
            VStack(alignment: .leading, spacing: 20) {
                workspaceTitle
                searchField
            }
        }
    }

    private var workspaceTitle: some View {
        Text(LocalizedStringKey(section == .favorites ? "Favorites" : "Documents"))
            .font(.largeTitle.weight(.semibold)).tracking(-0.8)
            .foregroundStyle(OfficeTheme.ink)
            .accessibilityAddTraits(.isHeader)
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(OfficeTheme.secondary)
            TextField("Search documents", text: $search)
                .font(.subheadline).autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .frame(minHeight: 44)
                .accessibilityIdentifier("documentSearch")
            if !search.isEmpty {
                Button { search = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }
                    .foregroundStyle(OfficeTheme.secondary)
                    .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 14).frame(minHeight: 48)
        .background(OfficeTheme.well, in: RoundedRectangle(cornerRadius: 12))
    }

    private var creationShelf: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Create new").font(.subheadline.weight(.semibold)).foregroundStyle(OfficeTheme.secondary)
                Spacer()
                Menu {
                    ForEach(additionalTemplates.filter { $0.ext != "hwp" }) { template in
                        Button { createOffice(template.ext) } label: { Label(template.title, systemImage: template.symbol) }
                            .accessibilityIdentifier(template.identifier)
                    }
                } label: {
                    Label("More formats", systemImage: "plus")
                        .font(.subheadline.weight(.medium)).frame(minHeight: 44)
                }
                .accessibilityIdentifier("moreFormats")
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 148), spacing: 12)], spacing: 12) {
                NewDocumentCard(title: "New document", symbol: "doc.text", format: "DOCX", color: OfficeTheme.documentBlue, identifier: "newDocument") { createOffice("docx") }
                NewDocumentCard(title: "New workbook", symbol: "tablecells", format: "XLSX", color: OfficeTheme.sheetGreen, identifier: "newWorkbook") { createOffice("xlsx") }
                NewDocumentCard(title: "New presentation", symbol: "rectangle.on.rectangle", format: "PPTX", color: OfficeTheme.slideOrange, identifier: "newPresentation") { createOffice("pptx") }
                NewDocumentCard(title: "New HWP", symbol: "doc.text", format: "HWP", color: OfficeTheme.documentBlue, identifier: "newHwp") { createOffice("hwp") }
                NewDocumentCard(title: "New note", symbol: "doc.plaintext", format: "TXT", color: OfficeTheme.secondary, identifier: "newNote") { create(markdown: false) }
                NewDocumentCard(title: "New Markdown", symbol: "text.alignleft", format: "MD", color: OfficeTheme.secondary, identifier: "newMarkdown") { create(markdown: true) }
            }
        }
    }

    private var documentsSection: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 10) {
                Text(LocalizedStringKey(section == .all ? "All documents" : "Documents"))
                    .font(.title3.weight(.semibold))
                Text(filteredDocuments.count, format: .number)
                    .font(.caption.monospacedDigit()).foregroundStyle(OfficeTheme.secondary)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(OfficeTheme.well, in: Capsule())
                Spacer()
                HStack(spacing: 2) {
                    layoutButton(grid: true)
                    layoutButton(grid: false)
                }
                .padding(3).background(OfficeTheme.well, in: RoundedRectangle(cornerRadius: 10))
            }
            if filteredDocuments.isEmpty {
                LibraryEmptyState(searching: !search.isEmpty, favorites: section == .favorites)
            } else if usesGrid {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 215, maximum: 320), spacing: 20)], spacing: 20) {
                    ForEach(filteredDocuments) { document in documentButton(document, compact: false) }
                }
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(filteredDocuments) { document in
                        documentButton(document, compact: true)
                        if document.id != filteredDocuments.last?.id { Divider().padding(.leading, 76) }
                    }
                }
                .background(OfficeTheme.surface, in: RoundedRectangle(cornerRadius: 16))
            }
        }
    }

    private func layoutButton(grid: Bool) -> some View {
        Button { usesGrid = grid } label: {
            Image(systemName: grid ? "square.grid.2x2" : "list.bullet")
                .font(.system(size: 16, weight: .medium)).frame(width: 44, height: 44)
                .foregroundStyle(usesGrid == grid ? OfficeTheme.ink : OfficeTheme.secondary)
                .background(usesGrid == grid ? OfficeTheme.surface : .clear, in: RoundedRectangle(cornerRadius: 7))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(LocalizedStringKey(grid ? "Grid view" : "List view"))
        .accessibilityIdentifier(grid ? "libraryGridView" : "libraryListView")
        .accessibilityAddTraits(usesGrid == grid ? .isSelected : [])
    }

    private func documentButton(_ document: OfficeDocument, compact: Bool) -> some View {
        Button { library.selectedID = document.id } label: {
            DocumentCard(document: document, compact: compact)
        }
        .buttonStyle(OfficePressStyle())
        .accessibilityIdentifier("document-\(document.filename)")
        .contextMenu {
            Button { renamingDocument = document } label: { Label("Rename", systemImage: "pencil") }
                .disabled(library.savingDocumentIDs.contains(document.id))
            Button { perform { library.selectedID = try library.duplicate(document).id } } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
                .disabled(library.savingDocumentIDs.contains(document.id))
            Button { perform { try library.toggleFavorite(document) } } label: {
                Label(LocalizedStringKey(document.isFavorite ? "Remove favorite" : "Add favorite"), systemImage: document.isFavorite ? "star.slash" : "star")
            }
            ShareLink(item: document.url).disabled(library.savingDocumentIDs.contains(document.id))
            Button(role: .destructive) { pendingDeletion = document } label: { Label("Delete", systemImage: "trash") }
        }
    }

    private func create(markdown: Bool) {
        perform { library.selectedID = try library.create(markdown: markdown).id }
    }

    private var additionalTemplates: [AdditionalTemplate] {
        let candidates = [
            AdditionalTemplate(ext: "hwp", title: "New HWP", symbol: "doc.text", identifier: "newHwp"),
            AdditionalTemplate(ext: "html", title: "New HTML", symbol: "chevron.left.forwardslash.chevron.right", identifier: "newHtml"),
            AdditionalTemplate(ext: "xmind", title: "New mind map", symbol: "point.3.connected.trianglepath.dotted", identifier: "newMindMap"),
            AdditionalTemplate(ext: "drawio", title: "New diagram", symbol: "square.on.square.dashed", identifier: "newDiagram"),
            AdditionalTemplate(ext: "epub", title: "New EPUB", symbol: "book", identifier: "newEpub")
        ]
        return candidates.filter { template in
            Bundle.main.resourceURL.map { FileManager.default.fileExists(atPath: $0.appendingPathComponent("Templates/Blank.\(template.ext)").path) } == true
        }
    }

    private func showLibrary() {
        library.selectedID = nil
        preferredCompactColumn = .detail
        columnVisibility = .all
    }

    private func createOffice(_ ext: String) {
        perform { library.selectedID = try library.createOffice(extension: ext).id }
    }

    private func perform(_ action: () throws -> Void) {
        do { try action() } catch { library.present(error) }
    }
}

private enum LibrarySection: String { case all, favorites }

private struct AdditionalTemplate: Identifiable {
    let ext: String
    let title: LocalizedStringKey
    let symbol: String
    let identifier: String
    var id: String { ext }
}
