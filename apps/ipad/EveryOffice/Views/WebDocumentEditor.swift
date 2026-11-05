import SwiftUI
import WebKit

struct WebDocumentEditor: View {
    let library: DocumentLibrary
    let document: OfficeDocument
    let resource: String
    @State private var saveRequest = 0
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 0) {
            OfficeWebView(library: library, document: document, resource: resource, saveRequest: saveRequest)
            Text(LocalizedStringKey(library.savingDocumentIDs.contains(document.id) ? "Saving…" : "Saved on this iPad"))
                .font(.caption).foregroundStyle(OfficeTheme.secondary)
                .padding(12).frame(maxWidth: .infinity).background(OfficeTheme.subtle)
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

private struct OfficeWebView: UIViewRepresentable {
    let library: DocumentLibrary
    let document: OfficeDocument
    let resource: String
    let saveRequest: Int

    func makeCoordinator() -> Coordinator {
        if let retained = Coordinator.retained[document.id] { return retained }
        let coordinator = Coordinator(library: library, document: document)
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
        let index = root.appendingPathComponent("index.html")
        context.coordinator.trustedURL = index.standardizedFileURL
        view.loadFileURL(index, allowingReadAccessTo: root)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
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
        let document: OfficeDocument
        var webView: WKWebView?
        var trustedURL: URL?
        var lastSaveRequest = 0
        var dirty = false
        var draftInProgress = false
        var saving = false
        var saveAgain = false
        var isClosing = false
        var revision = 0
        var lastSavedRevision = -1

        init(library: DocumentLibrary, document: OfficeDocument) {
            self.library = library
            self.document = document
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame,
                  let trustedURL, message.frameInfo.request.url?.standardizedFileURL == trustedURL,
                  let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "ready":
                do {
                    let data = try Data(contentsOf: document.url)
                    let locale = Self.editorLocale
                    let payload: [String: String] = ["name": document.filename, "base64": data.base64EncodedString(), "kind": document.url.pathExtension.lowercased(), "language": locale, "locale": locale]
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
            case "save":
                do {
                    guard let base64 = body["base64"] as? String, let data = Data(base64Encoded: base64) else { throw LibraryError.invalidFile }
                    let savedRevision = (body["revision"] as? Int) ?? revision
                    if savedRevision >= lastSavedRevision {
                        try library.saveData(data, document: document)
                        lastSavedRevision = savedRevision
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
            default: break
            }
        }

        private static var editorLocale: String {
            let preferred = Locale.preferredLanguages.first?.lowercased() ?? "en"
            if preferred.hasPrefix("zh-hant") || preferred.hasPrefix("zh-tw") { return "zh-TW" }
            if preferred.hasPrefix("zh") { return "zh" }
            return preferred.components(separatedBy: "-")[0]
        }

        func requestSave() {
            guard let webView else { return }
            if saving { saveAgain = true; return }
            saving = true
            library.savingDocumentIDs.insert(document.id)
            webView.evaluateJavaScript("void window.everyOffice.saveDocument()") { [weak self] _, error in
                if let error { self?.fail(error) }
            }
        }

        private func fail(_ error: Error) {
            saving = false
            library.present(error)
            if !dirty { library.savingDocumentIDs.remove(document.id) }
            if isClosing, !dirty { releaseWebView() }
        }

        func releaseWebView() {
            webView?.configuration.userContentController.removeScriptMessageHandler(forName: "everyOffice")
            webView?.navigationDelegate = nil
            webView = nil
            Self.retained.removeValue(forKey: document.id)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let target = navigationAction.request.url?.standardizedFileURL
            decisionHandler(target != nil && target == trustedURL ? .allow : .cancel)
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
