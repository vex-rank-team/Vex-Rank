import Foundation

/// Models mirror the live responses from the VEXRank Worker exactly as served;
/// field names and optionality were taken from captured responses rather than
/// assumed, and the same captures back the tests.
///
/// Numeric fields that the API can return as either integer or fractional are
/// decoded as `Double` and exposed rounded, so a change of 44 vs 44.25 does not
/// break decoding.

// MARK: - Rankings

public struct RankingsResponse: Codable, Sendable {
    public let rankings: [TeamRanking]
    /// VEX IQ: when the published VIQCR ratings were computed.
    public let asOf: String?

    /// Rankings in rank order, which is the order the rows appear to follow.
    ///
    /// The deployed Worker ranks by `rating - confidence` - an uncertainty-aware
    /// measure - while also returning the raw `rating`. So one of the two
    /// columns is always going to look out of order.
    ///
    /// Ordering by `rank` is the lesser evil: the leading element of every row
    /// then reads 1, 2, 3, and the rating varies with its own uncertainty
    /// printed beside it, which explains the variation. Sorting by rating
    /// instead makes the ratings tidy but prints "#2" above "#1", which no
    /// reader will accept.
    public var sortedForDisplay: [TeamRanking] {
        rankings.sorted {
            $0.rank == $1.rank ? TeamNumber.precedes($0.number, $1.number) : $0.rank < $1.rank
        }
    }
    public let eventsProcessed: Int
    public let matchesProcessed: Int
    public let method: String?
    public let modelVersion: String?
    public let season: String?
    public let updatedAt: String?
    /// "pending" while the VEX IQ rating is being written; absent for V5.
    public let ratingStatus: String?
    /// The program the server answered for. Absent from servers that predate
    /// VEX IQ, which answer an IQ request with V5 rows.
    public let program: String?
}

public struct FormEntry: Codable, Sendable, Hashable {
    public let event: String
    public let change: Int
    public let tier: String?
    public let champion: Bool?
}

public struct TeamRanking: Codable, Sendable, Identifiable, Hashable {
    public let id: Int
    public let rank: Int
    public let number: String
    public let name: String
    public let region: String?
    public let eventRegion: String?
    public let country: String?
    public let rating: Int
    public let confidence: Int
    public let change: Int
    public let record: String?
    public let events: Int
    public let matches: Int?
    public let grade: String?
    public let organization: String?
    public let opr: Double?
    public let dpr: Double?
    public let ccwm: Double?
    public let consistency: Int?
    public let skills: Int?
    public let seasonId: Int?
    public let season: String?
    public let form: [FormEntry]?
    /// VEX IQ (VIQCR) only. Provisional rows lack evidence in some component.
    public let provisional: Bool?
    public let provisionalReasons: [String]?
    /// World rank among confirmed (non-provisional) teams; nil when provisional.
    public let confirmedRank: Int?
    /// Partner-adjusted consistency, described: "repeatable-positive", etc.
    public let signal: String?
    public let partners: Int?
    /// Teamwork, driving, coding and consistency, each in rating points.
    public let components: [String: ComponentScore]?

    /// The ranking list is ordered by `rating`, and the table shows `rating`.
    /// Kept as a named value so any future ordering change is one place, not
    /// scattered through the views - the web app previously sorted by
    /// `rating - confidence` while displaying `rating`, which put 203 of 585
    /// teams visually out of order.
    public var sortKey: Int { rating }
}

// MARK: - Team profile

public struct TeamProfileResponse: Codable, Sendable {
    public let team: TeamIdentity
    public let ratingHistory: [RatingPoint]
    public let events: [TeamEvent]?
    public let rankings: [TeamEventStanding]?
    public let awards: [Award]?
    public let skills: [SkillRun]?
    /// Grade can change between seasons (a team moves up), so the API keys it
    /// by season rather than putting one value on the identity.
    public let seasonGrades: [String: String]?
    public let modelVersion: String?
    public let loadedSeasonIds: [Int]?
    /// The program the server answered for; see `RankingsResponse.program`.
    public let program: String?
    /// "pending" while the VEX IQ rating is being written.
    public let ratingStatus: String?
}

/// The seasons this profile has results for, newest first - what the season
/// picker offers.
extension TeamProfileResponse {
    public struct Season: Identifiable, Sendable, Hashable {
        public let id: Int
        public let name: String
        /// "2026-27 Override" rather than the API's full product name.
        public var shortName: String {
            guard let colon = name.lastIndex(of: ":") else { return name }
            let game = name[name.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            guard let years = name.range(of: "20[0-9]{2}-20[0-9]{2}", options: .regularExpression) else { return game }
            let span = name[years].replacingOccurrences(of: "-20", with: "\u{2013}")
            return "\(span) \(game)"
        }
    }

