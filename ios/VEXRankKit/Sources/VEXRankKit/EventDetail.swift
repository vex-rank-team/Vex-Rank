import Foundation

public struct EventDetailResponse: Codable, Sendable {
    public let event: EventDetail
    public let teams: [EventTeam]
    public let divisions: [Division]
    public let awards: [EventAward]
    public let skills: [EventSkill]
}

public struct EventDetail: Codable, Sendable {
    public let id: Int
    public let sku: String?
    public let name: String
    public let start: String?
    public let end: String?
    public let location: EventLocation?
    /// Which program the event belongs to; VEX IQ is id 41.
    public let program: EventProgram?
    /// The API's own link to the event on the official site.
    public let officialUrl: String?

    public var official: URL? { OfficialLinks.event(officialUrl: officialUrl, sku: sku) }

    /// The calendar day the event starts on.
    public var day: Date? { EventDay.parse(start) }

    public var venueLine: String {
        guard let location else { return "" }
        return [location.venue, location.city, location.region, location.country]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
            .joined(separator: ", ")
    }
}

public struct EventProgram: Codable, Sendable, Hashable {
    public let id: Int?
    public let code: String?
}

public struct EventLocation: Codable, Sendable {
    public let venue: String?
    public let city: String?
    public let region: String?
    public let country: String?
}

public struct EventTeam: Codable, Sendable, Identifiable, Hashable {
    public let id: Int
    public let number: String
    public let name: String?
    public let organization: String?
    public let grade: String?
}

public struct Division: Codable, Sendable, Identifiable, Hashable {
    public let id: Int
    public let name: String
    public let rankings: [DivisionRanking]
    public let matches: [DivisionMatch]?
}

public struct DivisionRanking: Codable, Sendable, Identifiable, Hashable {
    public let rank: Int
    public let team: DivisionTeam
    public let wins: Int
    public let losses: Int
    public let ties: Int
    public let wp: Int?
    public let ap: Int?
    public let sp: Int?
    public let highScore: Int?
    /// VEX IQ's average teamwork score, when the server passes it through.
    public let averagePoints: Double?

    public var id: Int { team.id }
    public var record: String { "\(wins)–\(losses)–\(ties)" }
}

public struct DivisionTeam: Codable, Sendable, Hashable {
    public let id: Int
    /// The API puts the team *number* in `name` here, and `code` is usually null
    /// - named as served rather than renamed, so the mapping stays obvious.
    public let name: String
    public let code: String?
}

public struct DivisionMatch: Codable, Sendable, Identifiable, Hashable {
    public let id: Int
    public let name: String?
    public let round: Int?
    public let instance: Int?
    public let matchnum: Int?
    public let field: String?
    public let scheduled: String?
    public let alliances: [MatchAlliance]?

    /// Whether the match has been played.
    ///
    /// Deliberately not the API's `scored` flag: that is false on completed
    /// matches in the captured payload (every qualifier of a finished event
    /// reads `scored: false`), so trusting it would print "Not played" beside a
    /// real 153-123 result. A posted score is the honest signal.
    public var isPlayed: Bool {
        (alliances ?? []).contains { ($0.score ?? -1) >= 0 }
            && (alliances ?? []).contains { ($0.score ?? 0) > 0 }
    }

    public var red: MatchAlliance? { alliances?.first { $0.color == "red" } }
    public var blue: MatchAlliance? { alliances?.first { $0.color == "blue" } }

    /// "red", "blue", or nil for a tie or an unplayed match.
    public var winner: String? {
        guard isPlayed, let red = red?.score, let blue = blue?.score, red != blue else { return nil }
        return red > blue ? "red" : "blue"
    }
}

public struct MatchAlliance: Codable, Sendable, Hashable {
    public let color: String?
    public let score: Int?
    public let teams: [MatchTeamSlot]?

    /// Team numbers on this alliance, in the order served.
    public var numbers: [String] {
        (teams ?? []).compactMap { $0.team?.name }.filter { !$0.isEmpty }
    }
}

public struct MatchTeamSlot: Codable, Sendable, Hashable {
    public let team: DivisionTeam?
    public let sitting: Bool?
}

extension DivisionMatch {
    /// Whether this match counts toward the qualification standings.
    public var isQualification: Bool {
        round == 2 || (name?.localizedCaseInsensitiveContains("qual") ?? false)
    }
}

extension Division {
    /// Qualification matches in play order.
    public var qualification: [DivisionMatch] {
        (matches ?? [])
            .filter(\.isQualification)
            .sorted { ($0.matchnum ?? 0) < ($1.matchnum ?? 0) }
    }

    /// Elimination matches, earliest round first.
    ///
    /// Round 6 is the round of 16 and sorts *before* the quarter-finals at 3,
    /// which is why this cannot just sort on the round number - the API's
    /// numbering is not chronological.
    public var elimination: [DivisionMatch] {
        (matches ?? [])
            .filter { match in
                guard let round = match.round, round >= 3 else { return false }
                let name = match.name ?? ""
                return !name.localizedCaseInsensitiveContains("qual")
                    && !name.localizedCaseInsensitiveContains("practice")
            }
            .sorted {
                let a = Self.bracketOrder($0.round), b = Self.bracketOrder($1.round)
                return a == b ? ($0.matchnum ?? 0) < ($1.matchnum ?? 0) : a < b
            }
    }

    static func bracketOrder(_ round: Int?) -> Int {
        guard let round else { return .max }
        return round == 6 ? 0 : round
    }
}

public struct EventAward: Codable, Sendable, Hashable {
    public let title: String?
    public let teamWinners: [AwardWinner]?

    enum CodingKeys: String, CodingKey {
        case title
        case teamWinners = "teamWinners"
    }
}

