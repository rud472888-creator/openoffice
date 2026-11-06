import SwiftUI
import WebKit

struct WebDocumentEditor: View {
    let library: DocumentLibrary
    let document: OfficeDocument
    let resource: String
    var kind: String? = nil
    @State private var saveRequest = 0
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 0) {
            OfficeWebView(library: library, document: document, resource: resource, kind: kind, saveRequest: saveRequest)
            HStack(spacing: 7) {
                Image(systemName: library.savingDocumentIDs.contains(document.id) ? "arrow.triangle.2.circlepath" : "checkmark.circle")
                    .font(.system(size: 11))
                Text(LocalizedStringKey(library.savingDocumentIDs.contains(document.id) ? "Saving…" : library.readyDocumentIDs.contains(document.id) ? "Saved on this iPad" : "Opening…"))
                    .accessibilityIdentifier(library.readyDocumentIDs.contains(document.id) && !library.savingDocumentIDs.contains(document.id) ? "webEditorReady" : "webEditorBusy")
                Spacer()
                Text(verbatim: document.url.pathExtension.uppercased())
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
            }
            .font(.caption2).foregroundStyle(OfficeTheme.secondary)
            .padding(.horizontal, 20).padding(.vertical, 8)
            .background(OfficeTheme.surface)
        }
        .toolbar {
            ToolbarItem(placement: .secondaryAction) {
                Button { saveRequest += 1 } label: { Label("Save", systemImage: "square.and.arrow.down") }
                    .keyboardShortcut("s", modifiers: .command)
            }
        }
        .onChange(of: scenePhase) { _, phase in if phase != .active { saveRequest += 1 } }
    }
}

struct OfficeWebView: UIViewRepresentable {
    let library: DocumentLibrary
    let document: OfficeDocument
    let resource: String
    let kind: String?
    let saveRequest: Int

    func makeCoordinator() -> Coordinator {
        if let retained = Coordinator.retained[document.id] { return retained }
        let coordinator = Coordinator(library: library, document: document, kind: kind)
        Coordinator.retained[document.id] = coordinator
        return coordinator
    }