    public var seasons: [Season] {
        var seen = Set<Int>()
        var found: [Season] = []
        // Events first, then the rating history, so a season with results but
        // no rated event still appears.
        for (id, name) in (events ?? []).map({ ($0.seasonId, $0.season) })
            + ratingHistory.map({ ($0.seasonId, $0.event) }) {
            guard let id, seen.insert(id).inserted else { continue }
            found.append(Season(id: id, name: name ?? "Season \(id)"))
        }
        return found.sorted { $0.id > $1.id }
    }

    public func grade(forSeason id: Int) -> String {
        seasonGrades?[String(id)] ?? team.grade
    }
}

public struct TeamEvent: Codable, Sendable, Identifiable, Hashable {
    public let id: Int
    public let sku: String?
    public let name: String
    public let start: String?
    public let end: String?
    public let season: String?
    public let seasonId: Int?
    public let level: String?
    public let location: String?
    /// The API writes "No elimination result" rather than omitting the field.
    public let elimination: String?

    /// The calendar day the event starts on. Read as the day it names rather
    /// than as an instant, so it prints the same day everywhere.
    public var day: Date? { EventDay.parse(start) }

    public var eliminationResult: String? {
        guard let elimination, !elimination.isEmpty,
              !elimination.localizedCaseInsensitiveContains("no elimination") else { return nil }
        return elimination
    }
}

/// How the team finished qualification at one event.
public struct TeamEventStanding: Codable, Sendable, Hashable {
    public let event: String?
    public let eventId: Int?
    public let seasonId: Int?
    public let division: String?
    public let rank: Int
    public let wins: Int
    public let losses: Int
    public let ties: Int
    public let wp: Int?
    public let ap: Int?
    public let sp: Int?
    public let highScore: Int?
    /// VEX IQ's average teamwork score, when the server passes it through.
    public let averagePoints: Double?

    public var record: String { "\(wins)\u{2013}\(losses)\u{2013}\(ties)" }
}

public struct TeamIdentity: Codable, Sendable, Hashable {
    public let id: Int
    public let number: String
    public let name: String
    public let organization: String
    public let robot: String
    public let grade: String
    public let region: String
    public let country: String
    public let registered: Bool
    public let active: Bool
    public let currentSeasonEvents: Int
    public let seasons: Int
}

public struct RatingPoint: Codable, Sendable, Identifiable, Hashable {
    public let seasonId: Int
    public let eventId: Int
    public let event: String
    public let eventDate: String
    public let change: Int
    public let rawChange: Double?
    public let rating: Int
    public let matches: Int
    public let tier: String?
    public let champion: Bool?

    public var id: Int { eventId }

    /// `eventDate` arrives as an ISO-8601 string with an offset.
    public var date: Date? { ISO8601DateFormatter().date(from: eventDate) }
}

public struct Award: Codable, Sendable, Hashable {
    public let title: String?
    public let event: String?
    public let eventId: Int?
    public let seasonId: Int?
}

public struct SkillRun: Codable, Sendable, Hashable {
    public let event: String?
    public let eventId: Int?
    public let type: String?
    public let score: Int?
    public let attempts: Int?
    public let rank: Int?
    public let seasonId: Int?
}

/// A season's best skills scores. Combined is the best driver-plus-programming
/// at a *single* event, not the sum of two bests from different events - that
/// is how the official standings read it.
public struct SeasonSkills: Sendable, Hashable {
    public let driver: Int
    public let programming: Int
    public let combined: Int

    public init(runs: [SkillRun]) {
        var byEvent: [Int: (driver: Int, programming: Int)] = [:]
        var bestDriver = 0
        var bestProgramming = 0
        for run in runs {
            guard let score = run.score, score > 0 else { continue }
            var pair = byEvent[run.eventId ?? -1] ?? (0, 0)
            switch run.type {
            case "driver":
                bestDriver = max(bestDriver, score)
                pair.driver = max(pair.driver, score)
            case "programming":
                bestProgramming = max(bestProgramming, score)
                pair.programming = max(pair.programming, score)
            default: continue
            }
            byEvent[run.eventId ?? -1] = pair
        }
        self.driver = bestDriver
        self.programming = bestProgramming
        self.combined = byEvent.values.map { $0.driver + $0.programming }.max() ?? 0
    }
}

/// One VIQCR component of a team's rating.
public struct ComponentScore: Codable, Sendable, Hashable {
    public let points: Int
    public let sd: Int?
}
