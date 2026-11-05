import PDFKit

enum PDFPageEditing {
    static func apply(_ pages: [PDFPage], to document: PDFDocument) throws {
        guard !pages.isEmpty, Set(pages.map(ObjectIdentifier.init)).count == pages.count,
              pages.allSatisfy({ document.index(for: $0) != NSNotFound }) else { throw LibraryError.invalidFile }
        for index in (0..<document.pageCount).reversed() {
            if let page = document.page(at: index), !pages.contains(where: { $0 === page }) { document.removePage(at: index) }
        }
        for (index, page) in pages.enumerated() {
            let current = document.index(for: page)
            if current != index { document.removePage(at: current); document.insert(page, at: index) }
        }
    }
}
