import Foundation

/// The last good response body for a handful of screens, kept on disk.
///
/// The in-memory response cache dies with the process, so every cold launch
/// showed a spinner while it fetched a table that had not meaningfully changed
/// since the reader last looked. The bytes are stored rather than the decoded
/// value, so nothing here has to be `Encodable` and a model change cannot write
/// a file the next build misreads - a snapshot that fails to decode is simply
/// ignored and refetched.
enum Snapshots {
    private static var directory: URL? {
        try? FileManager.default.url(for: .cachesDirectory, in: .userDomainMask,
                                     appropriateFor: nil, create: true)
            .appendingPathComponent("VEXRankSnapshots", isDirectory: true)
    }

    private static func location(_ name: String) -> URL? {
        guard let directory else { return nil }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent(name).appendingPathExtension("json")
    }

    static func save(_ data: Data, as name: String) {
        guard let location = location(name) else { return }
        // Caches are the right home: the reader loses nothing if the system
        // reclaims the space, because every one of these can be refetched.
        try? data.write(to: location, options: .atomic)
    }

    static func load<T: Decodable>(_ type: T.Type, named name: String, decoder: JSONDecoder) -> T? {
        guard let location = location(name), let data = try? Data(contentsOf: location) else { return nil }
        return try? decoder.decode(type, from: data)
    }
}
