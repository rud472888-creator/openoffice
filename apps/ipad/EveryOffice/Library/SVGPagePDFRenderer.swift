import Foundation
import PDFKit
import WebKit
import UIKit

struct SVGPrintPage {
    let markup: String
    let isHTML: Bool
    let paginate: Bool
    let width: Double
    let height: Double

    init(message: [String: Any]) throws {
        let svg = message["svg"] as? String
        let html = message["html"] as? String
        guard (svg == nil) != (html == nil), let markup = svg ?? html, markup.utf8.count <= 20 * 1_024 * 1_024,
              let width = message["width"] as? Double, width.isFinite, width > 0, width <= 4_000,
              let height = message["height"] as? Double, height.isFinite, height > 0, height <= 4_000,
              (svg != nil ? Self.isSafeSVG(markup) : Self.isSafeHTML(markup)),
              message["paginate"] as? Bool != true || html != nil else { throw PDFRenderError.invalidPages }
        self.markup = markup
        self.isHTML = html != nil
        self.paginate = message["paginate"] as? Bool ?? false
        self.width = width
        self.height = height
    }

    static func pages(from message: [String: Any]) throws -> [SVGPrintPage] {
        guard let values = message["pages"] as? [[String: Any]], !values.isEmpty, values.count <= 250 else { throw PDFRenderError.invalidPages }
        var total = 0
        var result: [SVGPrintPage] = []
        for value in values {
            let page = try SVGPrintPage(message: value)
            total += page.markup.utf8.count
            guard total <= 64 * 1_024 * 1_024 else { throw PDFRenderError.invalidPages }
            result.append(page)
        }
        return result
    }

    static func isSafeSVG(_ svg: String) -> Bool {
        let lower = svg.lowercased()
        guard !lower.contains("<!doctype"), !lower.contains("<!entity"), let data = svg.data(using: .utf8) else { return false }
        let delegate = SVGValidator()
        let parser = XMLParser(data: data)
        parser.shouldResolveExternalEntities = false
        parser.delegate = delegate
        return parser.parse() && delegate.valid && delegate.hasSVGRoot
    }

    static func isSafeHTML(_ html: String) -> Bool {
        let rejected = [#"<\s*(script|iframe|frame|frameset|object|embed|base|meta)\b"#,
                        #"<!\s*(doctype|entity)\b"#, #"\s+on[a-z0-9_:-]+\s*="#,
                        #"\bsrc\s*=\s*[\"']?\s*(https?:|//|file:|javascript:)"#]
        return !rejected.contains { html.range(of: $0, options: [.regularExpression, .caseInsensitive]) != nil }
    }
}

private final class SVGValidator: NSObject, XMLParserDelegate {
    var valid = true
    var hasSVGRoot = false
    private var depth = 0

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String]) {
        let name = elementName.lowercased().split(separator: ":").last.map(String.init) ?? ""
        if depth == 0 { hasSVGRoot = name == "svg" }
        depth += 1
        if ["script", "foreignobject", "iframe", "object", "embed", "audio", "video"].contains(name) { valid = false }
        for (attribute, value) in attributeDict {
            let key = attribute.lowercased()
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if key.hasPrefix("on") { valid = false }
            if key == "href" || key.hasSuffix(":href") || key == "src" {
                if !trimmed.hasPrefix("#") && !trimmed.hasPrefix("data:") { valid = false }
            }
        }
        if !valid { parser.abortParsing() }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) { depth -= 1 }
}

enum PDFRenderError: LocalizedError {
    case invalidPages, renderingFailed
    var errorDescription: String? {
        switch self {
        case .invalidPages: String(localized: "The PDF pages are invalid or exceed the export limits.")
        case .renderingFailed: String(localized: "The PDF could not be prepared. Try exporting fewer pages.")
        }
    }
}

@MainActor
final class SVGPagePDFRenderer: NSObject, WKNavigationDelegate {
    private var view: WKWebView?
    private var continuation: CheckedContinuation<Data, Error>?
    private var activeSize = CGSize.zero
    private var activePagination = false
    private var timeout: Task<Void, Never>?

    func render(_ pages: [SVGPrintPage]) async throws -> Data {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        self.view = view
        defer {
            timeout?.cancel()
            view.stopLoading()
            view.navigationDelegate = nil
            self.view = nil
        }
        let combined = PDFDocument()
        for page in pages {
            let data = try await renderPage(page, view: view)
            guard let rendered = PDFDocument(data: data), rendered.pageCount > 0,
                  (page.paginate || rendered.pageCount == 1), combined.pageCount + rendered.pageCount <= 250 else { throw PDFRenderError.renderingFailed }
            for index in 0..<rendered.pageCount {
                guard let pdfPage = rendered.page(at: index) else { throw PDFRenderError.renderingFailed }
                combined.insert(pdfPage, at: combined.pageCount)
            }
        }
        guard let result = combined.dataRepresentation(), Int64(result.count) <= DocumentLibrary.maximumImportBytes else { throw PDFRenderError.renderingFailed }
        return result
    }

    private func renderPage(_ page: SVGPrintPage, view: WKWebView) async throws -> Data {
        activeSize = CGSize(width: page.width, height: page.height)
        activePagination = page.paginate
        view.frame = CGRect(origin: .zero, size: activeSize)
        let csp = "default-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"
        let clipping = page.paginate ? "" : "height:\(page.height)px;overflow:hidden;"
        let html = "<!doctype html><html><head><meta charset='utf-8'><meta http-equiv='Content-Security-Policy' content=\"\(csp)\"><meta name='viewport' content='width=device-width,initial-scale=1'><style>html,body{margin:0;padding:0;width:\(page.width)px;\(clipping)}body>svg{display:block;width:100% !important;height:100% !important}</style></head><body>\(page.markup)</body></html>"
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            timeout = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
                self?.finish(.failure(PDFRenderError.renderingFailed))
            }
            view.loadHTMLString(html, baseURL: nil)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if activePagination {
            let renderer = PaginatedWebPrintRenderer(size: activeSize)
            renderer.addPrintFormatter(webView.viewPrintFormatter(), startingAtPageAt: 0)
            let count = renderer.numberOfPages
            guard count > 0, count <= 250 else { finish(.failure(PDFRenderError.invalidPages)); return }
            renderer.prepare(forDrawingPages: NSRange(location: 0, length: count))
            let data = UIGraphicsPDFRenderer(bounds: renderer.paperRect).pdfData { context in
                for index in 0..<count { context.beginPage(); renderer.drawPage(at: index, in: renderer.paperRect) }
            }
            finish(.success(data))
            return
        }
        PlatformWebKit.createPDF(in: webView, rect: CGRect(origin: .zero, size: activeSize)) { [weak self] result in self?.finish(result) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finish(.failure(PDFRenderError.renderingFailed)) }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.scheme == "about" ? .allow : .cancel)
    }

    private func finish(_ result: Result<Data, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        timeout?.cancel()
        timeout = nil
        continuation.resume(with: result)
    }
}

private final class PaginatedWebPrintRenderer: UIPrintPageRenderer {
    let size: CGSize
    init(size: CGSize) { self.size = size; super.init() }
    override var paperRect: CGRect { CGRect(origin: .zero, size: size) }
    override var printableRect: CGRect { paperRect }
}
