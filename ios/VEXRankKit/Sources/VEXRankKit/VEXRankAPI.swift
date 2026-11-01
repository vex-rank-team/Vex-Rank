import Foundation

/// The selected program, readable from any thread.
final class ProgramSelection: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Program = .v5rc
    var value: Program {
        get { lock.lock(); defer { lock.unlock() }; return stored }
        set { lock.lock(); stored = newValue; lock.unlock() }
    }
}

public enum VEXRankError: LocalizedError, Sendable {
    case unreachable
    case upstream(status: Int)
    case decoding(String)

    public var errorDescription: String? {
        switch self {
        case .unreachable:
            return "Could not reach the ranking service. Check your connection and try again."
        case .upstream(let status):
            return "The ranking service returned an error (\(status)). Please retry."
        case .decoding(let detail):
            return "The ranking service sent something unexpected. \(detail)"
        }
    }
}

/// Client for the VEXRank Worker.
///
/// Deliberately thin: the Worker owns the VCR maths. Reimplementing the rating
/// model here would give two sources of truth for the same number, and that has
/// already gone wrong once on the web, where the live route and the archive
/// scripts used different confidence floors and silently disagreed.
public actor VEXRankAPI {
    public static let defaultBaseURL = URL(string: "https://vexrank-api-test.qiansteven54.workers.dev")!

    /// The instance the screens use.
    ///
    /// It has to be one instance, for two reasons. The response cache below
    /// only coalesces requests it can see, and screens that each built their
    /// own client shared nothing - opening a team from an event refetched the
    /// event the previous screen already had. And the remote config has to
    /// reach every caller, which it cannot do if each one holds a private copy
    /// of the season it was built with.
    public static let shared = VEXRankAPI(baseURL: launchBaseURL ?? defaultBaseURL)

    /// `-api-base http://127.0.0.1:8787` points a debug build at a local
    /// server, for checking screens against responses the deployed service
    /// does not send yet. Compiled out of release builds, so a shipped app
    /// cannot be redirected.
    static var launchBaseURL: URL? {
        #if DEBUG
        guard let index = CommandLine.arguments.firstIndex(of: "-api-base"),
              CommandLine.arguments.indices.contains(index + 1) else { return nil }
        return URL(string: CommandLine.arguments[index + 1])
        #else
        return nil
        #endif
    }

    private let baseURL: URL
    private let session: URLSession
    private let decoder = JSONDecoder()

    public init(baseURL: URL = VEXRankAPI.defaultBaseURL, session: URLSession? = nil) {
        self.baseURL = baseURL
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.default
            // The service cold-starts; a request that waits beats one that fails.
            configuration.waitsForConnectivity = true
            configuration.timeoutIntervalForRequest = 30
            configuration.timeoutIntervalForResource = 90
            // Big enough to hold the team directory, which is the whole point.
            // The shared cache refuses any single response over a fraction of
            // its capacity, so at the default size the one response that most
            // needs storing - 11 MB of JSON that changes once a day - was the
            // one response that never got stored, and every launch downloaded
            // it again. With room for it, the second launch revalidates with
            // the ETag and is answered "unchanged" instead.
            configuration.urlCache = URLCache(memoryCapacity: 32 * 1024 * 1024,
                                              diskCapacity: 512 * 1024 * 1024)
            self.session = URLSession(configuration: configuration)
        }
    }

    /// Responses already in hand, and requests already in flight.
    ///
    /// Screens fetch the same things: opening a team from an event asks for
    /// that event's detail to find the standing, then asks again for the
    /// schedule, and the event screen behind it already had it. Without this
    /// the same 180KB payload was fetched three or four times in a single
    /// journey through the app.
    private var cached: [String: (stored: Date, value: Any)] = [:]
    private var inFlight: [String: Task<Any, Error>] = [:]

    /// Season and cache lifetimes come from here rather than from constants,
    /// so a season rollover is a config push instead of an App Store release.
    private var config: AppConfig = .bundled

    public func apply(_ config: AppConfig) { self.config = config }

    /// The program requests are for. One client serves both, so the screens
    /// keep calling `rankings()` and `events()`; the program goes on the path,
    /// which also keeps the two programs' cached responses apart.
    ///
    /// Held in a lock rather than as actor state so it can be set
    /// synchronously: the root view sets it in the same step that rebuilds the
    /// screens, and an `await` there would let the new screens fetch first.
    private nonisolated let selection = ProgramSelection()
    private var program: Program { selection.value }

    public nonisolated func use(_ program: Program) { selection.value = program }

    /// The season the app treats as current for the program, from the remote config.
    public func currentSeason() -> Int { config.currentSeason(for: program) }

    /// `path` with the program on it. V5 paths are left exactly as they were,
    /// so every V5 cache entry and snapshot keeps its name.
    func scoped(_ path: String) -> String {
        guard program.isIQ else { return path }
        return path + (path.contains("?") ? "&" : "?") + "program=VIQRC"
    }

    /// The settings document. Deliberately not retried hard and not cached in
    /// the response cache: the store keeps its own copy on disk, and a config
    /// the app could not fetch is one it already has an answer for.
    public func appConfig() async throws -> AppConfig {
        try await get("/api/app-config", attempts: 2, fresh: true)
    }

    /// How long a response stays good. Short for anything that changes during
    /// a competition, long for the directory, which is rebuilt daily.
    private func lifetime(of path: String) -> TimeInterval {
        if path.hasPrefix("/api/team-directory") { return config.directoryCacheSeconds }
        if path.hasPrefix("/api/events/") { return config.eventCacheSeconds }
        return config.defaultCacheSeconds
    }

    /// Which responses are worth keeping between launches: the ones that
    /// change slowly and that a screen would otherwise open on a spinner for -
    /// the world ranking the app opens on, the season's events list, and each
    /// team profile the reader has opened. Every one is drawn first and then
    /// replaced by the fresh copy. An event's standings are deliberately not
    /// kept: during a live final, yesterday's copy is exactly the wrong answer.
    static func snapshotName(for path: String) -> String? {
        if path == liveRankingsPath { return "rankings" }
        guard let components = URLComponents(string: path) else { return nil }
        // VEX IQ snapshots get their own names: a team number is not unique
        // across programs, and a V5 table must never be drawn as IQ's.
        let iq = components.queryItems?.contains { $0.name == "program" && $0.value == "VIQRC" } ?? false
        let suffix = iq ? "-VIQRC" : ""
        if iq && components.path == "/api/rankings" && components.queryItems?.contains(where: { $0.name == "season" }) != true {
            return "rankings" + suffix
        }
        let season = components.queryItems?.first { $0.name == "season" }?.value
        if components.path == "/api/events", let season {
            return "events-" + safe(season) + suffix
        }
        if components.path.hasPrefix("/api/teams/"), let season {
            let number = String(components.path.dropFirst("/api/teams/".count))
            return "team-" + safe(number.uppercased()) + "-" + safe(season) + suffix
        }
        return nil
    }

    /// A file name out of API input: letters and digits only.
    private static func safe(_ text: String) -> String {
        String(text.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.map(Character.init))
    }

    private static let liveRankingsPath = "/api/rankings?data=v49"

    /// The world ranking as it was when the app last saw it, for drawing the
    /// first screen while the current one is on its way. `nil` on a first run.
    public func lastKnownRankings() -> RankingsResponse? {
        guard let name = Self.snapshotName(for: scoped(Self.liveRankingsPath)) else { return nil }
        return Snapshots.load(RankingsResponse.self, named: name, decoder: decoder)
    }

    /// The season's events as last seen, for the same reason.
    public func lastKnownEvents(season: Int? = nil) -> EventsResponse? {
        guard let name = Self.snapshotName(for: scoped("/api/events?season=\(season ?? currentSeason())&classification=v49")) else { return nil }
        return Snapshots.load(EventsResponse.self, named: name, decoder: decoder)
    }

    /// A profile as it was when the reader last opened it, so reopening a team
    /// draws at once instead of waiting on the network a second time.
    public func lastKnownTeamProfile(number: String, season: Int) -> TeamProfileResponse? {
        let encoded = number.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? number
        guard let name = Self.snapshotName(for: scoped("/api/teams/\(encoded)?profile=v8&season=\(season)")) else { return nil }
        return Snapshots.load(TeamProfileResponse.self, named: name, decoder: decoder)
    }

    public func rankings(season: Int? = nil) async throws -> RankingsResponse {
        var path = Self.liveRankingsPath
        if let season { path += "&season=\(season)" }
        return try await get(scoped(path))
    }

    public func events(season: Int? = nil) async throws -> EventsResponse {
        try await get(scoped("/api/events?season=\(season ?? currentSeason())&classification=v49"))
    }

    /// The whole directory in one response - about 11 MB and 56,000 teams, so
    /// it gets the long resource timeout and a single attempt: retrying a
    /// download that size on a phone connection costs more than it recovers.
    public func teamDirectory() async throws -> TeamDirectoryResponse {
        try await get(scoped("/api/team-directory"), attempts: 1)
    }

    public func skills(season: Int? = nil) async throws -> SkillsResponse {
        try await get(scoped("/api/skills?season=\(season ?? currentSeason())"))
    }

    public func eventDetail(id: String, fresh: Bool = false) async throws -> EventDetailResponse {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await get("/api/events/\(encoded)?results=v49", fresh: fresh)
    }

    public func teamProfile(number: String, season: Int? = nil) async throws -> TeamProfileResponse {
        let encoded = number.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? number
        var path = "/api/teams/\(encoded)?profile=v8"
        if let season { path += "&season=\(season)" }
        return try await get(scoped(path))
    }

    // MARK: - Transport

    /// Retries 5xx and transport failures with exponential backoff and jitter.
    /// The service returns intermittent 502s on cold start - measured on the web
    /// as 502, 200, 200, 200, 200 across five consecutive calls - so a single
    /// failure should not reach the user.
    /// `fresh` is for a reader who has just pulled to refresh at a live event.
    ///
    /// It does two things, because there are two caches in the way. URLSession
    /// is told to ignore what it has, and a unique parameter is added so the
    /// edge cache sees a key it has never held - the event route is served with
    /// max-age and stale-while-revalidate, which is right for browsing and far
    /// too coarse for a match that was scored a minute ago.
    private func get<T: Decodable>(_ path: String, attempts: Int = 3, fresh: Bool = false) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw VEXRankError.unreachable
        }

        var request = URLRequest(url: url)
        if fresh {
            request.cachePolicy = .reloadIgnoringLocalCacheData
            // Tells the Worker not to answer from its own expired copy. Ordinary
            // browsing is served that copy immediately while it refreshes behind
            // the reader, which is what makes a screen open at once; someone who
            // pulled to refresh at a live event is asking a different question
            // and is willing to wait for the real answer.
            request.setValue("1", forHTTPHeaderField: "X-VEXRank-Refresh")
        }

        // A second caller for the same thing waits on the first rather than
        // starting its own.
        if !fresh {
            if let hit = cached[path], Date().timeIntervalSince(hit.stored) < lifetime(of: path),
               let value = hit.value as? T {
                return value
            }
            if let running = inFlight[path] {
                if let value = try await running.value as? T { return value }
            }
        }

        let work = Task<Any, Error> { [self] in
            try await fetch(request, path: path, attempts: attempts) as T
        }
        inFlight[path] = work
        defer { inFlight[path] = nil }
        let value = try await work.value
        guard let typed = value as? T else { throw VEXRankError.unreachable }
        cached[path] = (Date(), typed)
        return typed
    }

    private func fetch<T: Decodable>(_ request: URLRequest, path: String, attempts: Int) async throws -> T {
        var lastError: VEXRankError = .unreachable
        for attempt in 0..<attempts {
            do {
                let (data, response) = try await session.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0

                if (200..<300).contains(status) {
                    do {
                        let value = try decoder.decode(T.self, from: data)
                        // Only once it has decoded: a body that this build
                        // cannot read is not worth keeping for the next launch.
                        if let name = Self.snapshotName(for: path) { Snapshots.save(data, as: name) }
                        return value
                    } catch {
                        // Decoding failures are deterministic: retrying cannot help.
                        throw VEXRankError.decoding(String(describing: error))
                    }
                }
                // 4xx will not fix itself either.
                guard status >= 500 else { throw VEXRankError.upstream(status: status) }
                lastError = .upstream(status: status)
            } catch let error as VEXRankError {
                throw error
            } catch {
                lastError = .unreachable
            }

            if attempt < attempts - 1 {
                let backoff = 0.25 * pow(2, Double(attempt)) + Double.random(in: 0...0.12)
                try? await Task.sleep(nanoseconds: UInt64(backoff * 1_000_000_000))
            }
        }
        throw lastError
    }
}
