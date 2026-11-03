import Foundation

/// An official ruling on one team in one qualification match: its result
/// changed from what the scores say. Mirrors website/lib/disqualifications.mjs.
public enum MatchRuling: String, Sendable, Hashable {
    /// Disqualified in this match. VEX IQ: its station scored less than its
    /// partner's (they share one score). V5: inferred from the official
    /// standings - the DQ team takes the loss, the opponents get the win.
    case dq

    public var label: String { "DQ" }

    public var explanation: String {
        "Disqualified in this match (inferred from the official results)."
    }
}

/// Disqualifications at an event, only where the data makes them certain.
/// Mirrors website/lib/disqualifications.mjs - see there for how V5 DQs are
/// found from the gap between official records and match scores.
public struct OfficialRulings: Sendable {
    public var byMatch: [Int: [String: MatchRuling]] = [:]
    public var unresolved: [String] = []

    public init() {}

    public func ruling(match: Int, team: String) -> MatchRuling? {
        byMatch[match]?[team.uppercased()]
    }

    mutating func add(_ match: Int, _ team: String, _ ruling: MatchRuling) {
        byMatch[match, default: [:]][team.uppercased()] = ruling
    }
}

/// Wins, losses and ties a record still has to move by.
private struct Gap: Equatable {
    var w = 0, l = 0, t = 0
    subscript(_ key: Character) -> Int {
        get { key == "w" ? w : key == "l" ? l : t }
        set { if key == "w" { w = newValue } else if key == "l" { l = newValue } else { t = newValue } }
    }
    var isZero: Bool { w == 0 && l == 0 && t == 0 }
}

private struct DQCandidate {
    let match: Int
    let side: String
    let teams: [String]
    /// Per team, how its record moves: e.g. ["w": -1, "l": 1].
    let effect: [String: [Character: Int]]
}

extension Division {
    public func officialRulings(iq: Bool) -> OfficialRulings {
        var rulings = OfficialRulings()
        let played = (matches ?? []).filter { $0.isQualification && $0.isPlayed && ($0.alliances ?? []).count == 2 }
        if iq {
            for match in played {
                let alliances = match.alliances ?? []
                guard let first = alliances[0].score, let second = alliances[1].score, first != second else { continue }
                for team in alliances[first < second ? 0 : 1].numbers { rulings.add(match.id, team, .dq) }
            }
            return rulings
        }
        let (found, unresolved) = v5Disqualifications(played)
        for candidate in found { for team in candidate.teams { rulings.add(candidate.match, team, .dq) } }
        rulings.unresolved = unresolved
        return rulings
    }

