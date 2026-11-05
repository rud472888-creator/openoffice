import SwiftUI
import UIKit

struct GeneratedPDFPresentation: Identifiable {
    enum Action { case share, print }
    let id = UUID()
    let url: URL
    let action: Action

    static func make(data: Data, name: String, action: Action) throws -> GeneratedPDFPresentation {
        let base = URL(fileURLWithPath: name).deletingPathExtension().lastPathComponent
        let filename = base.isEmpty || base == "." || base == ".." ? "Document" : base
        return try makeFile(data: data, name: filename + ".pdf", action: action)
    }

    static func makeFile(data: Data, name: String, action: Action = .share) throws -> GeneratedPDFPresentation {
        guard !name.isEmpty, !name.hasPrefix("."), !name.contains("/"), !name.contains("\\"), !name.contains(":"),
              name.utf8.count <= 240, !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              Int64(data.count) <= DocumentLibrary.maximumImportBytes else { throw LibraryError.invalidFile }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Exports").appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(name)
        try data.write(to: url, options: .atomic)
        return GeneratedPDFPresentation(url: url, action: action)
    }
}

struct GeneratedPDFPresenter: UIViewControllerRepresentable {
    let presentation: GeneratedPDFPresentation
    let onFinish: (Bool) -> Void

    func makeUIViewController(context: Context) -> UIViewController {
        switch presentation.action {
        case .share:
            let controller = UIActivityViewController(activityItems: [presentation.url], applicationActivities: nil)
            controller.completionWithItemsHandler = { _, completed, _, _ in onFinish(completed) }
            return controller
        case .print:
            return PDFPrintHostController(url: presentation.url, onFinish: onFinish)
        }
    }
    func updateUIViewController(_ controller: UIViewController, context: Context) {}
}

private final class PDFPrintHostController: UIViewController {
    let url: URL
    let onFinish: (Bool) -> Void
    private var presented = false

    init(url: URL, onFinish: @escaping (Bool) -> Void) {
        self.url = url
        self.onFinish = onFinish
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { return nil }

    override func viewDidLoad() { super.viewDidLoad(); view.backgroundColor = .systemBackground }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !presented else { return }
        presented = true
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = url.lastPathComponent
        info.outputType = .general
        controller.printInfo = info
        controller.printingItem = url
        if !controller.present(from: view.bounds, in: view, animated: true, completionHandler: { [weak self] _, completed, _ in self?.onFinish(completed) }) { onFinish(false) }
    }
}
