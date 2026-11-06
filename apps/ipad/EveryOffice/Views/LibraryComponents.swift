import SwiftUI
import QuickLookThumbnailing

struct NewDocumentCard: View {
    let title: LocalizedStringKey
    let symbol: String
    let format: String
    let color: Color
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: symbol).font(.system(size: 20, weight: .regular))
                        .foregroundStyle(color)
                    Spacer()
                    Text(verbatim: format).font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .tracking(0.6).foregroundStyle(OfficeTheme.secondary)
                }
                Text(title).font(.subheadline.weight(.medium)).lineLimit(2, reservesSpace: true)
                    .foregroundStyle(OfficeTheme.ink).frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(16).frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
            .background(OfficeTheme.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(OfficeTheme.border.opacity(0.65), lineWidth: 0.5))
        }
        .buttonStyle(OfficePressStyle())
        .accessibilityIdentifier(identifier)
        .accessibilityLabel(title)
    }
}

struct DocumentCard: View {
    let document: OfficeDocument
    var compact = false

    var body: some View {
        Group {
            if compact { row } else { tile }
        }
        .foregroundStyle(OfficeTheme.ink)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var tile: some View {
        VStack(alignment: .leading, spacing: 0) {
            DocumentArtwork(document: document)
                .frame(height: 154).clipped()
                .overlay(alignment: .topTrailing) {
                    if document.isFavorite {
                        Image(systemName: "star.fill").font(.caption)
                            .foregroundStyle(OfficeTheme.accent).padding(10)
                            .background(OfficeTheme.surface, in: Circle()).padding(10)
                    }
                }
            VStack(alignment: .leading, spacing: 9) {
                Text(verbatim: document.name).font(.subheadline.weight(.semibold))
                    .lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 8) {
                    Text(verbatim: document.url.pathExtension.uppercased()).font(.caption2.weight(.semibold))
                        .foregroundStyle(OfficeTheme.color(for: document.kind))
                    Spacer(minLength: 4)
                    Text(document.modifiedAt, style: .date).font(.caption2)
                        .foregroundStyle(OfficeTheme.secondary)
                }
            }
            .padding(16)
        }
        .background(OfficeTheme.surface, in: RoundedRectangle(cornerRadius: 16))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(OfficeTheme.border.opacity(0.6), lineWidth: 0.5))
    }

    private var row: some View {
        HStack(spacing: 16) {
            Image(systemName: document.kind.symbol).font(.system(size: 23, weight: .regular))
                .foregroundStyle(OfficeTheme.color(for: document.kind))
                .frame(width: 44, height: 48).background(OfficeTheme.well, in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 5) {
                Text(verbatim: document.filename).font(.subheadline.weight(.medium)).lineLimit(1)
                Text(document.modifiedAt, style: .date).font(.caption).foregroundStyle(OfficeTheme.secondary)
            }
            Spacer(minLength: 8)
            if document.isFavorite { Image(systemName: "star.fill").font(.caption).foregroundStyle(OfficeTheme.accent) }
            Text(ByteCountFormatter.string(fromByteCount: document.byteCount, countStyle: .file))
                .font(.caption).foregroundStyle(OfficeTheme.secondary)
        }
        .padding(16)
    }
}

// Only real file content is shown as a preview. Unsupported formats use their file glyph.
private struct DocumentArtwork: View {
    let document: OfficeDocument
    @State private var thumbnail: UIImage?
    @State private var excerpt: String?

    var body: some View {
        ZStack {
            OfficeTheme.well
            if let thumbnail {
                Image(uiImage: thumbnail).resizable().scaledToFit().padding(16)
            } else if let excerpt, !excerpt.isEmpty {
                Text(verbatim: excerpt)
                    .font(.system(size: 12, design: .monospaced)).lineSpacing(5)
                    .foregroundStyle(OfficeTheme.previewInk).lineLimit(6)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(22).background(OfficeTheme.previewPaper)
                    .padding(.horizontal, 22).padding(.top, 18)
            } else {
                Image(systemName: document.kind.symbol)
                    .font(.system(size: 46, weight: .ultraLight))
                    .foregroundStyle(OfficeTheme.color(for: document.kind))
            }
        }
        .accessibilityHidden(true)
        .task(id: "\(document.id)-\(document.modifiedAt.timeIntervalSince1970)") {
            thumbnail = nil
            excerpt = nil
            if ["txt", "md", "markdown", "json"].contains(document.url.pathExtension.lowercased()) {
                if let handle = try? FileHandle(forReadingFrom: document.url) {
                    defer { try? handle.close() }
                    if let bytes = try? handle.read(upToCount: 512) {
                        excerpt = String(decoding: bytes, as: UTF8.self)
                    }
                }
                return
            }
            let request = QLThumbnailGenerator.Request(fileAt: document.url,
                size: CGSize(width: 300, height: 180), scale: 2, representationTypes: .thumbnail)
            let result: UIImage? = await withTaskCancellationHandler {
                await withCheckedContinuation { continuation in
                    QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { representation, _ in
                        continuation.resume(returning: representation?.uiImage)
                    }
                }
            } onCancel: {
                QLThumbnailGenerator.shared.cancel(request)
            }
            if !Task.isCancelled { thumbnail = result }
        }
    }
}

struct LibraryEmptyState: View {
    let searching: Bool
    let favorites: Bool

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: searching ? "magnifyingglass" : favorites ? "star" : "doc.text")
                .font(.system(size: 30, weight: .light)).foregroundStyle(OfficeTheme.secondary)
                .frame(width: 72, height: 72)
                .background(OfficeTheme.well, in: RoundedRectangle(cornerRadius: 20))
            VStack(spacing: 8) {
                Text(LocalizedStringKey(searching ? "No matching documents" : "No documents yet"))
                    .font(.headline)
                Text("Import a file or create a note to get started.")
                    .font(.subheadline).foregroundStyle(OfficeTheme.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 60).padding(.horizontal, 20)
    }
}
