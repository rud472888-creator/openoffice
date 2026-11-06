import SwiftUI

struct DocumentTabsView: View {
    let library: DocumentLibrary

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(library.openDocuments) { document in
                    let selected = document.id == library.selectedID
                    HStack(spacing: 0) {
                        Button { library.selectedID = document.id } label: {
                            HStack(spacing: 9) {
                                Image(systemName: document.kind.symbol)
                                    .foregroundStyle(OfficeTheme.color(for: document.kind))
                                Text(verbatim: document.filename).lineLimit(1)
                                if library.savingDocumentIDs.contains(document.id) {
                                    ProgressView().controlSize(.mini)
                                }
                            }
                            .padding(.leading, 14)
                            .frame(minWidth: 120, maxWidth: 210, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .accessibilityIdentifier("tab-\(document.filename)")
                        .accessibilityAddTraits(selected ? .isSelected : [])
                        Button {
                            do { try library.closeTab(document) } catch { library.present(error) }
                        } label: {
                            Image(systemName: "xmark").font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(OfficeTheme.secondary).frame(width: 44, height: 44)
                                .contentShape(Rectangle())
                        }
                        .accessibilityLabel("Close tab")
                        .accessibilityIdentifier("closeTab-\(document.filename)")
                        .disabled(library.savingDocumentIDs.contains(document.id))
                    }
                    .buttonStyle(.plain).font(.system(size: 13, weight: selected ? .semibold : .regular))
                    .foregroundStyle(selected ? OfficeTheme.ink : OfficeTheme.secondary)
                    .background(selected ? OfficeTheme.surface : .clear, in: RoundedRectangle(cornerRadius: 9))
                    .overlay(alignment: .bottom) {
                        if selected { Capsule().fill(OfficeTheme.accent).frame(height: 2).padding(.horizontal, 14) }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 6)
        }
        .scrollIndicators(.hidden)
        .background(OfficeTheme.sidebar)
        .accessibilityIdentifier("documentTabs")
    }
}