public struct AwardWinner: Codable, Sendable, Hashable {
    public let team: EventTeamRef?
}

public struct EventTeamRef: Codable, Sendable, Hashable {
    public let id: Int?
    public let name: String?
}

public struct EventSkill: Codable, Sendable, Hashable {
    public let rank: Int?
    public let score: Int?
    public let type: String?
    public let team: EventTeamRef?
}

/// One team's combined skills result at an event.
public struct EventSkillLeader: Identifiable, Sendable, Hashable {
    public var id: String { number }
    public let number: String
    public let driver: Int
    public let programming: Int
    public var total: Int { driver + programming }
}

extension EventDetailResponse {
    /// The API serves one row per team *per skills type* ("driver",
    /// "programming"), but the standing people read is the combined total, so
    /// the rows are folded per team and ranked on the sum.
    public var skillsLeaderboard: [EventSkillLeader] {
        var driver: [String: Int] = [:]
        var programming: [String: Int] = [:]
        for entry in skills {
            guard let number = entry.team?.name, !number.isEmpty, let score = entry.score else { continue }
            switch entry.type {
            case "driver": driver[number] = max(driver[number] ?? 0, score)
            case "programming": programming[number] = max(programming[number] ?? 0, score)
            default: continue
            }
        }
        return Set(driver.keys).union(programming.keys)
            .map { EventSkillLeader(number: $0, driver: driver[$0] ?? 0, programming: programming[$0] ?? 0) }
            .sorted { $0.total == $1.total ? $0.number < $1.number : $0.total > $1.total }
    }
}

/// What the detail screen needs to open an event, so it can be reached from
/// the events feed and from a team's competition history alike - those two
/// endpoints describe an event with different shapes, and neither is worth
/// carrying into navigation whole.
public struct EventRef: Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let day: Date?
    public let place: String
    public let isUpcoming: Bool
    /// The team whose profile the reader came from, when they came from one.
    /// The event screen offers that team's matches behind a button rather than
    /// listing them: the screen is about the event, not about one team in it.
    public let focusTeam: String?

    public init(id: String, name: String, day: Date?, place: String,
                isUpcoming: Bool, focusTeam: String? = nil) {
        self.id = id
        self.name = name
        self.day = day
        self.place = place
        self.isUpcoming = isUpcoming
        self.focusTeam = focusTeam
    }

    public func focused(on team: String) -> EventRef {
        EventRef(id: id, name: name, day: day, place: place,
                 isUpcoming: isUpcoming, focusTeam: team)
    }
}

/// A team to open, and where the reader came from.
///
/// Navigating by the bare number lost that context, so a profile opened from
/// an event could not offer the way back into that team's matches there. The
/// origin travels with the destination instead of being inferred.
public struct TeamRef: Sendable, Hashable, Identifiable {
    public let number: String
    /// The event whose team list the reader came from, when they came from one.
    public let fromEvent: EventRef?

    public var id: String { "\(number)-\(fromEvent?.id ?? "")" }

    public init(_ number: String, fromEvent: EventRef? = nil) {
        self.number = number
        self.fromEvent = fromEvent
    }
}

/// One team's matches at one event - a screen of its own, reached from the
/// event by a button.
public struct TeamEventRef: Sendable, Hashable, Identifiable {
    public let event: EventRef
    public let team: String
    public var id: String { "\(event.id)-\(team)" }

    public init(event: EventRef, team: String) {
        self.event = event
        self.team = team
    }
}

extension VEXEvent {
    public var ref: EventRef {
        EventRef(id: id, name: name, day: day, place: place, isUpcoming: isUpcoming)
    }
}

extension TeamEvent {
    public var ref: EventRef {
        EventRef(id: String(id), name: name, day: day, place: location ?? "",
                 isUpcoming: (day ?? .distantPast) > Date())
    }
}

/// What an event screen can show. Which of these exist, and which divisions
/// each one spans, is a property of the payload rather than of the view - a
/// two-division event otherwise stacks standings, a bracket and two match
/// lists per division, and an upcoming event has nothing but its team list.
public enum EventSection: String, CaseIterable, Sendable, Identifiable {
    case rankings = "Rankings"
    case bracket = "Bracket"
    case matches = "Matches"
    case awards = "Awards"
    case skills = "Skills"
    case teams = "Teams"

    public var id: String { rawValue }

    /// Whether choosing a division changes what this section shows.
    public var isPerDivision: Bool { self == .rankings || self == .bracket || self == .matches }
}

extension EventDetailResponse {
    /// The divisions that have anything to show under `section`.
    ///
    /// Some events carry a final-only division to hold the cross-division
    /// match: it has no standings, so offering it under Rankings would give
    /// the reader an empty page.
    public func divisions(for section: EventSection) -> [Division] {
        switch section {
        case .rankings: return divisions.filter { !$0.rankings.isEmpty }
        case .bracket: return divisions.filter { !$0.elimination.isEmpty }
        case .matches: return divisions.filter { !($0.matches ?? []).isEmpty }
        default: return []
        }
    }

    /// The sections worth offering, in order. Empty when the event has nothing
    /// published at all.
    public var availableSections: [EventSection] {
        EventSection.allCases.filter { section in
            switch section {
            case .rankings, .bracket, .matches: return !divisions(for: section).isEmpty
            // An event in progress already lists every award it will give
            // out, all of them without a winner. Offering that as a section
            // reads as results when it is only a list of categories.
            case .awards: return awards.contains { !($0.teamWinners ?? []).isEmpty }
            case .skills: return !skillsLeaderboard.isEmpty
            case .teams: return !teams.isEmpty
            }
        }
    }
}
