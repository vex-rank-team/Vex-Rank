import Foundation

/// A team's contribution ratings at one event.
/// The fitted ratings for a division, and how much play stands behind them.
public struct PowerRatings: Sendable {
    public let stats: [String: TeamEventStats]
    /// Average number of matches each team has been seen in.
    public let appearances: Double

    /// Fewer than four appearances each. The values are shrunk toward zero to
    /// stay meaningful, but they will still move a lot as the event goes on.
    public var isProvisional: Bool { appearances < 4 }
    public var isEmpty: Bool { stats.isEmpty }

    public subscript(team: String) -> TeamEventStats? { stats[team.uppercased()] }
}

public struct TeamEventStats: Sendable, Hashable {
    /// Offensive Power Rating: the points this team is estimated to add to
    /// whichever alliance it is on.
    public let opr: Double
    /// Defensive Power Rating: the points its opponents are estimated to score
    /// against it. Lower is better.
    public let dpr: Double
    /// Calculated Contribution to Winning Margin.
    public var ccwm: Double { opr - dpr }
}

extension Division {
    /// OPR, DPR and CCWM solved from this division's own qualification matches.
    ///
    /// The API publishes WP, AP and SP per event but not these, because they
    /// are not counted - they are fitted. Each played qualification match says
    /// "these two teams together scored this much", and the ratings are the
    /// per-team values that best explain every such statement at once, in the
    /// least-squares sense.
    ///
    /// Solved through the normal equations: `A` holds, at (i, j), how many
    /// matches i and j played together, and on its diagonal how many i played
    /// at all; `b` holds each team's total alliance score. Elimination matches
    /// are excluded, as they are everywhere else - alliances there are chosen
    /// rather than drawn, so they say nothing about a team on its own.
    public func powerRatings() -> PowerRatings {
        let played = qualification.filter(\.isPlayed)
        guard played.count >= 3 else { return PowerRatings(stats: [:], appearances: 0) }

        // Each match contributes twice: once per alliance.
        var sides: [(teams: [String], scored: Double, conceded: Double)] = []
        for match in played {
            guard let red = match.red, let blue = match.blue,
                  let redScore = red.score, let blueScore = blue.score else { continue }
            let redTeams = red.numbers.map { $0.uppercased() }
            let blueTeams = blue.numbers.map { $0.uppercased() }
            guard !redTeams.isEmpty, !blueTeams.isEmpty else { continue }
            sides.append((redTeams, Double(redScore), Double(blueScore)))
            sides.append((blueTeams, Double(blueScore), Double(redScore)))
        }
        guard !sides.isEmpty else { return PowerRatings(stats: [:], appearances: 0) }

        let teams = Array(Set(sides.flatMap(\.teams))).sorted { TeamNumber.precedes($0, $1) }
        let appearances = 4 * Double(played.count) / Double(teams.count)
        let index = Dictionary(uniqueKeysWithValues: teams.enumerated().map { ($1, $0) })
        let n = teams.count


        var a = [[Double]](repeating: [Double](repeating: 0, count: n), count: n)
        var offence = [Double](repeating: 0, count: n)
        var defence = [Double](repeating: 0, count: n)

        for side in sides {
            let rows = side.teams.compactMap { index[$0] }
            for i in rows {
                offence[i] += side.scored
                defence[i] += side.conceded
                for j in rows { a[i][j] += 1 }
            }
        }

        // The ridge, scaled to how thin the data is.
        //
        // Each match gives two equations and involves four teams, so a team
        // needs about four appearances before its own rating is pinned down.
        // Short of that the system is underdetermined and an unregularised
        // solve answers with numbers shaped like ratings that are not: at 1.8
        // appearances each this event fitted a range of -115 to +183, which
        // correlated with actual scoring at only 0.50. Shrinking in proportion
        // to how far short of four appearances the event is brings that to
        // -2 to +53 at a correlation of 0.90 - values that move as the event
        // goes on, but that rank teams sensibly from the first morning. Once
        // there is enough play the ridge vanishes and the fit is the true one.
        let ridge = appearances >= 4 ? 1e-6 : max(1e-6, 4 - appearances)
        for i in 0..<n { a[i][i] += ridge }

        guard let opr = Self.solve(a, offence), let dpr = Self.solve(a, defence) else {
            return PowerRatings(stats: [:], appearances: appearances)
        }
        return PowerRatings(
            stats: Dictionary(uniqueKeysWithValues: teams.enumerated().map { i, team in
                (team, TeamEventStats(opr: opr[i], dpr: dpr[i]))
            }),
            appearances: appearances
        )
    }

