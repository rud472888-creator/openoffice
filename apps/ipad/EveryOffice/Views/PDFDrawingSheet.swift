import SwiftUI
import PDFKit
import PencilKit

struct PDFDrawingSheet: View {
    let library: DocumentLibrary
    let document: OfficeDocument
    let pdf: PDFDocument
    let page: PDFPage
    @State private var canvas = PKCanvasView()
    @State private var errorMessage: String?
    @Environment(\.dismiss) private var dismiss

    private var geometry: PDFInkGeometry { PDFInkGeometry(bounds: page.bounds(for: .cropBox), rotation: page.rotation) }

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                let pageSize = geometry.displaySize
                let scale = min(proxy.size.width / max(pageSize.width, 1), proxy.size.height / max(pageSize.height, 1))
                ZStack {
                    Image(uiImage: page.thumbnail(of: pageSize, for: .cropBox))
                        .resizable().frame(width: pageSize.width, height: pageSize.height)
                    PencilCanvas(canvas: canvas)
                        .frame(width: pageSize.width, height: pageSize.height)
                }
                .scaleEffect(scale)
                .frame(width: proxy.size.width, height: proxy.size.height)
            }
            .background(OfficeTheme.subtle)
            .navigationTitle("Draw on this page")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .secondaryAction) { Button("Clear drawing") { canvas.drawing = PKDrawing() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { saveDrawing() } }
            }
            .safeAreaInset(edge: .bottom) {
                if let errorMessage { Text(verbatim: errorMessage).foregroundStyle(.red).padding() }
            }
        }
        .interactiveDismissDisabled()
    }

    private func saveDrawing() {
        guard pdf.allowsCommenting else { return }
        guard !canvas.drawing.strokes.isEmpty else { dismiss(); return }
        var annotations: [PDFAnnotation] = []
        for stroke in canvas.drawing.strokes {
            let points = stroke.path.interpolatedPoints(by: .distance(2)).map { $0.location.applying(stroke.transform) }
            guard let annotation = PDFInkAnnotation.make(points: points, geometry: geometry,
                lineWidth: stroke.path.first?.size.width ?? 2, color: stroke.ink.color) else { continue }
            page.addAnnotation(annotation)
            annotations.append(annotation)
        }
        do {
            guard let bytes = pdf.dataRepresentation() else { throw LibraryError.invalidFile }
            try library.saveData(bytes, document: document)
            dismiss()
        } catch {
            for annotation in annotations { page.removeAnnotation(annotation) }
            errorMessage = error.localizedDescription
        }
    }
}

private struct PencilCanvas: UIViewRepresentable {
    let canvas: PKCanvasView
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> PKCanvasView {
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.drawingPolicy = .anyInput
        canvas.tool = PKInkingTool(.pen, color: .systemBlue, width: 2)
        canvas.isScrollEnabled = false
        return canvas
    }
    func updateUIView(_ view: PKCanvasView, context: Context) {
        DispatchQueue.main.async {
            guard view.window != nil else { return }
            context.coordinator.picker.setVisible(true, forFirstResponder: view)
            context.coordinator.picker.addObserver(view)
            view.becomeFirstResponder()
        }
    }
    static func dismantleUIView(_ view: PKCanvasView, coordinator: Coordinator) {
        coordinator.picker.setVisible(false, forFirstResponder: view)
        coordinator.picker.removeObserver(view)
    }
    final class Coordinator { let picker = PKToolPicker() }
}
