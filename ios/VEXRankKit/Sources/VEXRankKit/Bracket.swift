import Foundation

/// The elimination bracket, built the way the web builds it.
///
/// A round is a fixed set of slots, not a list of matches: a replayed match
/// creates a second game in the *same* slot, and appending it as another match
/// would invent an extra opponent and draw the bracket wrong. This event is a
/// live example - its round of 16 has nine matches for eight slots.
public struct BracketSlot: Identifiable, Sendable, Hashable {
    public let id: String
    public let round: Int
    public let instance: Int
    /// The last game played, which is what the card shows.
    public let match: DivisionMatch
    /// Every game in the slot, replays included.
    public let games: [DivisionMatch]

    public var wasReplayed: Bool { games.count > 1 }
}

public struct BracketRound: Identifiable, Sendable, Hashable {
    public let id: Int
    public let label: String
    /// Fixed length. A nil slot is a bye or a match not yet posted, and is kept
    /// so the rounds stay aligned with each other.
    public let slots: [BracketSlot?]

    public var played: Int { slots.compactMap { $0 }.count }
}

/// The best-of series that decides the event.
public struct BracketFinal: Sendable, Hashable {
    public let games: [DivisionMatch]
    public let red: [String]
    public let blue: [String]
    public let redWins: Int
    public let blueWins: Int
    /// "red", "blue", or nil while the series is undecided.
    public let winner: String?
}

extension Division {
    /// The rounds before the final, earliest first. Rounds with nothing in them
    /// are dropped; a round that exists keeps all of its slots.
    public var bracket: [BracketRound] {
        // Round 6 is the round of 16 and comes first despite its number.
        let shape: [(round: Int, label: String, slots: Int)] = [
            (6, "Round of 16", 8),
            (3, "Quarterfinals", 4),
            (4, "Semifinals", 2),
        ]
        return shape.compactMap { stage in
            let slots = (1...stage.slots).map { instance -> BracketSlot? in
                let games = elimination
                    .filter { $0.round == stage.round && $0.instance == instance }
                    .sorted { ($0.matchnum ?? 0) < ($1.matchnum ?? 0) }
                guard let last = games.last else { return nil }
                return BracketSlot(id: "\(stage.round)-\(instance)", round: stage.round,
                                   instance: instance, match: last, games: games)
            }
            guard slots.contains(where: { $0 != nil }) else { return nil }
            return BracketRound(id: stage.round, label: stage.label, slots: slots)
        }
    }

    /// The final series, or nil when none has been posted.
    ///
    /// Wins are counted per *alliance*, identified by the teams on it rather
    /// than by colour: a series can swap colours between games, and counting by
    /// colour would then credit the wins to the wrong side.
    public var final: BracketFinal? {
        let games = elimination
            .filter { $0.round == 5 }
            .sorted { ($0.matchnum ?? 0) < ($1.matchnum ?? 0) }
        guard let first = games.first(where: { ($0.alliances ?? []).count == 2 }) ?? games.first else {
            return nil
        }

        let red = first.red?.numbers ?? []
        let blue = first.blue?.numbers ?? []
        let keys = [Self.allianceKey(red), Self.allianceKey(blue)]
        var wins = [0, 0]

        for game in games {
            guard let colour = game.winner,
                  let alliance = colour == "red" ? game.red : game.blue,
                  let index = keys.firstIndex(of: Self.allianceKey(alliance.numbers)) else { continue }
            wins[index] += 1
        }

        // A series is won at two, and never by a side that is level.
        let decided = wins.max() ?? 0 >= 2 && wins[0] != wins[1]
        return BracketFinal(games: games, red: red, blue: blue,
                            redWins: wins[0], blueWins: wins[1],
                            winner: decided ? (wins[0] > wins[1] ? "red" : "blue") : nil)
    }

    /// Order-independent identity for an alliance.
    static func allianceKey(_ numbers: [String]) -> String {
        numbers.map { $0.uppercased() }.sorted().joined(separator: "|")
    }
}

/// A bracket match, as a navigation destination.
///
/// Carries every game in the slot rather than only the one the card shows: a
/// replayed slot and a final series are both several games, and the reason to
/// open one is usually to see the games the card had no room for.
public struct MatchRef: Hashable, Sendable {
    public let title: String
    /// Which division it belongs to, when the event has more than one.
    public let division: String?
    public let games: [DivisionMatch]
    /// Set for a final, where the series score is the headline rather than any
    /// single game's.
    public let series: (red: [String], blue: [String], redWins: Int, blueWins: Int)?

    public init(title: String, division: String?, games: [DivisionMatch],
                series: (red: [String], blue: [String], redWins: Int, blueWins: Int)? = nil) {
        self.title = title
        self.division = division
        self.games = games
        self.series = series
    }

    /// The game a reader means when they tap the card: the one it was showing.
    public var latest: DivisionMatch? { games.last }

    public static func == (a: MatchRef, b: MatchRef) -> Bool {
        a.title == b.title && a.division == b.division && a.games == b.games
            && a.series?.redWins == b.series?.redWins && a.series?.blueWins == b.series?.blueWins
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(title)
        hasher.combine(division)
        hasher.combine(games)
    }

    /// Every team in the slot, de-duplicated, in the order they appear.
    public var teams: [String] {
        var seen = Set<String>()
        return games.flatMap { ($0.alliances ?? []).flatMap(\.numbers) }
            .filter { seen.insert($0.uppercased()).inserted }
    }
}

extension BracketSlot {
    public func reference(round: String, division: String?) -> MatchRef {
        MatchRef(title: "\(round) · Match \(instance)", division: division, games: games)
    }
}

extension BracketFinal {
    public func reference(division: String?) -> MatchRef {
        MatchRef(title: "Final", division: division, games: games,
                 series: (red, blue, redWins, blueWins))
    }
}
