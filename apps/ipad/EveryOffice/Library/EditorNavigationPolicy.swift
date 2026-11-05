import Foundation

enum EditorNavigationPolicy {
    static func allows(target: URL, mainFrame: Bool, trustedURL: URL, assetAllowed: (URL) -> Bool) -> Bool {
        if mainFrame { return target == trustedURL }
        // Preview iframes inherit this web view's editor origin. Main-frame
        // navigation and all script messages retain their stricter checks.
        if target.scheme == "about", target.query == nil,
           target.path == "blank" || target.path == "srcdoc" { return true }
        if target.scheme == "blob", let origin = URL(string: String(target.absoluteString.dropFirst(5))) {
            return origin.scheme == trustedURL.scheme && origin.host == trustedURL.host && origin.port == trustedURL.port
                && origin.user == nil && origin.password == nil
        }
        return assetAllowed(target)
    }
}
