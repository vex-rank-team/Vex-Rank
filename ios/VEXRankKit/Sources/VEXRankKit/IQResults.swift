import Foundation

/// VEX IQ results, read from the same event payload V5 uses.
///
/// The payload looks like V5 and means something else. A teamwork match
/// arrives as two "alliances", coloured red and blue, each holding one team,
/// and both carrying the same score - the two teams scored it together. Read
/// with the V5 helpers, every IQ match is a tie between opponents. These read
/// it as a pair of teams and one shared score, and never report a winner, a
/// loser, a tie or a colour.
///
/// Mirrors website/lib/viqrc.mjs; both are tested on the same fixtures.

/// One teamwork match, from one team's side when there is one.
public struct TeamworkMatch: Identifiable, Sendable, Hashable {
    public let id: Int
    public let name: String
    public let field: String?
    public let scheduled: Date?
    public let division: String
    /// Every team in the match.
    public let teams: [String]
    /// The teams other than the one the match was read for.
    public let partners: [String]
    /// The score both teams share. Nil until played.
    public let score: Int?
    public let isPlayed: Bool
    public let isQualification: Bool
}

/// A team's place in a VEX IQ division.
public struct IQStanding: Identifiable, Sendable, Hashable {
    public let rank: Int
    public let number: String
    public let teamID: Int
    /// The event's own average when it serves one, otherwise the mean of the
    /// team's played qualification scores - a measured figure, not an estimate.
    public let average: Double?
    public let averageFromEvent: Bool
    public let highScore: Int?
    /// Qualification matches played.
    public let played: Int
    public let division: String

    public var id: Int { teamID }
}

extension DivisionMatch {
    /// The teams in this match and their shared score. The score is the
    /// highest posted on either side: equal when the event is working, and
    /// the higher keeps a half-entered result from reading low.
    public var teamwork: (teams: [String], score: Int?) {
        let teams = (alliances ?? []).flatMap(\.numbers)
        let scores = (alliances ?? []).compactMap(\.score)
        return (teams, isPlayed ? scores.max() : nil)
    }
}

extension Division {
    /// Played qualification scores per team number.
    private var qualificationScores: [String: [Int]] {
        var scores: [String: [Int]] = [:]
        for match in matches ?? [] where match.isQualification && match.isPlayed {
            let pair = match.teamwork
            guard let score = pair.score else { continue }
            for team in pair.teams { scores[team.uppercased(), default: []].append(score) }
        }
        return scores
    }

    /// The division's standings as VEX IQ ranks them, in the event's order.
    public var iqStandings: [IQStanding] {
        let scores = qualificationScores
        return rankings.map { row in
            let own = scores[row.team.name.uppercased()] ?? []
            let mean = own.isEmpty ? nil : Double(own.reduce(0, +)) / Double(own.count)
            return IQStanding(rank: row.rank, number: row.team.name, teamID: row.team.id,
                              average: row.averagePoints ?? mean,
                              averageFromEvent: row.averagePoints != nil,
                              highScore: row.highScore ?? own.max(),
                              played: own.count, division: name)
        }
        .sorted { $0.rank < $1.rank }
    }
}

extension EventDetailResponse {
    /// Whether this is a VEX IQ event, read from the event itself so a link
    /// into one is read correctly whatever program is selected.
    public var isIQ: Bool {
        event.program?.id == 41 || event.program?.code == "VIQRC"
    }