    func makeUIView(context: Context) -> WKWebView {
        context.coordinator.isClosing = false
        if let retainedView = context.coordinator.webView { return retainedView }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "everyOffice")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isInspectable = false
        context.coordinator.webView = view
        guard let root = Bundle.main.resourceURL?.appendingPathComponent(resource, isDirectory: true),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            library.present(EditorBridgeError.missingResources)
            return view
        }
        let server = LocalEditorAssetServer(root: root)
        context.coordinator.assetServer = server
        server.start { [weak coordinator = context.coordinator, weak view] result in
            guard let coordinator, let view else { return }
            switch result {
            case .success(let index):
                coordinator.trustedURL = index
                view.load(URLRequest(url: index))
            case .failure(let error): coordinator.fail(error)
            }
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.document = document
        if context.coordinator.lastSaveRequest != saveRequest {
            context.coordinator.lastSaveRequest = saveRequest
            context.coordinator.requestSave()
        }
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.isClosing = true
        if coordinator.dirty || coordinator.saving { coordinator.requestSave() }
        else { coordinator.releaseWebView() }
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        // Retain an unsaved editor through navigation and transient disk failures.
        static var retained: [UUID: Coordinator] = [:]
        let library: DocumentLibrary
        var document: OfficeDocument
        let kind: String?
        var webView: WKWebView?
        var assetServer: LocalEditorAssetServer?
        var trustedURL: URL?
        var lastSaveRequest = 0
        var dirty = false
        var draftInProgress = false
        var saving = false
        var saveAgain = false
        var isClosing = false
        var revision = 0
        var lastSavedRevision = -1

        init(library: DocumentLibrary, document: OfficeDocument, kind: String?) {
            self.library = library
            self.document = document
            self.kind = kind
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame,
                  let trustedURL, message.frameInfo.request.url == trustedURL,
                  let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "ready":
                do {
                    if document.kind.isTextEditable, !["csv", "tsv", "xls", "ods"].contains(document.url.pathExtension.lowercased()) { _ = try library.readText(document) }
                    let data = try Data(contentsOf: document.url)
                    let locale = Self.editorLocale
                    let payload: [String: Any] = ["name": document.filename, "base64": data.base64EncodedString(), "kind": kind ?? document.url.pathExtension.lowercased(), "language": locale, "locale": locale, "readingState": library.readingState(for: document)]
                    let json = try JSONSerialization.data(withJSONObject: payload)
                    guard let string = String(data: json, encoding: .utf8) else { throw LibraryError.invalidFile }
                    webView?.evaluateJavaScript("void window.everyOffice.openDocument(\(string))") { [weak self] _, error in
                        if let error { self?.fail(error) }
                    }
                } catch { fail(error) }
            case "changed":
                dirty = true
                draftInProgress = body["draft"] as? Bool ?? false
                revision = (body["revision"] as? Int) ?? (revision + 1)
                library.savingDocumentIDs.insert(document.id)
                library.pendingSaveActions[document.id] = { [self] in requestSave() }
                if !draftInProgress { requestSave() }
            case "opened":
                library.readyDocumentIDs.insert(document.id)
                if saveAgain { saveAgain = false; requestSave() }
            case "save":
                do {
                    guard let base64 = body["base64"] as? String, let data = Data(base64Encoded: base64) else { throw LibraryError.invalidFile }
                    let savedRevision = (body["revision"] as? Int) ?? revision
                    if savedRevision >= lastSavedRevision {
                        try library.saveData(data, document: document)
                        lastSavedRevision = savedRevision
                        webView?.evaluateJavaScript("void window.everyOffice?.didSave?.(\(savedRevision))", completionHandler: nil)
                    }
                    saving = false
                    dirty = savedRevision < revision
                    if saveAgain || (dirty && !draftInProgress) {
                        saveAgain = false
                        requestSave()
                    } else if !dirty {
                        library.savingDocumentIDs.remove(document.id)
                        library.pendingSaveActions.removeValue(forKey: document.id)
                        if isClosing { releaseWebView() }
                    }
                } catch { fail(error) }
            case "error":
                fail(EditorBridgeError.editor(body["message"] as? String ?? String(localized: "Unable to open")))
            case "exportPDF", "printPages":
                let requestID = body["requestId"] as? String
                guard !library.preparingPDF, library.generatedPDF == nil else { acknowledgeExport(requestID, completed: false); return }
                do {
                    let pages = try SVGPrintPage.pages(from: body)
                    let action: GeneratedPDFPresentation.Action = type == "printPages" ? .print : .share
                    let name = body["name"] as? String ?? document.filename
                    library.preparingPDF = true
                    Task { [library, weak self] in
                        defer { library.preparingPDF = false }
                        do {
                            let renderer = SVGPagePDFRenderer()
                            let data = try await renderer.render(pages)
                            library.generatedFileCompletion = { [weak self] completed in self?.acknowledgeExport(requestID, completed: completed) }
                            library.generatedPDF = try GeneratedPDFPresentation.make(data: data, name: name, action: action)
                        } catch {
                            self?.acknowledgeExport(requestID, completed: false, error: error.localizedDescription)
                            library.present(error)
                        }
                    }
                } catch { acknowledgeExport(requestID, completed: false, error: error.localizedDescription); library.present(error) }
            case "exportFile":
                let requestID = body["requestId"] as? String
                do {
                    guard !library.preparingPDF, library.generatedPDF == nil,
                          let base64 = body["base64"] as? String,
                          base64.utf8.count <= Int(DocumentLibrary.maximumImportBytes * 4 / 3 + 4),
                          let data = Data(base64Encoded: base64), let name = body["name"] as? String else { throw LibraryError.invalidFile }
                    let presentation = try GeneratedPDFPresentation.makeFile(data: data, name: name)
                    library.generatedFileCompletion = { [weak self] completed in self?.acknowledgeExport(requestID, completed: completed) }
                    library.generatedPDF = presentation
                } catch { acknowledgeExport(requestID, completed: false, error: error.localizedDescription); library.present(error) }
            case "importCopy":
                let requestID = body["requestId"] as? String
                do {
                    guard let base64 = body["base64"] as? String,
                          base64.utf8.count <= Int(DocumentLibrary.maximumImportBytes * 4 / 3 + 4),
                          let data = Data(base64Encoded: base64), let name = body["name"] as? String,
                          let kind = body["kind"] as? String else { throw LibraryError.invalidFile }
                    let sourceExtension = document.url.pathExtension.lowercased()
                    let conversionSave = body["conversionSave"] as? Bool ?? false
                    let snapshot = body["revision"] as? Int
                    if ["csv", "tsv", "xls", "ods"].contains(sourceExtension), conversionSave {
                        guard let snapshot, snapshot >= 0, snapshot <= revision else { throw LibraryError.invalidFile }
                        if snapshot < revision {
                            saving = false
                            acknowledgeExport(requestID, completed: false)
                            requestSave()
                            return
                        }
                    }
                    let converted = try library.importCopy(data: data, name: name, kind: kind)
                    if DocumentConversionPolicy.completesSource(sourceExtension: sourceExtension, destinationKind: kind,
                        conversionSave: conversionSave, savedRevision: snapshot, currentRevision: revision) {
                        dirty = false
                        saving = false
                        saveAgain = false
                        library.savingDocumentIDs.remove(document.id)
                        library.pendingSaveActions.removeValue(forKey: document.id)
                    }
                    acknowledgeExport(requestID, completed: true)
                    library.selectedID = converted.id
                } catch { acknowledgeExport(requestID, completed: false, error: error.localizedDescription); fail(error) }
            case "readingState":
                do { try library.saveReadingState(body, document: document) } catch { library.present(error) }
            default: break
            }
        }

        private static var editorLocale: String {
            let preferred = Locale.preferredLanguages.first?.lowercased() ?? "en"
            if preferred.hasPrefix("zh-hant") || preferred.hasPrefix("zh-tw") { return "zh-TW" }
            if preferred.hasPrefix("zh") { return "zh" }
            return preferred.components(separatedBy: "-")[0]
        }

        private func acknowledgeExport(_ requestID: String?, completed: Bool, error: String? = nil) {
            guard let requestID else { return }
            var outcome: [String: Any] = ["completed": completed]
            if let error { outcome["error"] = error }
            guard let data = try? JSONSerialization.data(withJSONObject: [requestID, outcome]),
                  let arguments = String(data: data, encoding: .utf8) else { return }
            webView?.evaluateJavaScript("void window.everyOffice?.didExport?.(...\(arguments))", completionHandler: nil)
        }

        func requestSave() {
            guard let webView else { return }
            // Editors can ignore saves until their asynchronous document load finishes.
            guard library.readyDocumentIDs.contains(document.id) else { saveAgain = true; return }
            if saving { saveAgain = true; return }
            saving = true
            library.savingDocumentIDs.insert(document.id)
            webView.evaluateJavaScript("void window.everyOffice.saveDocument()") { [weak self] _, error in
                if let error { self?.fail(error) }
            }
        }

        func fail(_ error: Error) {
            saving = false
            library.present(error)
            if !dirty { library.savingDocumentIDs.remove(document.id) }
            if isClosing, !dirty { releaseWebView() }
        }

        func releaseWebView() {
            library.readyDocumentIDs.remove(document.id)
            assetServer?.stop()
            assetServer = nil
            webView?.configuration.userContentController.removeScriptMessageHandler(forName: "everyOffice")
            webView?.navigationDelegate = nil
            webView = nil
            Self.retained.removeValue(forKey: document.id)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = navigationAction.request.url, let frame = navigationAction.targetFrame else { decisionHandler(.cancel); return }
            guard let trustedURL else { decisionHandler(.cancel); return }
            let allowed = EditorNavigationPolicy.allows(target: target, mainFrame: frame.isMainFrame, trustedURL: trustedURL) { assetServer?.allowsNavigation(to: $0) == true }
            decisionHandler(allowed ? .allow : .cancel)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            library.savingDocumentIDs.remove(document.id)
            library.pendingSaveActions.removeValue(forKey: document.id)
            releaseWebView()
            library.present(EditorBridgeError.terminated)
            library.selectedID = nil
        }
    }
}

private enum EditorBridgeError: LocalizedError {
    case missingResources, terminated, editor(String)
    var errorDescription: String? {
        switch self {
        case .missingResources: String(localized: "The editor is missing. Rebuild the app with its document resources.")
        case .terminated: String(localized: "The editor stopped. Reopen the document to restore the last saved version.")
        case .editor(let message): message
        }
    }
}
