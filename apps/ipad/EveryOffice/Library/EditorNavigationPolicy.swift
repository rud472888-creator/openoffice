import Foundation

enum EditorNavigationPolicy {
    static func allows(target: URL, mainFrame: Bool, trustedURL: URL, assetAllowed: (URL) -> Bool) -> Bool {
        if mainFrame { return target == trustedURL }
        // Preview iframes inherit this web view's editor origin. Main-frame
        // navigation and all script messages retain their stricter checks.
        // Foundation can expose an empty path for opaque about: URLs. Match
        // their complete resource specifier, allowing only a fragment suffix.
        if target.scheme == "about" {
            let resource = target.absoluteString.split(separator: "#", maxSplits: 1)[0]
            return resource == "about:blank" || resource == "about:srcdoc"
        }
        if target.scheme == "blob", let origin = URL(string: String(target.absoluteString.dropFirst(5))) {
            return origin.scheme == trustedURL.scheme && origin.host == trustedURL.host && origin.port == trustedURL.port
                && origin.user == nil && origin.password == nil
        }
        return assetAllowed(target)
    }
}
