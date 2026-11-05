import Foundation
import UniformTypeIdentifiers

enum DocumentKind: String, CaseIterable, Identifiable {
    case text, markdown, pdf, document, spreadsheet, presentation, other
    var id: Self { self }

    init(extension ext: String) {
        switch ext.lowercased() {
        case "txt", "text", "csv", "tsv", "json", "xml", "yaml", "yml": self = .text
        case "md", "markdown": self = .markdown
        case "pdf": self = .pdf
        case "doc", "docx", "odt", "rtf", "hwp", "hwpx": self = .document
        case "xls", "xlsx", "ods": self = .spreadsheet
        case "ppt", "pptx", "odp": self = .presentation
        default: self = .other
        }
    }

    var isTextEditable: Bool { self == .text || self == .markdown }

    var symbol: String {
        switch self {
        case .text: "doc.plaintext"
        case .markdown: "text.alignleft"
        case .pdf: "doc.richtext"
        case .document: "doc.text"
        case .spreadsheet: "tablecells"
        case .presentation: "rectangle.on.rectangle"
        case .other: "doc"
        }
    }
}

struct OfficeDocument: Identifiable, Hashable {
    let id: UUID
    let url: URL
    var modifiedAt: Date
    var byteCount: Int64
    var isFavorite: Bool

    var name: String { url.deletingPathExtension().lastPathComponent }
    var filename: String { url.lastPathComponent }
    var kind: DocumentKind { DocumentKind(extension: url.pathExtension) }
    var contentType: UTType { UTType(filenameExtension: url.pathExtension) ?? .data }
}

enum LibraryError: LocalizedError {
    case invalidFile, tooLarge, textTooLarge, invalidText, missingDocument, pendingSave, invalidName

    var errorDescription: String? {
        switch self {
        case .invalidFile: String(localized: "Choose a regular document file.")
        case .tooLarge: String(localized: "Choose a file smaller than 100 MB.")
        case .textTooLarge: String(localized: "Text editing supports files up to 10 MB.")
        case .invalidText: String(localized: "This file is not UTF-8 text. The original is unchanged.")
        case .missingDocument: String(localized: "This document could not be found.")
        case .pendingSave: String(localized: "Save this document before continuing.")
        case .invalidName: String(localized: "Choose a name without slashes or control characters.")
        }
    }
}