    /// Gaussian elimination with partial pivoting. Returns nil if the system
    /// turns out to be singular anyway, which is better than returning numbers
    /// that mean nothing.
    static func solve(_ matrix: [[Double]], _ vector: [Double]) -> [Double]? {
        let n = vector.count
        guard n > 0, matrix.count == n else { return nil }
        var a = matrix
        var b = vector

        for column in 0..<n {
            var pivot = column
            for row in (column + 1)..<n where abs(a[row][column]) > abs(a[pivot][column]) {
                pivot = row
            }
            guard abs(a[pivot][column]) > 1e-9 else { return nil }
            if pivot != column {
                a.swapAt(pivot, column)
                b.swapAt(pivot, column)
            }
            let head = a[column][column]
            for row in (column + 1)..<n {
                let factor = a[row][column] / head
                guard factor != 0 else { continue }
                for col in column..<n { a[row][col] -= factor * a[column][col] }
                b[row] -= factor * b[column]
            }
        }

        var solution = [Double](repeating: 0, count: n)
        for row in stride(from: n - 1, through: 0, by: -1) {
            var total = b[row]
            for col in (row + 1)..<n { total -= a[row][col] * solution[col] }
            solution[row] = total / a[row][row]
        }
        return solution
    }
}


/// How a team stands at one event: where it is seeded, what it has done, and
/// what its matches say about its contribution.
public struct EventStanding: Sendable, Hashable {
    public let division: String
    public let rank: Int
    public let wins: Int
    public let losses: Int
    public let ties: Int
    public let wp: Int?
    public let ap: Int?
    public let sp: Int?
    public let highScore: Int?
    /// Absent until the event has played a few matches at all.
    public let stats: TeamEventStats?
    /// True while there is too little play for the fit to settle.
    public let statsAreProvisional: Bool

    public var record: String { "\(wins)\u{2013}\(losses)\u{2013}\(ties)" }
}

extension EventDetailResponse {
    /// The team's standing in whichever division it plays in, or nil when it
    /// has not been seeded - a team can be registered without appearing in the
    /// standings before its first match is scored.
    public func standing(for number: String) -> EventStanding? {
        let wanted = number.uppercased()
        for division in divisions {
            guard let row = division.rankings.first(where: { $0.team.name.uppercased() == wanted })
            else { continue }
            return EventStanding(
                division: division.name,
                rank: row.rank,
                wins: row.wins, losses: row.losses, ties: row.ties,
                wp: row.wp, ap: row.ap, sp: row.sp, highScore: row.highScore,
                stats: division.powerRatings()[wanted],
                statsAreProvisional: division.powerRatings().isProvisional
            )
        }
        return nil
    }
}

/// How to order a division's qualification standings.
public enum StandingSort: String, CaseIterable, Sendable, Identifiable {
    case rank = "Rank"
    case wp = "WP"
    case ap = "AP"
    case sp = "SP"
    case high = "High"
    case opr = "OPR"
    case dpr = "DPR"
    case ccwm = "CCWM"

    public var id: String { rawValue }

    /// DPR counts the points a team's opponents score, so the best value is
    /// the smallest one - and seeding rank is already "1 is best". Everything
    /// else reads higher-is-better.
    public var ascending: Bool { self == .dpr || self == .rank }

    /// The three fitted figures exist only once an event has played enough to
    /// support them, so they are not always offered.
    public var needsRatings: Bool { self == .opr || self == .dpr || self == .ccwm }
}

extension Division {
    /// Standings in the reader's chosen order.
    ///
    /// A team with no value for the chosen column - unrated, or missing a
    /// figure the API did not send - sorts to the end rather than to the top,
    /// whichever direction the column runs.
    public func standings(by sort: StandingSort,
                          ratings: PowerRatings? = nil) -> [DivisionRanking] {
        func value(_ row: DivisionRanking) -> Double? {
            switch sort {
            case .rank: return Double(row.rank)
            case .wp: return row.wp.map(Double.init)
            case .ap: return row.ap.map(Double.init)
            case .sp: return row.sp.map(Double.init)
            case .high: return row.highScore.map(Double.init)
            case .opr: return ratings?[row.team.name]?.opr
            case .dpr: return ratings?[row.team.name]?.dpr
            case .ccwm: return ratings?[row.team.name]?.ccwm
            }
        }

        return rankings.sorted { a, b in
            switch (value(a), value(b)) {
            case let (x?, y?):
                if x == y { return a.rank < b.rank }
                return sort.ascending ? x < y : x > y
            case (nil, nil): return a.rank < b.rank
            case (nil, _): return false
            case (_, nil): return true
            }
        }
    }

    /// The orders worth offering for this division.
    public func availableSorts() -> [StandingSort] {
        let rated = !powerRatings().isEmpty
        return StandingSort.allCases.filter { rated || !$0.needsRatings }
    }
}