    /// Every match `number` is in, played and scheduled, in play order.
    public func iqMatches(for number: String) -> [TeamworkMatch] {
        let wanted = number.uppercased()
        var found: [TeamworkMatch] = []
        for division in divisions {
            for match in division.matches ?? [] {
                let pair = match.teamwork
                guard pair.teams.contains(where: { $0.uppercased() == wanted }) else { continue }
                found.append(TeamworkMatch(
                    id: match.id,
                    name: match.name ?? "Match",
                    field: match.field,
                    scheduled: match.scheduled.flatMap { ISO8601DateFormatter().date(from: $0) },
                    division: division.name,
                    teams: pair.teams,
                    partners: pair.teams.filter { $0.uppercased() != wanted },
                    score: pair.score,
                    isPlayed: match.isPlayed,
                    isQualification: match.isQualification
                ))
            }
        }
        return found.sorted { a, b in
            if let x = a.scheduled, let y = b.scheduled, x != y { return x < y }
            if (a.scheduled == nil) != (b.scheduled == nil) { return a.scheduled != nil }
            return a.id < b.id
        }
    }

    /// The team's standing in whichever division it is seeded in.
    public func iqStanding(for number: String) -> IQStanding? {
        let wanted = number.uppercased()
        for division in divisions {
            if let row = division.iqStandings.first(where: { $0.number.uppercased() == wanted }) { return row }
        }
        return nil
    }

    /// Five measured axes, each placed against the division. Not a rating:
    /// every value is a result the event published or a mean of them.
    public func iqStrengthProfile(for number: String) -> StrengthProfile? {
        let wanted = number.uppercased()
        guard let division = divisions.first(where: { d in d.rankings.contains { $0.team.name.uppercased() == wanted } })
        else { return nil }
        let rows = division.iqStandings
        guard let me = rows.first(where: { $0.number.uppercased() == wanted }) else { return nil }

        var driver: [String: Int] = [:], coding: [String: Int] = [:]
        for run in skills {
            guard let team = run.team?.name?.uppercased(), let score = run.score else { continue }
            let type = (run.type ?? "").lowercased()
            if type.contains("driver") { driver[team] = max(driver[team] ?? 0, score) }
            else if type.contains("program") || type.contains("auto") { coding[team] = max(coding[team] ?? 0, score) }
        }
        let anyDriver = rows.contains { driver[$0.number.uppercased()] != nil }
        let anyCoding = rows.contains { coding[$0.number.uppercased()] != nil }

        func value(_ row: IQStanding, _ kind: StrengthAxis.Kind) -> Double? {
            let team = row.number.uppercased()
            switch kind {
            case .average: return row.played > 0 || row.averageFromEvent ? row.average : nil
            case .high: return row.played > 0 || row.highScore != nil ? row.highScore.map(Double.init) : nil
            case .driver: return anyDriver ? Double(driver[team] ?? 0) : nil
            case .coding: return anyCoding ? Double(coding[team] ?? 0) : nil
            case .skills: return anyDriver || anyCoding ? Double((driver[team] ?? 0) + (coding[team] ?? 0)) : nil
            default: return nil
            }
        }

        let axes = StrengthAxis.Kind.iq.map { kind -> StrengthAxis in
            let field = rows.map { value($0, kind) }
            let mine = value(me, kind)
            let score = StrengthProfile.percentile(mine, in: field)
            let display: String
            switch (kind, mine) {
            case (_, nil): display = "\u{2014}"
            case (.average, let v?): display = String(format: "%.1f", v)
            case (_, let v?): display = String(Int(v))
            }
            return StrengthAxis(kind: kind, display: display, score: score,
                                place: score == nil ? nil : mine.map { StrengthProfile.place($0, in: field, lowerIsBetter: false) },
                                of: field.compactMap { $0 }.count)
        }
        return StrengthProfile(division: division.name, teams: rows.count, axes: axes, isProvisional: false)
    }
}

/// The shared score of each played match, as chart points. Drawn by the same
/// chart as V5's momentum, with the score where V5 draws the running margin.
public enum IQScoreSeries {
    public static func points(from matches: [TeamworkMatch]) -> [MomentumPoint] {
        matches.filter { $0.isPlayed && $0.score != nil }.enumerated().map { index, match in
            MomentumPoint(id: match.id, match: index + 1, name: match.name,
                          margin: match.score ?? 0, cumulative: match.score ?? 0, outcome: .scheduled)
        }
    }
}
