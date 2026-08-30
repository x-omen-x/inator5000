import SwiftUI
import Foundation
import Network
import ImageIO
import UniformTypeIdentifiers
import Darwin

private let plapCastPort: UInt16 = 43123
private let plapCastProduct = "omens-plapinator"

struct ShowCommand: Codable {
    let seq: Int
    let current: String
    let next: String
    let fit: String
    let zoom: Double
    let crossfade: Double
}

struct MediaMeta: Codable {
    let name: String
    let mime: String
    let size: Int
}

final class RokuController {
    private let queue = DispatchQueue(label: "plapcast.roku", qos: .userInitiated)
    private(set) var targets: [String] = []

    func setTargets(_ values: [String]) {
        targets = values
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private func post(_ url: URL) {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { _, _, _ in }.resume()
    }

    private func ecpURL(ip: String, path: String, query: [URLQueryItem] = []) -> URL? {
        var parts = URLComponents()
        parts.scheme = "http"
        parts.host = ip
        parts.port = 8060
        parts.path = path
        parts.queryItems = query.isEmpty ? nil : query
        return parts.url
    }

    private func sendInput(ip: String, items: [URLQueryItem]) {
        guard let url = ecpURL(ip: ip, path: "/input/dev", query: items) else { return }
        post(url)
    }

    func launch(session: String, server: String) {
        for ip in targets {
            guard let launch = ecpURL(ip: ip, path: "/launch/dev") else { continue }
            post(launch)

            let config = [
                URLQueryItem(name: "kind", value: "config"),
                URLQueryItem(name: "server", value: server),
                URLQueryItem(name: "token", value: session),
            ]

            queue.asyncAfter(deadline: .now() + 0.45) { [weak self] in self?.sendInput(ip: ip, items: config) }
            queue.asyncAfter(deadline: .now() + 1.25) { [weak self] in self?.sendInput(ip: ip, items: config) }
        }
    }

    func show(_ command: ShowCommand) {
        let items = [
            URLQueryItem(name: "kind", value: "show"),
            URLQueryItem(name: "seq", value: String(command.seq)),
            URLQueryItem(name: "current", value: command.current),
            URLQueryItem(name: "next", value: command.next),
            URLQueryItem(name: "fit", value: command.fit),
            URLQueryItem(name: "zoom", value: String(command.zoom)),
            URLQueryItem(name: "crossfade", value: String(command.crossfade)),
        ]
        targets.forEach { sendInput(ip: $0, items: items) }
    }

    func blank() {
        let items = [URLQueryItem(name: "kind", value: "blank")]
        targets.forEach { sendInput(ip: $0, items: items) }
    }

    func stop() {
        for ip in targets {
            if let url = ecpURL(ip: ip, path: "/exit-app/dev/true") { post(url) }
        }
    }
}

final class SessionState {
    let token: String
    let folder: URL
    var meta: [String: MediaMeta] = [:]

    init(token: String, folder: URL) {
        self.token = token
        self.folder = folder
    }

    func partURL(_ id: String) -> URL { folder.appendingPathComponent("\(id).part") }
    func imageURL(_ id: String) -> URL { folder.appendingPathComponent("\(id).jpg") }
}

struct HTTPRequest {
    let method: String
    let target: String
    let headers: [String: String]
    let body: Data

    var path: String {
        URLComponents(string: "http://localhost\(target)")?.path ?? target
    }

    var queryItems: [URLQueryItem] {
        URLComponents(string: "http://localhost\(target)")?.queryItems ?? []
    }

    func query(_ name: String) -> String? {
        queryItems.first(where: { $0.name == name })?.value
    }
}

final class PlapHTTPServer {
    private let queue = DispatchQueue(label: "plapcast.http", qos: .userInitiated)
    private let controller: RokuController
    private var listener: NWListener?
    private var session: SessionState?
    private let fileManager = FileManager.default
    private let root = FileManager.default.temporaryDirectory.appendingPathComponent("PlapCast", isDirectory: true)

    var onStatus: ((String) -> Void)?

    init(controller: RokuController) {
        self.controller = controller
    }

