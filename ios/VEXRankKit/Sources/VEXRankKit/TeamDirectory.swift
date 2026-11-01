import Foundation

/// Every V5RC team on record - about 56,000 of them, registered and
/// historical - searchable by number, name or organization.
///
/// The search rules are ported from the web's `team-directory.mjs` so the two
/// clients answer the same query the same way. They are not obvious: searching
/// "2011" is expected to return the whole numeric family, countries have to be
/// normalized before they group, and the order puts what you probably meant
/// first.
public struct TeamDirectoryResponse: Codable, Sendable {
    public let asOf: String
    public let source: String?
    public let total: Int
    public let includesInactive: Bool?
    public let teams: [DirectoryTeam]
    /// Which program the list is for. Files built before VEX IQ have none and
    /// are V5's.
    public let program: String?

    /// Whether this is the list for `program`. A server that predates VEX IQ
    /// answers the IQ request with the V5 file, so an IQ request is satisfied
    /// only by a file that says VIQRC.
    public func matches(_ program: Program) -> Bool {
        (self.program ?? Program.v5rc.rawValue) == program.rawValue
    }

    /// What a reader sees when VEX IQ was asked for and the IQ list is not there.
    public static let iqUnavailable = "The VEX IQ team directory isn't available yet."

    /// `asOf` carries milliseconds ("2026-09-16T15:47:40.805Z"), which the
    /// default ISO-8601 parser rejects outright - it returned nil and the
    /// "updated" line silently never appeared. Fractional seconds first, plain
    /// as the fallback, since only this field is written that way.
    public var updated: Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: asOf) ?? ISO8601DateFormatter().date(from: asOf)
    }
}

public struct DirectoryTeam: Codable, Sendable, Identifiable, Hashable {
    public let id: Int
    public let number: String
    public let name: String?
    public let organization: String?
    public let country: String?
    public let region: String?
    public let city: String?
    public let grade: String?
    public let registered: Bool?

    /// City, region and country, skipping the parts that are missing or the
    /// placeholder the feed uses.
    public var place: String {
        [city, region, country]
            .compactMap { $0 }
            .filter { !$0.isEmpty && $0 != "Unassigned" }
            .joined(separator: ", ")
    }
}

public enum TeamDirectory {
    /// The feed spells the United States three ways, and ungrouped they sort
    /// into three separate menu rows with the teams split between them.
    public static func normalizeCountry(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "Unassigned" }
        switch value.lowercased() {
        case "usa", "us", "united states of america": return "United States"
        default: return value
        }
    }

    /// One row's searchable text, as lowercased UTF-8 bytes.
    ///
    /// Bytes rather than a String because of what a keystroke costs. Scanning
    /// 56,000 rows with `String.contains` takes about 44ms on a Mac and enough
    /// more on a phone to be felt as lag on every character typed; the same
    /// scan over bytes takes about 0.9ms, because it compares numbers instead
    /// of walking graphemes. Lowercased once here, not per keystroke.
    public static func haystack(_ team: DirectoryTeam) -> [UInt8] {
        Array("\(team.number) \(team.name ?? "") \(team.organization ?? "")".lowercased().utf8)
    }

    /// Substring search over bytes.
    static func contains(_ hay: [UInt8], _ needle: [UInt8]) -> Bool {
        guard !needle.isEmpty else { return true }
        guard needle.count <= hay.count else { return false }
        let first = needle[0]
        let limit = hay.count - needle.count
        var i = 0
        while i <= limit {
            if hay[i] == first {
                var j = 1
                while j < needle.count && hay[i + j] == needle[j] { j += 1 }
                if j == needle.count { return true }
            }
            i += 1
        }
        return false
    }

    public struct Filters: Sendable, Hashable {
        public var country: String?
        public var region: String?
        public var grade: String?

        public init(country: String? = nil, region: String? = nil, grade: String? = nil) {
            self.country = country
            self.region = region
            self.grade = grade
        }
    }

    /// The countries present, and the regions inside `country` when one is
    /// chosen. Both include inactive teams, which is the point of a directory.
    public static func locations(_ teams: [DirectoryTeam], country: String? = nil)
        -> (countries: [String], regions: [String]) {
        let countries = Set(teams.map { normalizeCountry($0.country) }).sorted()
        let scoped = country.map { name in
            teams.filter { normalizeCountry($0.country) == name }
        } ?? teams
        let regions = Set(scoped.map { team -> String in
            guard let region = team.region, !region.isEmpty else { return "Unassigned" }
            return region
        }).sorted()
        return (countries, regions)
    }

    /// Matching teams, best guess first.
    ///
    /// `indexed` is the teams paired with their lowercased haystack.
    public static func search(_ indexed: [(team: DirectoryTeam, haystack: [UInt8])],
                              query: String,
                              filters: Filters = Filters()) -> [DirectoryTeam] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let tokens = needle.split(whereSeparator: \.isWhitespace).map { Array($0.utf8) }

        let matched = indexed.filter { entry in
            let team = entry.team
            if let country = filters.country, normalizeCountry(team.country) != country { return false }
            if let region = filters.region, (team.region ?? "Unassigned") != region { return false }
            if let grade = filters.grade, team.grade != grade { return false }
            // Every token must appear, so "robotics club ohio" narrows rather
            // than widens. A bare number matches its whole family because the
            // haystack starts with the number: "2011" is inside "2011a".
            return tokens.allSatisfy { Self.contains(entry.haystack, $0) }
        }

        return matched
            .sorted { a, b in
                let pa = priority(a.team.number, needle), pb = priority(b.team.number, needle)
                if pa != pb { return pa < pb }
                if !TeamNumber.same(a.team.number, b.team.number) {
                    return TeamNumber.precedes(a.team.number, b.team.number)
                }
                return a.team.id < b.team.id
            }
            .map(\.team)
    }

    /// An exact number beats a number that starts with the query, which beats
    /// a match found in a name or an organization. Searching "2011A" should
    /// not bury 2011A under a club that happens to mention it.
    static func priority(_ number: String, _ needle: String) -> Int {
        guard !needle.isEmpty else { return 2 }
        let lowered = number.lowercased()
        if lowered == needle { return 0 }
        if lowered.hasPrefix(needle) { return 1 }
        return 2
    }
}

/// How team numbers order.
///
/// A plain string comparison is wrong for them: it puts "10188S" before
/// "2731K", because it reaches "0" against "7" at the second character and
/// stops. Numbers have to be compared as numbers, which is what `.numeric`
/// does - so every list of teams sorts through here rather than with `<`.
public enum TeamNumber {
    public static func precedes(_ a: String, _ b: String) -> Bool {
        a.compare(b, options: [.numeric, .caseInsensitive]) == .orderedAscending
    }

    /// Equal under the same rules `precedes` uses, so a tie-break can tell
    /// "equal" from "before".
    public static func same(_ a: String, _ b: String) -> Bool {
        a.compare(b, options: [.numeric, .caseInsensitive]) == .orderedSame
    }
}
