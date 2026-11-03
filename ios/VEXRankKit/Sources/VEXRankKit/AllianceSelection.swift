import Foundation

/// One elimination alliance, read back from the matches it played: the captain
/// (the partner that ranked higher in qualifications, who did the selecting),
/// the team it picked, and its seed. Mirrors allianceSelections in
/// website/lib/team-event.mjs.
public struct AllianceSelection: Sendable, Hashable, Identifiable {
    public let seed: Int
    public let captain: String
    public let pick: String
    public let captainRank: Int

    public var id: Int { seed }

    /// "81208X selects 252H as the 2nd seed alliance".
    public var sentence: String { "\(captain) selects \(pick) as the \(Self.ordinal(seed)) seed alliance" }

    /// "1st", "2nd", "3rd", "11th" ...
    public static func ordinal(_ n: Int) -> String {
        if (11...13).contains(n % 100) { return "\(n)th" }
        switch n % 10 {
        case 1: return "\(n)st"
        case 2: return "\(n)nd"
        case 3: return "\(n)rd"
        default: return "\(n)th"
        }
    }

    public func includes(_ team: String) -> Bool {
        captain.caseInsensitiveCompare(team) == .orderedSame || pick.caseInsensitiveCompare(team) == .orderedSame
    }
}

extension Division {
    /// Alliances in seed order: captains are seeded by their qualification rank.
    public var allianceSelections: [AllianceSelection] {
        let rank = Dictionary(rankings.map { ($0.team.name.uppercased(), $0.rank) }, uniquingKeysWith: min)
        var alliances: [String: [String]] = [:]
        for match in matches ?? [] where (3...6).contains(match.round ?? 0) {
            for alliance in match.alliances ?? [] {
                let teams = alliance.numbers
                guard teams.count == 2, teams.allSatisfy({ rank[$0.uppercased()] != nil }) else { continue }
                alliances[teams.map { $0.uppercased() }.sorted().joined(separator: "+")] = teams
            }
        }
        return alliances.values
            .map { teams -> (captain: String, pick: String, rank: Int) in
                let ordered = teams.sorted { rank[$0.uppercased()]! < rank[$1.uppercased()]! }
                return (ordered[0], ordered[1], rank[ordered[0].uppercased()]!)
            }
            .sorted { $0.rank < $1.rank }
            .enumerated()
            .map { AllianceSelection(seed: $0.offset + 1, captain: $0.element.captain, pick: $0.element.pick, captainRank: $0.element.rank) }
    }
}

extension EventDetailResponse {
    /// Every division's alliance selections.
    public var allianceSelections: [AllianceSelection] {
        divisions.flatMap(\.allianceSelections)
    }
}