    func start() {
        queue.async {
            do {
                try self.fileManager.createDirectory(at: self.root, withIntermediateDirectories: true)
                guard let port = NWEndpoint.Port(rawValue: plapCastPort) else { throw NSError(domain: "PlapCast", code: 1) }
                let listener = try NWListener(using: .tcp, on: port)
                listener.newConnectionHandler = { [weak self] connection in
                    self?.handle(connection)
                }
                listener.stateUpdateHandler = { [weak self] state in
                    switch state {
                    case .ready:
                        self?.status("Helper ready on port \(plapCastPort)")
                    case .failed(let error):
                        self?.status("Helper failed: \(error.localizedDescription)")
                    default:
                        break
                    }
                }
                self.listener = listener
                listener.start(queue: self.queue)
            } catch {
                self.status("Helper failed: \(error.localizedDescription)")
            }
        }
    }

    private func status(_ text: String) {
        DispatchQueue.main.async { [weak self] in self?.onStatus?(text) }
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, buffer: Data())
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, complete, error in
            guard let self else { return }
            var next = buffer
            if let data { next.append(data) }

            if let request = self.parseRequest(next) {
                self.route(request, on: connection)
                return
            }

            if complete || error != nil || next.count > 96 * 1024 * 1024 {
                self.respond(connection, status: 400, body: self.json(["error": "Malformed request"]))
                return
            }
            self.receive(connection, buffer: next)
        }
    }

    private func parseRequest(_ data: Data) -> HTTPRequest? {
        let divider = Data("\r\n\r\n".utf8)
        guard let range = data.range(of: divider) else { return nil }
        let headData = data.subdata(in: data.startIndex..<range.lowerBound)
        guard let head = String(data: headData, encoding: .utf8) else { return nil }
        let lines = head.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }
        let bits = requestLine.split(separator: " ")
        guard bits.count >= 2 else { return nil }

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
            headers[key] = value
        }

        let length = Int(headers["content-length"] ?? "0") ?? 0
        let bodyStart = range.upperBound
        guard data.count >= bodyStart + length else { return nil }
        let body = data.subdata(in: bodyStart..<(bodyStart + length))
        return HTTPRequest(method: String(bits[0]), target: String(bits[1]), headers: headers, body: body)
    }

    private func authorized(_ request: HTTPRequest) -> Bool {
        request.headers["x-plapcast-product"] == plapCastProduct
    }

    private func safeID(_ value: String) -> Bool {
        !value.isEmpty && value.count <= 80 && value.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_"
        }
    }

    private func route(_ request: HTTPRequest, on connection: NWConnection) {
        if request.method == "GET" && request.path == "/v1/health" {
            guard authorized(request) else { return forbidden(connection) }
            respond(connection, body: json([
                "ok": true,
                "product": plapCastProduct,
                "version": "0.1.0",
                "rokuCount": controller.targets.count,
                "server": lanBaseURL(),
            ]))
            return
        }

        if request.method == "POST" && request.path == "/v1/session/start" {
            guard authorized(request) else { return forbidden(connection) }
            do {
                let token = UUID().uuidString.lowercased()
                if let old = session { try? fileManager.removeItem(at: old.folder) }
                let folder = root.appendingPathComponent(token, isDirectory: true)
                try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
                session = SessionState(token: token, folder: folder)
                let server = lanBaseURL()
                controller.launch(session: token, server: server)
                status("Session ready · \(controller.targets.count) Roku target(s)")
                respond(connection, body: json([
                    "ok": true,
                    "token": token,
                    "rokuCount": controller.targets.count,
                    "server": server,
                ]))
            } catch {
                respond(connection, status: 500, body: json(["error": error.localizedDescription]))
            }
            return
        }

        let parts = request.path.split(separator: "/").map(String.init)
        guard parts.count >= 3, parts[0] == "v1", parts[1] == "session" else {
            respond(connection, status: 404, body: json(["error": "Not found"]))
            return
        }
        guard let current = session, parts[2] == current.token else {
            respond(connection, status: 404, body: json(["error": "Session expired"]))
            return
        }

        if parts.count == 5 && parts[3] == "media" && request.method == "GET" {
            let id = parts[4]
            guard safeID(id) else { return badID(connection) }
            let url = current.imageURL(id)
            guard let data = try? Data(contentsOf: url) else {
                respond(connection, status: 404, body: json(["error": "Image not ready"]))
                return
            }
            respond(connection, contentType: "image/jpeg", body: data, cache: "private, max-age=3600")
            return
        }

        guard authorized(request) else { return forbidden(connection) }

        if parts.count == 6 && parts[3] == "media" {
            let id = parts[4]
            let action = parts[5]
            guard safeID(id) else { return badID(connection) }

            if request.method == "POST" && action == "begin" {
                do {
                    let meta = try JSONDecoder().decode(MediaMeta.self, from: request.body)
                    guard meta.size >= 0 && meta.size <= 100 * 1024 * 1024 else {
                        respond(connection, status: 413, body: json(["error": "Image is too large"]))
                        return
                    }
                    current.meta[id] = meta
                    fileManager.createFile(atPath: current.partURL(id).path, contents: Data())
                    respond(connection, body: json(["ok": true]))
                } catch {
                    respond(connection, status: 400, body: json(["error": "Invalid media metadata"]))
                }
                return
            }

            if request.method == "POST" && action == "chunk" {
                let offset = UInt64(request.query("offset") ?? "0") ?? 0
                let part = current.partURL(id)
                guard fileManager.fileExists(atPath: part.path) else {
                    respond(connection, status: 409, body: json(["error": "Upload was not started"]))
                    return
                }
                do {
                    let handle = try FileHandle(forWritingTo: part)
                    try handle.seek(toOffset: offset)
                    try handle.write(contentsOf: request.body)
                    try handle.close()
                    respond(connection, body: json(["ok": true]))
                } catch {
                    respond(connection, status: 500, body: json(["error": "Could not write image chunk"]))
                }
                return
            }

            if request.method == "POST" && action == "finish" {
                do {
                    try transcodeImage(from: current.partURL(id), to: current.imageURL(id))
                    try? fileManager.removeItem(at: current.partURL(id))
                    respond(connection, body: json(["ok": true]))
                } catch {
                    respond(connection, status: 422, body: json(["error": "Could not prepare \(current.meta[id]?.name ?? "image") for Roku"]))
                }
                return
            }
        }

        if parts.count == 4 && request.method == "POST" {
            switch parts[3] {
            case "show":
                do {
                    let command = try JSONDecoder().decode(ShowCommand.self, from: request.body)
                    guard safeID(command.current), fileManager.fileExists(atPath: current.imageURL(command.current).path) else {
                        respond(connection, status: 409, body: json(["error": "Current slide is not ready"]))
                        return
                    }
                    controller.show(command)
                    respond(connection, body: json(["ok": true]))
                } catch {
                    respond(connection, status: 400, body: json(["error": "Invalid show command"]))
                }
                return
            case "blank":
                controller.blank()
                respond(connection, body: json(["ok": true]))
                return
            case "stop":
                controller.stop()
                try? fileManager.removeItem(at: current.folder)
                session = nil
                status("Session stopped")
                respond(connection, body: json(["ok": true]))
                return
            default:
                break
            }
        }

        respond(connection, status: 404, body: json(["error": "Not found"]))
    }

    private func transcodeImage(from sourceURL: URL, to outputURL: URL) throws {
        guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil) else {
            throw NSError(domain: "PlapCast", code: 20)
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 1920,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw NSError(domain: "PlapCast", code: 21)
        }
        guard let destination = CGImageDestinationCreateWithURL(
            outputURL as CFURL,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            throw NSError(domain: "PlapCast", code: 22)
        }
        let props: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.96]
        CGImageDestinationAddImage(destination, image, props as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            throw NSError(domain: "PlapCast", code: 23)
        }
    }

    private func lanBaseURL() -> String {
        "http://\(preferredIPv4Address() ?? "127.0.0.1"):\(plapCastPort)"
    }

    private func json(_ object: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: object, options: [])) ?? Data("{}".utf8)
    }

    private func badID(_ connection: NWConnection) {
        respond(connection, status: 400, body: json(["error": "Invalid media id"]))
    }

    private func forbidden(_ connection: NWConnection) {
        respond(connection, status: 403, body: json(["error": "This helper only accepts Omen's Plapinator"]))
    }

    private func respond(
        _ connection: NWConnection,
        status: Int = 200,
        contentType: String = "application/json; charset=utf-8",
        body: Data,
        cache: String = "no-store"
    ) {
        let reason: String
        switch status {
        case 200: reason = "OK"
        case 400: reason = "Bad Request"
        case 403: reason = "Forbidden"
        case 404: reason = "Not Found"
        case 409: reason = "Conflict"
        case 413: reason = "Payload Too Large"
        case 422: reason = "Unprocessable Content"
        default: reason = "Error"
        }
        let header = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(contentType)\r\nContent-Length: \(body.count)\r\nCache-Control: \(cache)\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n"
        var data = Data(header.utf8)
        data.append(body)
        connection.send(content: data, completion: .contentProcessed { _ in connection.cancel() })
    }
}

