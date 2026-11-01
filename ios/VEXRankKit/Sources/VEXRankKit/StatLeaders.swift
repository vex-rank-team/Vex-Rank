import Foundation

// MARK: - Skills

/// `/api/skills?season=` - the official Event.VEX world skills standings,
/// deduplicated to each team's best combined run by the Worker.
public struct SkillsResponse: Codable, Sendable {
    public let rankings: [SkillsEntry]
    public let season: String?
}

public struct SkillsEntry: Codable, Sendable, Identifiable, Hashable {
    public let id: Int
    public let number: String
    public let name: String
    public let organization: String?
    public let region: String?
    public let country: String?
    public let grade: String?
    public let autoSkills: Int
    public let driverSkills: Int
    public let combinedSkills: Int
    public let skillsRank: Int
}

// MARK: - Categories

/// A single leaderboard: how to score a team, which teams qualify, and how the
/// number reads. Ported from the web app's `StatRankingsView` so both clients
/// rank identically - the thresholds in particular are the part users notice,
/// since a team that appears on one client and not the other looks like a bug.
public struct StatCategory: Identifiable, Sendable, Hashable {
    public enum Source: Sendable { case matches, skills }

    public let id: String
    /// Column heading for the value, e.g. "Offensive rating".
    public let valueLabel: String
    public let detail: String
    public let source: Source
    /// Lower is better (only defensive impact, where DPR is points conceded).
    public let lowerIsBetter: Bool
    public let fractionDigits: Int

    public static func == (a: StatCategory, b: StatCategory) -> Bool { a.id == b.id }
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }

    public static let all: [StatCategory] = [
        StatCategory(id: "Offense", valueLabel: "Offensive rating",
                     detail: "Teams that create the most scoring value, with at least 12 scored matches.",
                     source: .matches, lowerIsBetter: false, fractionDigits: 1),
        StatCategory(id: "Defense", valueLabel: "Defensive impact",
                     detail: "Lowest opponent score share among teams with at least 12 scored matches.",
                     source: .matches, lowerIsBetter: true, fractionDigits: 1),
        StatCategory(id: "Picking", valueLabel: "Strategic reliability",
                     detail: "A 0-100 proxy combining results, opponent-adjusted strength and scoring margin. Requires 36 matches across 4 events.",
                     source: .matches, lowerIsBetter: false, fractionDigits: 0),
        StatCategory(id: "Consistency", valueLabel: "Rating stability",
                     detail: "How firmly the rating is supported by repeat results. Requires 36 matches across 4 events.",
                     source: .matches, lowerIsBetter: false, fractionDigits: 0),
        StatCategory(id: "Auto skills", valueLabel: "Autonomous skills",
                     detail: "Official Event.VEX programming-skills score.",
                     source: .skills, lowerIsBetter: false, fractionDigits: 0),
        StatCategory(id: "Driver skills", valueLabel: "Driver skills",
                     detail: "Official Event.VEX driver-skills score.",
                     source: .skills, lowerIsBetter: false, fractionDigits: 0),
        StatCategory(id: "Combined skills", valueLabel: "Combined skills",
                     detail: "Official Event.VEX autonomous plus driver skills total.",
                     source: .skills, lowerIsBetter: false, fractionDigits: 0),
    ]

    /// VEX IQ's leaderboards: skills only, since every other one is derived
    /// from the rating, which IQ does not have yet. "Coding" is what IQ calls
    /// the autonomous run.
    public static let iq: [StatCategory] = [
        StatCategory(id: "Combined skills", valueLabel: "Combined skills",
                     detail: "Official Event.VEX driver plus autonomous coding total.",
                     source: .skills, lowerIsBetter: false, fractionDigits: 0),
        StatCategory(id: "Driver skills", valueLabel: "Driver skills",
                     detail: "Official Event.VEX driver skills score.",
                     source: .skills, lowerIsBetter: false, fractionDigits: 0),
        StatCategory(id: "Coding skills", valueLabel: "Autonomous coding",
                     detail: "Official Event.VEX autonomous coding skills score.",
                     source: .skills, lowerIsBetter: false, fractionDigits: 0),
    ]

    public static func all(for program: Program) -> [StatCategory] { program.isIQ ? iq : all }
}

