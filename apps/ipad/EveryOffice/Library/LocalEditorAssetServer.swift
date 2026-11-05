import Foundation
import Network

// This resolver only maps URLs to immutable app resources. Document-library
// paths and document contents are never exposed by the HTTP server.
struct EditorAssetResolver {
    let root: URL
    let token: String

    func resourceURL(for requestTarget: String) -> URL? {
        let encodedPath = String(requestTarget.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0])
        guard encodedPath.hasPrefix("/"), !encodedPath.hasPrefix("//"),
              let path = encodedPath.removingPercentEncoding,
              !path.contains("\\"), !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        var components = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard components.count >= 3, components[0].isEmpty, components[1] == token else { return nil }
        components.removeFirst(2)
        if components.last == "" { components[components.count - 1] = "index.html" }
        guard components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { return nil }
        let resourceRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        let target = components.reduce(resourceRoot) { $0.appendingPathComponent($1) }
            .standardizedFileURL.resolvingSymlinksInPath()
        guard target.path.hasPrefix(resourceRoot.path + "/") else { return nil }
        return target
    }

    static func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "html", "htm": "text/html; charset=utf-8"
        case "js", "mjs": "text/javascript; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "wasm": "application/wasm"
        case "json", "map": "application/json"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "gif": "image/gif"
        case "webp": "image/webp"
        case "ico": "image/x-icon"
        case "woff": "font/woff"
        case "woff2": "font/woff2"
        case "ttf": "font/ttf"
        case "otf": "font/otf"
        case "xml": "application/xml"
        case "txt": "text/plain; charset=utf-8"
        default: "application/octet-stream"
        }
    }
}

final class LocalEditorAssetServer {
    private let resolver: EditorAssetResolver
    private let queue = DispatchQueue(label: "app.everyoffice.editor-assets")
    private let stateLock = NSLock()
    private var port: UInt16?
    private var listener: NWListener?
    private var connections: [UUID: NWConnection] = [:]
    private var startupCompletion: (@MainActor (Result<URL, Error>) -> Void)?
    private var startupDeadline: DispatchWorkItem?
    private var stopped = false

    init(root: URL, token: String = UUID().uuidString) {
        resolver = EditorAssetResolver(root: root, token: token)
    }

    func start(completion: @escaping @MainActor (Result<URL, Error>) -> Void) {
        queue.async { [self] in
            guard !stopped else { Task { @MainActor in completion(.failure(URLError(.cancelled))) }; return }
            guard listener == nil, startupCompletion == nil else { Task { @MainActor in completion(.failure(URLError(.cannotConnectToHost))) }; return }
            startupCompletion = completion
            do {
                let parameters = NWParameters.tcp
                parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
                let listener = try NWListener(using: parameters)
                self.listener = listener
                listener.stateUpdateHandler = { [weak self, weak listener] state in
                    guard let self else { return }
                    switch state {
                    case .ready:
                        guard self.startupCompletion != nil, let assignedPort = listener?.port?.rawValue,
                              let url = URL(string: "http://localhost:\(assignedPort)/\(self.resolver.token)/index.html") else { return }
                        self.stateLock.lock()
                        self.port = assignedPort
                        self.stateLock.unlock()
                        self.finishStartup(.success(url))
                    case .failed(let error):
                        self.finishStartup(.failure(error))
                    case .cancelled:
                        self.finishStartup(.failure(URLError(.cancelled)))
                    default: break
                    }
                }
                listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
                let deadline = DispatchWorkItem { [weak self] in self?.finishStartup(.failure(URLError(.timedOut))) }
                startupDeadline = deadline
                queue.asyncAfter(deadline: .now() + 15, execute: deadline)
                listener.start(queue: queue)
            } catch { finishStartup(.failure(error)) }
        }
    }

    private func finishStartup(_ result: Result<URL, Error>) {
        guard let completion = startupCompletion else { return }
        startupCompletion = nil
        startupDeadline?.cancel()
        startupDeadline = nil
        if case .failure = result {
            listener?.cancel()
            listener = nil
            stateLock.lock()
            port = nil
            stateLock.unlock()
        }
        Task { @MainActor in completion(result) }
    }

