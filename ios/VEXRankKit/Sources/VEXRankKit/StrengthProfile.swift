import Foundation

/// One measure on a team's strength hexagon.
public struct StrengthAxis: Identifiable, Sendable, Hashable {
    public enum Kind: String, CaseIterable, Sendable {
        case opr, ccwm, dpr, awp, winRate, skills
        // VEX IQ, all measured results: no opponent, so no fitted ratings.
        case average, high, driver, coding

        /// V5's six, in drawing order.
        public static let v5: [Kind] = [.opr, .ccwm, .dpr, .awp, .winRate, .skills]
        /// VEX IQ's five, in drawing order.
        public static let iq: [Kind] = [.average, .high, .driver, .coding, .skills]
    }

    public let kind: Kind
    /// The team's own figure, formatted for reading.
    public let display: String
    /// Where the team sits in its division, 0 (bottom) to 1 (top). Nil when
    /// the event has no data behind this measure yet.
    public let score: Double?
    /// 1-based place in the division, ties sharing the better place.
    public let place: Int?
    /// How many teams in the division have a value to be placed against.
    public let of: Int

    public var id: String { kind.rawValue }

    public var label: String {
        switch kind {
        case .opr: return "OPR"
        case .ccwm: return "CCWM"
        case .dpr: return "DPR"
        case .awp: return "AWP"
        case .winRate: return "Win rate"
        case .skills: return "Skills"
        case .average: return "Avg score"
        case .high: return "High"
        case .driver: return "Driver"
        case .coding: return "Coding"
        }
    }

    public var title: String {
        switch kind {
        case .opr: return "Offensive power rating"
        case .ccwm: return "Contribution to winning margin"
        case .dpr: return "Defensive power rating - points allowed, lower is better"
        case .awp: return "Autonomous win points per qualification match"
        case .winRate: return "Qualification wins, ties counted half"
        case .skills: return "Best driver + programming at this event"
        case .average: return "Average teamwork score in qualification"
        case .high: return "Highest teamwork score at this event"
        case .driver: return "Best driver skills score at this event"
        case .coding: return "Best autonomous coding skills score at this event"
        }
    }

    /// DPR counts what opponents score, so smaller is better.
    public var lowerIsBetter: Bool { kind == .dpr }
}

/// A team's strengths at one event, each measure placed against the rest of
/// its division so that points, ratings and rates can share one shape.
///
/// Placing rather than plotting raw values is the point: an OPR of 60 and a
/// win rate of 70% have no common scale, but "better than 80% of the division"
/// means the same thing on every axis. The website builds the same profile
/// from the same payload (website/lib/team-event.mjs).
public struct StrengthProfile: Sendable, Hashable {
    public let division: String
    public let teams: Int
    public let axes: [StrengthAxis]
    /// True while the fitted ratings are still settling.
    public let isProvisional: Bool

    /// Autonomous win points earned. The standings do not list them, but a
    /// V5RC win is worth 2 WP, a tie 1, and an AWP 1 more - so what is left of
    /// WP once wins and ties are taken out is the AWP count.
    public static func awpCount(_ row: DivisionRanking) -> Int? {
        guard let wp = row.wp else { return nil }
        return max(0, wp - 2 * row.wins - row.ties)
    }

    /// Where `value` sits among `field`, 0...1: the share of the other teams
    /// it beats, ties counted half. Nil with fewer than two values to compare.
    public static func percentile(_ value: Double?, in field: [Double?], lowerIsBetter: Bool = false) -> Double? {
        guard let value, value.isFinite else { return nil }
        let others = field.compactMap { $0 }.filter(\.isFinite)
        guard others.count >= 2 else { return nil }
        var beaten = 0.0
        var level = -1.0 // the team's own value is in the field
        for other in others {
            if other == value { level += 1 }
            else if lowerIsBetter ? value < other : value > other { beaten += 1 }
        }
        return (beaten + max(0, level) * 0.5) / Double(others.count - 1)
    }

    static func place(_ value: Double, in field: [Double?], lowerIsBetter: Bool) -> Int {
        1 + field.compactMap { $0 }.filter { lowerIsBetter ? $0 < value : $0 > value }.count
    }
}

extension EventDetailResponse {
    /// The six-axis strength profile for `number`, or nil when the team has
    /// not been seeded in any division here.
    public func strengthProfile(for number: String) -> StrengthProfile? {
        let wanted = number.uppercased()
        guard let division = divisions.first(where: { d in d.rankings.contains { $0.team.name.uppercased() == wanted } }),
              let me = division.rankings.first(where: { $0.team.name.uppercased() == wanted })
        else { return nil }

        let ratings = division.powerRatings()
        let skillTotals = Dictionary(skillsLeaderboard.map { ($0.number.uppercased(), $0.total) },
                                     uniquingKeysWith: max)
        let anySkills = division.rankings.contains { skillTotals[$0.team.name.uppercased()] != nil }

        func value(_ row: DivisionRanking, _ kind: StrengthAxis.Kind) -> Double? {
            let team = row.team.name.uppercased()
            let played = row.wins + row.losses + row.ties
            switch kind {
            case .opr: return ratings[team]?.opr
            case .dpr: return ratings[team]?.dpr
            case .ccwm: return ratings[team]?.ccwm
            case .awp:
                guard played > 0, let awp = StrengthProfile.awpCount(row) else { return nil }
                return Double(awp) / Double(played)
            case .winRate:
                guard played > 0 else { return nil }
                return (Double(row.wins) + 0.5 * Double(row.ties)) / Double(played)
            case .skills:
                return anySkills ? Double(skillTotals[team] ?? 0) : nil
            case .average, .high, .driver, .coding:
                return nil
            }
        }

        let myPlayed = me.wins + me.losses + me.ties
        let axes = StrengthAxis.Kind.v5.map { kind -> StrengthAxis in
            let field = division.rankings.map { value($0, kind) }
            let mine = value(me, kind)
            let lower = kind == .dpr
            let score = StrengthProfile.percentile(mine, in: field, lowerIsBetter: lower)
            let display: String
            switch (kind, mine) {
            case (_, nil): display = "\u{2014}"
            case (.awp, _): display = "\(StrengthProfile.awpCount(me) ?? 0) in \(myPlayed)"
            case (.winRate, let v?): display = "\(Int((v * 100).rounded()))%"
            case (.skills, let v?): display = String(Int(v))
            case (_, let v?): display = String(format: "%.1f", v)
            }
            return StrengthAxis(
                kind: kind,
                display: display,
                score: score,
                place: score == nil ? nil : mine.map { StrengthProfile.place($0, in: field, lowerIsBetter: lower) },
                of: field.compactMap { $0 }.count
            )
        }

        return StrengthProfile(division: division.name, teams: division.rankings.count,
                               axes: axes, isProvisional: ratings.isProvisional)
    }
}
