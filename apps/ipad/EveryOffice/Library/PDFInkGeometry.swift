import CoreGraphics

struct PDFInkGeometry {
    let bounds: CGRect
    let rotation: Int

    var displaySize: CGSize {
        normalizedRotation == 90 || normalizedRotation == 270
            ? CGSize(width: bounds.height, height: bounds.width) : bounds.size
    }

    private var normalizedRotation: Int { ((rotation % 360) + 360) % 360 }

    func pagePoint(fromCanvas point: CGPoint, canvasSize: CGSize) -> CGPoint {
        let u = point.x / max(canvasSize.width, 1)
        let v = point.y / max(canvasSize.height, 1)
        let normalized: CGPoint
        switch normalizedRotation {
        case 90: normalized = CGPoint(x: v, y: u)
        case 180: normalized = CGPoint(x: 1 - u, y: v)
        case 270: normalized = CGPoint(x: 1 - v, y: 1 - u)
        default: normalized = CGPoint(x: u, y: 1 - v)
        }
        return CGPoint(x: bounds.minX + normalized.x * bounds.width, y: bounds.minY + normalized.y * bounds.height)
    }
}
