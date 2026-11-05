import Foundation
import WebKit

@MainActor
enum PlatformWebKit {
    static func createPDF(in view: WKWebView, rect: CGRect, completion: @escaping (Result<Data, Error>) -> Void) {
        EOPlatformWebKit.createPDF(in: view, rect: rect) { data, error in
            if let error { completion(.failure(error)) }
            else if let data { completion(.success(data)) }
            else { completion(.failure(PDFRenderError.renderingFailed)) }
        }
    }

    static func evaluateAsync(in view: WKWebView, body: String, arguments: [String: Any] = [:],
                              completion: @escaping (Result<Any?, Error>) -> Void) {
        EOPlatformWebKit.evaluateAsync(in: view, body: body, arguments: arguments) { value, error in
            if let error { completion(.failure(error)) }
            else { completion(.success(value)) }
        }
    }
}
