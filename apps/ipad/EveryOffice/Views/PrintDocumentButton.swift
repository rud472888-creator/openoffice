import SwiftUI
import UIKit

struct PrintDocumentButton: View {
    let document: OfficeDocument
    @State private var request = 0

    var body: some View {
        Button { request += 1 } label: { Label("Print", systemImage: "printer") }
            .background(PrintAnchor(url: document.url, request: request))
    }
}

private struct PrintAnchor: UIViewRepresentable {
    let url: URL
    let request: Int
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> UIView { UIView(frame: .zero) }
    func updateUIView(_ view: UIView, context: Context) {
        guard request != context.coordinator.lastRequest else { return }
        context.coordinator.lastRequest = request
        DispatchQueue.main.async {
            guard view.window != nil, UIPrintInteractionController.canPrint(url) else { return }
            let controller = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.jobName = url.lastPathComponent
            info.outputType = .general
            controller.printInfo = info
            controller.printingItem = url
            controller.present(from: view.bounds, in: view, animated: true, completionHandler: nil)
        }
    }
    final class Coordinator { var lastRequest = 0 }
}
