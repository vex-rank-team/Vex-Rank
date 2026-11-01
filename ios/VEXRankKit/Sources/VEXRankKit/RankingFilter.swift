import Foundation

/// Narrowing the world ranking by school level, country and event region, as
/// the web's ranking page does. The rules live here rather than in the view so
/// both clients agree on what "in a region" means - the answer is not obvious,
/// because a team carries two different region fields.
public struct RankingFilter: Sendable, Hashable {
    public enum Grade: String, CaseIterable, Sendable {
        case all = "All teams"
        case highSchool = "High School"
        case middleSchool = "Middle School"
    }

    public var grade: Grade = .all
    public var country: String?
    public var region: String?
    public var search: String = ""

    public init(grade: Grade = .all, country: String? = nil, region: String? = nil, search: String = "") {
        self.grade = grade
        self.country = country
        self.region = region
        self.search = search
    }

    public var isNarrowed: Bool { grade != .all || country != nil || region != nil }

    /// A team's event region: the competition region it actually plays in,
    /// falling back to the first component of its postal region. `region` is a
    /// full "Victoria, Australia" string, so matching on it whole would put
    /// every team in its own group.
    public static func regionOf(_ team: TeamRanking) -> String? {
        if let event = team.eventRegion, !event.isEmpty { return event }
        guard let region = team.region,
              let first = region.split(separator: ",").first else { return nil }
        let trimmed = first.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? nil : trimmed
    }

    public func apply(to teams: [TeamRanking]) -> [TeamRanking] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        return teams.filter { team in
            if grade != .all, team.grade != grade.rawValue { return false }
            if let country, team.country != country { return false }
            if let region, Self.regionOf(team) != region { return false }
            guard !needle.isEmpty else { return true }
            return team.number.lowercased().contains(needle)
                || team.name.lowercased().contains(needle)
        }
    }

    /// Countries present in the feed, for the country menu.
    public static func countries(_ teams: [TeamRanking]) -> [String] {
        Set(teams.compactMap(\.country)).filter { !$0.isEmpty }.sorted()
    }

    /// Event regions, narrowed to the chosen country: offering regions from
    /// every country would make the menu unusable and most of its rows empty.
    public static func regions(_ teams: [TeamRanking], country: String?) -> [String] {
        let scoped = country.map { name in teams.filter { $0.country == name } } ?? teams
        return Set(scoped.compactMap(regionOf)).filter { !$0.isEmpty }.sorted()
    }
}