private func preferredIPv4Address() -> String? {
    var pointer: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&pointer) == 0, let first = pointer else { return nil }
    defer { freeifaddrs(pointer) }

    var candidates: [(String, String)] = []
    var cursor: UnsafeMutablePointer<ifaddrs>? = first
    while let item = cursor {
        defer { cursor = item.pointee.ifa_next }
        guard let address = item.pointee.ifa_addr, address.pointee.sa_family == UInt8(AF_INET) else { continue }
        let flags = Int32(item.pointee.ifa_flags)
        guard (flags & IFF_UP) != 0, (flags & IFF_LOOPBACK) == 0 else { continue }

        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        var copy = address.pointee
        let result = withUnsafePointer(to: &copy) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getnameinfo($0, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
            }
        }
        if result == 0 {
            let name = String(cString: item.pointee.ifa_name)
            candidates.append((name, String(cString: host)))
        }
    }
    return candidates.first(where: { $0.0 == "en0" })?.1 ?? candidates.first?.1
}

@MainActor
final class PlapCastModel: ObservableObject {
    @Published var roku1: String
    @Published var roku2: String
    @Published var status = "Starting helper…"

    let controller = RokuController()
    private var server: PlapHTTPServer!

    init() {
        roku1 = UserDefaults.standard.string(forKey: "roku1") ?? ""
        roku2 = UserDefaults.standard.string(forKey: "roku2") ?? ""
        controller.setTargets([roku1, roku2])
        server = PlapHTTPServer(controller: controller)
        server.onStatus = { [weak self] text in self?.status = text }
        server.start()
    }