    func allowsNavigation(to url: URL) -> Bool {
        stateLock.lock()
        let assignedPort = port
        stateLock.unlock()
        guard let assignedPort, url.scheme == "http", url.host == "localhost", url.port == Int(assignedPort),
              url.user == nil, url.password == nil,
              let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath else { return false }
        return resolver.resourceURL(for: path) != nil
    }

    func stop() {
        queue.async { [self] in
            stopped = true
            finishStartup(.failure(URLError(.cancelled)))
            listener?.cancel()
            listener = nil
            for connection in connections.values { connection.cancel() }
            connections.removeAll()
            stateLock.lock()
            port = nil
            stateLock.unlock()
        }
    }

    private func accept(_ connection: NWConnection) {
        let id = UUID()
        connections[id] = connection
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 15) { [weak self, weak connection] in
            connection?.cancel()
            self?.connections.removeValue(forKey: id)
        }
        receive(connection, id: id, buffer: Data())
    }

    private func receive(_ connection: NWConnection, id: UUID, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, complete, error in
            guard let self else { connection.cancel(); return }
            var received = buffer
            if let data { received.append(data) }
            guard received.count <= 16_384 else { self.respond(connection, id: id, status: "431 Request Header Fields Too Large"); return }
            if let end = received.range(of: Data("\r\n\r\n".utf8)) {
                self.handle(connection, id: id, header: received.subdata(in: 0..<end.lowerBound))
            } else if complete || error != nil {
                connection.cancel()
                self.connections.removeValue(forKey: id)
            } else { self.receive(connection, id: id, buffer: received) }
        }
    }

    private func handle(_ connection: NWConnection, id: UUID, header: Data) {
        guard let request = String(data: header, encoding: .utf8) else { respond(connection, id: id, status: "400 Bad Request"); return }
        let lines = request.components(separatedBy: "\r\n")
        let first = lines[0].split(separator: " ", omittingEmptySubsequences: false)
        guard first.count == 3, first[2] == "HTTP/1.1" || first[2] == "HTTP/1.0" else { respond(connection, id: id, status: "400 Bad Request"); return }
        let method = String(first[0])
        guard method == "GET" || method == "HEAD" else { respond(connection, id: id, status: "405 Method Not Allowed"); return }
        let hosts = lines.dropFirst().compactMap { line -> String? in
            let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2, parts[0].lowercased() == "host" else { return nil }
            return parts[1].trimmingCharacters(in: .whitespaces)
        }
        stateLock.lock()
        let expectedHost = port.map { "localhost:\($0)" }
        stateLock.unlock()
        guard hosts.count == 1, hosts[0] == expectedHost,
              let asset = resolver.resourceURL(for: String(first[1])),
              (try? asset.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { respond(connection, id: id, status: "404 Not Found"); return }
        do {
            let body = try Data(contentsOf: asset, options: .mappedIfSafe)
            respond(connection, id: id, status: "200 OK", contentType: EditorAssetResolver.mimeType(for: asset), body: body, headOnly: method == "HEAD")
        } catch { respond(connection, id: id, status: "404 Not Found") }
    }

    private func respond(_ connection: NWConnection, id: UUID, status: String,
                         contentType: String = "text/plain", body: Data = Data(), headOnly: Bool = false) {
        let headers = "HTTP/1.1 \(status)\r\nContent-Length: \(body.count)\r\nContent-Type: \(contentType)\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nAllow: GET, HEAD\r\n\r\n"
        connection.send(content: Data(headers.utf8), completion: .contentProcessed { [weak self] error in
            guard error == nil, !headOnly, !body.isEmpty else {
                connection.cancel()
                self?.connections.removeValue(forKey: id)
                return
            }
            connection.send(content: body, completion: .contentProcessed { [weak self] _ in
                connection.cancel()
                self?.connections.removeValue(forKey: id)
            })
        })
    }
}
