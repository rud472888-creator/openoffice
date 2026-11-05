import Foundation

enum EditorRoute: Equatable {
    case text
    case pdf
    case web(resource: String, kind: String)
    case preview

    static func route(for document: OfficeDocument) -> EditorRoute {
        route(forFilename: document.filename)
    }

    static func route(forFilename filename: String) -> EditorRoute {
        let name = filename.lowercased()
        let ext = URL(fileURLWithPath: filename).pathExtension.lowercased()
        if name.hasSuffix(".drawio.svg") || name.hasSuffix(".drawio.png") { return .web(resource: "FormatsEditor", kind: ext) }
        return route(forExtension: ext)
    }

    static func route(forExtension fileExtension: String) -> EditorRoute {
        let ext = fileExtension.lowercased()
        switch ext {
        case "md", "markdown", "txt", "text", "json": return .web(resource: "MarkdownEditor", kind: ext)
        case "doc", "docx", "odt": return .web(resource: "DocumentEditor", kind: ext)
        case "xlsx", "csv", "tsv", "xls", "ods": return .web(resource: "SpreadsheetEditor", kind: ext)
        case "pptx": return .web(resource: "PresentationEditor", kind: ext)
        case "hwp", "hwpx": return .web(resource: "HwpEditor", kind: ext)
        case "html", "htm", "xmind", "epub", "drawio", "dio": return .web(resource: "FormatsEditor", kind: ext)
        case "pdf": return .pdf
        default: return DocumentKind(extension: ext).isTextEditable ? .text : .preview
        }
    }
}