    func save() {
        UserDefaults.standard.set(roku1, forKey: "roku1")
        UserDefaults.standard.set(roku2, forKey: "roku2")
        controller.setTargets([roku1, roku2])
        status = "Saved · \(controller.targets.count) Roku target(s)"
    }
}

struct ContentView: View {
    @EnvironmentObject var model: PlapCastModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("PLAPCAST")
                .font(.system(size: 30, weight: .black, design: .monospaced))
            Text("native slideshow sync for omens plapinator")
                .foregroundStyle(.secondary)

            Divider()

            Text("Roku addresses")
                .font(.headline)
            Text("On each Roku: Settings → Network → About → IP address")
                .font(.caption)
                .foregroundStyle(.secondary)

            TextField("Roku #1, e.g. 192.168.1.40", text: $model.roku1)
                .textFieldStyle(.roundedBorder)
            TextField("Roku #2, e.g. 192.168.1.41", text: $model.roku2)
                .textFieldStyle(.roundedBorder)

            HStack {
                Button("Save Roku addresses") { model.save() }
                    .keyboardShortcut(.defaultAction)
                Text(model.status)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }

            Divider()

            Text("The Roku receiver must be sideloaded once on each Roku in Developer Mode. After that, leave this app open and use the PlapCast button inside Omen's Plapinator in Chrome.")
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)

            Text("Images stay on this Mac and your local Wi‑Fi. PlapCast does not upload them to a cloud service.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(22)
        .frame(width: 560)
    }
}

@main
struct PlapCastApp: App {
    @StateObject private var model = PlapCastModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
        }
        .windowResizability(.contentSize)
    }
}
