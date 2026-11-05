import Foundation

struct EditorReadingMetadata: Codable {
    struct Position: Codable {
        let spineIndex: Int
        let blockId: String?
    }
    struct Preferences: Codable {
        let fontScale: Double
        let lineHeight: Double
        let dark: Bool
    }
    var positions: [String: Position] = [:]
    var viewPrefs: Preferences?

    func payload(for id: UUID) -> [String: Any] {
        var result: [String: Any] = [:]
        if let position = positions[id.uuidString] {
            var value: [String: Any] = ["spineIndex": position.spineIndex]
            if let blockId = position.blockId { value["blockId"] = blockId }
            result["position"] = value
        }
        if let viewPrefs { result["viewPrefs"] = ["fontScale": viewPrefs.fontScale, "lineHeight": viewPrefs.lineHeight, "dark": viewPrefs.dark] }
        return result
    }

    mutating func update(id: UUID, message: [String: Any]) throws {
        if let value = message["position"] as? [String: Any] {
            guard let spineIndex = value["spineIndex"] as? Int, (0...100_000).contains(spineIndex) else { throw LibraryError.invalidFile }
            let blockId = value["blockId"] as? String
            guard (blockId?.count ?? 0) <= 512 else { throw LibraryError.invalidFile }
            positions[id.uuidString] = Position(spineIndex: spineIndex, blockId: blockId)
        }
        if let value = message["viewPrefs"] as? [String: Any] {
            guard let scale = value["fontScale"] as? Double, scale.isFinite, (0.5...3).contains(scale),
                  let lineHeight = value["lineHeight"] as? Double, lineHeight.isFinite, (1...3).contains(lineHeight),
                  let dark = value["dark"] as? Bool else { throw LibraryError.invalidFile }
            viewPrefs = Preferences(fontScale: scale, lineHeight: lineHeight, dark: dark)
        }
    }
}

enum DocumentConversionPolicy {
    static func completesSource(sourceExtension: String, destinationKind: String, conversionSave: Bool, savedRevision: Int?, currentRevision: Int) -> Bool {
        ["csv", "tsv", "xls", "ods"].contains(sourceExtension.lowercased()) && destinationKind.lowercased() == "xlsx" && conversionSave && savedRevision == currentRevision
    }
}
