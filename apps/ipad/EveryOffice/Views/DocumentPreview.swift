import SwiftUI
import QuickLook

struct DocumentPreview: View {
    let document: OfficeDocument

    var body: some View {
        VStack(spacing: 0) {
            Text("Preview only. Editing this format is not available on iPad.")
                .font(.caption).foregroundStyle(OfficeTheme.secondary)
                .padding(12).frame(maxWidth: .infinity).background(OfficeTheme.subtle)
            if QLPreviewController.canPreview(document.url as NSURL) {
                QuickLookPreview(url: document.url)
            } else {
                ContentUnavailableView("Preview unavailable", systemImage: document.kind.symbol,
                    description: Text("You can export the original file and open it in another app."))
            }
        }
    }
}

private struct QuickLookPreview: UIViewControllerRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url: url) }
    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }
    func updateUIViewController(_ controller: QLPreviewController, context: Context) {}

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}
