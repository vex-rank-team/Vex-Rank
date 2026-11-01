import Foundation

/// Settings the Worker can change without shipping a new binary.
///
/// Every field here used to be a constant in the source, and every one of them
/// changes on somebody else's schedule: the season id rolls over when VEX says
/// so, the cache lifetimes want shortening during a live final, and a note to
/// readers cannot wait on App Store review. Going through review to change an
/// integer is the problem this type exists to avoid.
///
/// What it deliberately does not do is deliver code. iOS cannot load new native
/// code at runtime and the App Store guidelines forbid trying, so this is
/// configuration and copy. Anything that needs new views still needs a build;
/// `update` is how the app tells its reader that one exists.
public struct AppConfig: Sendable, Equatable {
    /// RobotEvents season id the live tabs read.
    public var currentSeason: Int
    /// Program slug used for links to the official site.
    public var program: String
    /// How long a response stays good, by kind. Tunable because the right
    /// answer differs between a quiet Tuesday and the last match of a final.
    public var eventCacheSeconds: Double
    public var directoryCacheSeconds: Double
    public var defaultCacheSeconds: Double
    /// Named switches. Free-form on purpose: adding a flag must not itself
    /// require the app update that flags exist to avoid.
    public var flags: [String: Bool]
    public var update: UpdateInfo
    public var announcement: Announcement?
    /// Per-program settings, keyed by program code. Missing for configs that
    /// predate VEX IQ, in which case each program uses its built-in season.
    public var programs: [String: ProgramSettings] = [:]

    /// The season the live tabs read for `program`. V5 keeps reading the
    /// top-level `currentSeason` so old and new configs agree about it.
    public func currentSeason(for program: Program) -> Int {
        if let season = programs[program.rawValue]?.currentSeason { return season }
        return program == .v5rc ? currentSeason : program.defaultSeason
    }

    public func flag(_ name: String, default fallback: Bool = false) -> Bool {
        flags[name] ?? fallback
    }

    /// What the app falls back to with no network, no stored config, or a
    /// config the server sent that did not survive validation.
    ///
    /// These are the values the binary was built with, so a totally silent
    /// config service leaves the app exactly as well off as it would have been
    /// without one.
    public static let bundled = AppConfig(
        currentSeason: 204,
        program: "V5RC",
        eventCacheSeconds: 30,
        directoryCacheSeconds: 3600,
        defaultCacheSeconds: 120,
        flags: [:],
        update: UpdateInfo(),
        announcement: nil
    )
}

/// Settings that differ between V5 and VEX IQ.
public struct ProgramSettings: Codable, Sendable, Equatable {
    public var currentSeason: Int

    public init(currentSeason: Int) { self.currentSeason = currentSeason }
}

/// The build the service would like the reader to be on.
public struct UpdateInfo: Sendable, Equatable {
    public var latestBuild: Int = 0
    /// Builds below this are told, firmly, that they are out of date - but are
    /// never locked out. A minimum that is set too high, or set against a build
    /// number that turns out not to exist, would otherwise brick every install
    /// with no way to take it back: the config that could fix it is read by the
    /// app it just disabled. A banner that will not dismiss gets the same
    /// message across and cannot strand anyone.
    public var minimumBuild: Int = 0
    public var version: String? = nil
    public var url: String? = nil
    public var notes: String? = nil

    public var link: URL? { url.flatMap(URL.init(string:)) }

    public func status(forBuild build: Int) -> UpdateStatus {
        if build < minimumBuild { return .required }
        if build < latestBuild { return .available }
        return .current
    }
}

public enum UpdateStatus: Sendable, Equatable {
    case current
    /// A newer build exists. Worth a dismissible nudge.
    case available
    /// Old enough that the service would rather not support it.
    case required
}

/// A short message from the service, shown once until dismissed.
public struct Announcement: Sendable, Equatable, Codable, Identifiable {
    /// Dismissal is remembered against this, so changing the text without
    /// changing the id will not show it to anyone who has already waved it away.
    public let id: String
    public let title: String
    public let body: String?
    public let url: String?

