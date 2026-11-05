import SwiftUI

struct DocumentTabsView: View {
    let library: DocumentLibrary

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(library.openDocuments) { document in
                    HStack(spacing: 6) {
                        Button { library.selectedID = document.id } label: {
                            HStack(spacing: 8) {
                                Image(systemName: document.kind.symbol)
                                Text(verbatim: document.filename).lineLimit(1)
                                if library.savingDocumentIDs.contains(document.id) { ProgressView().controlSize(.mini) }
                            }
                            .frame(minWidth: 110, maxWidth: 200, alignment: .leading)
                        }
                        .accessibilityIdentifier("tab-\(document.filename)")
                        .accessibilityAddTraits(document.id == library.selectedID ? .isSelected : [])
                        Button {
                            do { try library.closeTab(document) } catch { library.present(error) }
                        } label: { Image(systemName: "xmark").font(.caption) }
                        .accessibilityLabel("Close tab")
                        .accessibilityIdentifier("closeTab-\(document.filename)")
                        .disabled(library.savingDocumentIDs.contains(document.id))
                    }
                    .buttonStyle(.plain).font(.subheadline)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(document.id == library.selectedID ? OfficeTheme.surface : OfficeTheme.subtle, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(OfficeTheme.border))
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        }
        .scrollIndicators(.hidden)
        .background(OfficeTheme.subtle)
        .accessibilityIdentifier("documentTabs")
    }
}