    private func v5Disqualifications(_ played: [DivisionMatch]) -> ([DQCandidate], [String]) {
        func outcome(_ own: Int, _ other: Int) -> Character { own > other ? "w" : own < other ? "l" : "t" }
        var gap: [String: Gap] = [:]
        for row in rankings { gap[row.team.name.uppercased()] = Gap(w: row.wins, l: row.losses, t: row.ties) }
        guard !gap.isEmpty else { return ([], []) }
        for match in played {
            let alliances = match.alliances ?? []
            for (own, other) in [(alliances[0], alliances[1]), (alliances[1], alliances[0])] {
                let key = outcome(own.score ?? 0, other.score ?? 0)
                for team in own.numbers.map({ $0.uppercased() }) where gap[team] != nil { gap[team]![key] -= 1 }
            }
        }
        // A team whose official record counts a different number of matches
        // cannot be balanced by DQs; it is left out of the equations.
        gap = gap.filter { $0.value.w + $0.value.l + $0.value.t == 0 }
        let needs = gap.filter { !$0.value.isZero }.map(\.key)
        guard !needs.isEmpty else { return ([], []) }

        var candidates: [DQCandidate] = []
        for match in played {
            let alliances = match.alliances ?? []
            for (own, other) in [(alliances[0], alliances[1]), (alliances[1], alliances[0])] {
                let result = outcome(own.score ?? 0, other.score ?? 0)
                if result == "l" { continue }
                let mine = own.numbers.map { $0.uppercased() }, theirs = other.numbers.map { $0.uppercased() }
                var opponentsWin: [String: [Character: Int]] = [:]
                for team in theirs { opponentsWin[team] = [result == "w" ? "l" : "t": -1, "w": 1] }
                let sets = mine.count > 1 ? mine.map { [$0] } + [mine] : [mine]
                for disqualified in sets {
                    var effect = opponentsWin
                    for team in disqualified { effect[team] = [result: -1, "l": 1] }
                    candidates.append(DQCandidate(match: match.id, side: own.color ?? "", teams: disqualified, effect: effect))
                }
            }
        }
        var byTeam: [String: [Int]] = [:]
        for (index, candidate) in candidates.enumerated() { for team in candidate.effect.keys { byTeam[team, default: []].append(index) } }

        var remaining = gap
        let keys: [Character] = ["w", "l", "t"]
        func apply(_ candidate: DQCandidate, _ sign: Int) {
            for (team, change) in candidate.effect where remaining[team] != nil {
                for key in keys { remaining[team]![key] -= sign * (change[key] ?? 0) }
            }
        }
        // May push a team one step past its record (cancelled by a later DQ), never further.
        func fits(_ candidate: DQCandidate) -> Bool {
            candidate.effect.allSatisfy { team, change in
                guard let g = remaining[team] else { return true }
                return keys.allSatisfy { key in
                    let after = g[key] - (change[key] ?? 0)
                    return abs(after) < abs(g[key]) || abs(after) <= 1
                }
            }
        }
        func closes(_ candidate: DQCandidate) -> Int {
            candidate.effect.filter { team, change in
                guard let g = remaining[team] else { return false }
                return keys.contains { (change[$0] ?? 0) != 0 && (change[$0]! > 0) == (g[$0] > 0) && g[$0] != 0 }
            }.count
        }
        let budget = min(40, gap.values.reduce(0) { $0 + max(0, -$1.w) + max(0, -$1.t) } + 4)
        var solutions: [[Int]] = []
        var steps = 0
        var chosen: [Int] = []
        var sides = Set<String>()
        func viable(_ index: Int, _ team: String, _ g: Gap) -> Bool {
            let candidate = candidates[index]
            if sides.contains("\(candidate.match):\(candidate.side)") { return false }
            let change = candidate.effect[team] ?? [:]
            return keys.contains { (change[$0] ?? 0) != 0 && g[$0] != 0 && (change[$0]! > 0) == (g[$0] > 0) } && fits(candidate)
        }
        func search() {
            steps += 1
            if steps > 20_000 || solutions.count >= 8 || chosen.count > budget { return }
            var pick: String?
            var fewest = Int.max
            for (team, g) in remaining where !g.isZero {
                var count = 0
                for index in byTeam[team] ?? [] where viable(index, team, g) {
                    count += 1
                    if count >= fewest { break }
                }
                if count == 0 { return }
                if count < fewest { fewest = count; pick = team }
            }
            guard let team = pick else { solutions.append(chosen); return }
            let g = remaining[team]!
            let options = (byTeam[team] ?? []).filter { viable($0, team, g) }.sorted { closes(candidates[$0]) > closes(candidates[$1]) }
            for index in options {
                let candidate = candidates[index], side = "\(candidate.match):\(candidate.side)"
                apply(candidate, 1); sides.insert(side); chosen.append(index)
                search()
                chosen.removeLast(); sides.remove(side); apply(candidate, -1)
                if steps > 20_000 || solutions.count >= 8 { return }
            }
        }
        search()
        guard let first = solutions.first else { return ([], needs) }
        func key(_ index: Int) -> String { "\(candidates[index].match)|\(candidates[index].teams.joined(separator: "+"))" }
        let common = solutions.map { Set($0.map(key)) }.reduce(Set(first.map(key))) { $0.intersection($1) }
        let found = first.filter { common.contains(key($0)) }.map { candidates[$0] }
        return (found, common.count == first.count ? [] : needs)
    }
}

extension EventDetailResponse {
    /// Every division's rulings at this event.
    public var officialRulings: OfficialRulings {
        var all = OfficialRulings()
        for division in divisions {
            let rulings = division.officialRulings(iq: isIQ)
            all.byMatch.merge(rulings.byMatch) { first, _ in first }
            all.unresolved += rulings.unresolved
        }
        return all
    }
}