/// One row of a leaderboard, flattened so the view does not care whether the
/// team came from the rankings feed or the skills feed.
public struct StatLeader: Identifiable, Sendable, Hashable {
    public let id: String
    public let number: String
    public let name: String
    public let region: String
    /// "World #12" for match categories, the grade ("High School") for skills.
    public let context: String
    public let value: Double
    /// Only match-sourced rows open a profile; the skills feed carries no
    /// rating history, so tapping one would land on an empty page.
    public let opensProfile: Bool

    public func formattedValue(digits: Int) -> String {
        String(format: "%.\(digits)f", value)
    }
}

public enum StatLeaders {
    /// Win rate as a percentage from the "W-L-T" record string. The API writes
    /// the separator as an en dash; a hyphen is accepted too so a format change
    /// degrades to 0 rather than crashing.
    public static func winRate(record: String?, matches: Int?) -> Double {
        guard let matches, matches > 0 else { return 0 }
        let parts = (record ?? "").split(whereSeparator: { $0 == "\u{2013}" || $0 == "-" }).map { Double($0) ?? 0 }
        guard parts.count >= 2 else { return 0 }
        let wins = parts[0]
        let ties = parts.count > 2 ? parts[2] : 0
        return (wins + ties * 0.5) / Double(matches) * 100
    }

    static func clamp(_ value: Double) -> Double { min(100, max(0, value)) }

    public static func pickingScore(_ team: TeamRanking) -> Double {
        clamp(0.45 * winRate(record: team.record, matches: team.matches)
              + 0.35 * clamp((Double(team.rating) - 1250) / 7.5)
              + 0.20 * clamp(((team.ccwm ?? 0) + 20) * 1.25))
    }

    /// Confidence is the ± band printed beside the rating, so a small band means
    /// a stable rating; the score inverts it.
    public static func consistencyScore(_ team: TeamRanking) -> Double {
        clamp(100 - Double(team.confidence))
    }

    /// Qualifying rows for `category`, already sorted best-first and filtered to
    /// `country` when one is given.
    public static func rank(category: StatCategory,
                            teams: [TeamRanking],
                            skills: [SkillsEntry],
                            country: String? = nil) -> [StatLeader] {
        var rows: [StatLeader]
        switch category.source {
        case .matches:
            let qualifies: (TeamRanking) -> Bool
            let value: (TeamRanking) -> Double
            switch category.id {
            case "Offense":
                qualifies = { ($0.matches ?? 0) >= 12 && $0.opr != nil }
                value = { $0.opr ?? 0 }
            case "Defense":
                qualifies = { ($0.matches ?? 0) >= 12 && $0.dpr != nil }
                value = { $0.dpr ?? 0 }
            case "Consistency":
                qualifies = { ($0.matches ?? 0) >= 36 && $0.events >= 4 }
                value = consistencyScore
            default:
                qualifies = { ($0.matches ?? 0) >= 36 && $0.events >= 4 }
                value = pickingScore
            }
            rows = teams.filter { qualifies($0) && (country == nil || $0.country == country) }
                .map { team in
                    StatLeader(id: team.number, number: team.number, name: team.name,
                               region: team.region ?? team.country ?? "Unassigned",
                               context: "World #\(team.rank)", value: value(team), opensProfile: true)
                }
        case .skills:
            let value: (SkillsEntry) -> Double = {
                switch category.id {
                case "Auto skills", "Coding skills": return Double($0.autoSkills)
                case "Driver skills": return Double($0.driverSkills)
                default: return Double($0.combinedSkills)
                }
            }
            rows = skills.filter { value($0) > 0 && (country == nil || $0.country == country) }
                .map { entry in
                    StatLeader(id: entry.number, number: entry.number, name: entry.name,
                               region: entry.region ?? entry.country ?? "Unassigned",
                               context: entry.grade ?? "Unknown", value: value(entry), opensProfile: false)
                }
        }
        // Ties broken by team number so the order is stable across refreshes.
        rows.sort {
            $0.value == $1.value ? TeamNumber.precedes($0.number, $1.number)
                : (category.lowerIsBetter ? $0.value < $1.value : $0.value > $1.value)
        }
        return rows
    }

    /// Countries present in the source feed, for the region filter.
    public static func countries(category: StatCategory, teams: [TeamRanking], skills: [SkillsEntry]) -> [String] {
        let values = category.source == .matches
            ? teams.compactMap(\.country)
            : skills.compactMap(\.country)
        return Set(values).filter { !$0.isEmpty }.sorted()
    }
}
