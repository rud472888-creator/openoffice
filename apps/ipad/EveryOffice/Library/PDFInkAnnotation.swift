import PDFKit
import UIKit

enum PDFInkAnnotation {
    static func make(points: [CGPoint], geometry: PDFInkGeometry, lineWidth: CGFloat, color: UIColor) -> PDFAnnotation? {
        guard let first = points.first else { return nil }
        let bounds = geometry.bounds
        func localPoint(_ point: CGPoint) -> CGPoint {
            let pagePoint = geometry.pagePoint(fromCanvas: point, canvasSize: geometry.displaySize)
            return CGPoint(x: pagePoint.x - bounds.minX, y: pagePoint.y - bounds.minY)
        }
        let path = UIBezierPath()
        let start = localPoint(first)
        path.move(to: start)
        for point in points.dropFirst() { path.addLine(to: localPoint(point)) }
        if points.count == 1 { path.addLine(to: CGPoint(x: start.x + 0.1, y: start.y + 0.1)) }
        let annotation = PDFAnnotation(bounds: bounds, forType: .ink, withProperties: nil)
        let border = PDFBorder()
        border.lineWidth = max(1, lineWidth)
        annotation.border = border
        annotation.color = color
        annotation.add(path)
        return annotation
    }
}