    public var link: URL? { url.flatMap(URL.init(string:)) }

    public init(id: String, title: String, body: String? = nil, url: String? = nil) {
        self.id = id
        self.title = title
        self.body = body
        self.url = url
    }
}

// MARK: - Wire format

extension AppConfig: Codable {
    /// Every field is optional coming in, and anything absent, malformed or
    /// out of range keeps the bundled value. A config is pushed without review
    /// by definition, so the client treats it as a suggestion it validates
    /// rather than an instruction it obeys: the cost of a typo in a JSON file
    /// should be one setting ignored, not an app that will not load.
    public init(from decoder: Decoder) throws {
        let wire = try decoder.container(keyedBy: CodingKeys.self)
        let base = AppConfig.bundled

        func number(_ key: CodingKeys) -> Double? {
            try? wire.decodeIfPresent(Double.self, forKey: key)
        }

        // Season ids are small and monotonic; 204 is the 2026-27 season. A
        // value outside this window is a mistake, and honouring it would point
        // every live tab at a season with no events in it.
        let season = (try? wire.decodeIfPresent(Int.self, forKey: .currentSeason)) ?? nil
        if let season, (150...400).contains(season) {
            currentSeason = season
        } else {
            currentSeason = base.currentSeason
        }

        let slug = (try? wire.decodeIfPresent(String.self, forKey: .program)) ?? nil
        program = slug.flatMap { $0.range(of: "^[A-Za-z0-9]{2,12}$", options: .regularExpression) != nil ? $0 : nil }
            ?? base.program

        // A zero here would turn every scroll into a network round trip and
        // put the app straight into the rate limiter.
        eventCacheSeconds = AppConfig.clamp(number(.eventCacheSeconds), 5, 86_400, base.eventCacheSeconds)
        directoryCacheSeconds = AppConfig.clamp(number(.directoryCacheSeconds), 60, 604_800, base.directoryCacheSeconds)
        defaultCacheSeconds = AppConfig.clamp(number(.defaultCacheSeconds), 5, 86_400, base.defaultCacheSeconds)

        flags = ((try? wire.decodeIfPresent([String: Bool].self, forKey: .flags)) ?? nil) ?? base.flags
        update = ((try? wire.decodeIfPresent(UpdateInfo.self, forKey: .update)) ?? nil) ?? base.update
        announcement = ((try? wire.decodeIfPresent(Announcement.self, forKey: .announcement)) ?? nil)
            ?? base.announcement

        // Each season is held to the same window as `currentSeason`; a bad
        // one is dropped and that program falls back to its built-in season.
        let wirePrograms = ((try? wire.decodeIfPresent([String: ProgramSettings].self, forKey: .programs)) ?? nil) ?? [:]
        programs = wirePrograms.filter { Program(rawValue: $0.key) != nil && (150...400).contains($0.value.currentSeason) }
    }

    static func clamp(_ value: Double?, _ low: Double, _ high: Double, _ fallback: Double) -> Double {
        guard let value, value.isFinite else { return fallback }
        return Swift.min(Swift.max(value, low), high)
    }
}

extension UpdateInfo: Codable {
    public init(from decoder: Decoder) throws {
        let wire = try decoder.container(keyedBy: CodingKeys.self)
        latestBuild = ((try? wire.decodeIfPresent(Int.self, forKey: .latestBuild)) ?? nil) ?? 0
        // A minimum above the latest build the same config advertises is a
        // typo: it would push every reader towards a build that is not offered.
        minimumBuild = Swift.min(((try? wire.decodeIfPresent(Int.self, forKey: .minimumBuild)) ?? nil) ?? 0, latestBuild)
        version = (try? wire.decodeIfPresent(String.self, forKey: .version)) ?? nil
        url = (try? wire.decodeIfPresent(String.self, forKey: .url)) ?? nil
        notes = (try? wire.decodeIfPresent(String.self, forKey: .notes)) ?? nil
    }
}
