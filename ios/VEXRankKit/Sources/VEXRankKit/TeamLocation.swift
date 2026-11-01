import Foundation

/// Choosing which of the feeds' answers to a team's location to show.
///
/// The two endpoints disagree about what "region" means. The teams endpoint
/// builds "Canterbury, Victoria, Australia"; the rankings feed builds
/// "Victoria, Australia", because it feeds a table column with no room for a
/// city. A profile that read the ranking first lost the city precisely when a
/// team was ranked, and kept it when the team was not - which is why it looked
/// intermittent.
public enum TeamLocation {
    /// The candidate naming the most places, earlier candidates breaking ties.
    ///
    /// Comparing detail rather than naming a preferred feed means this cannot
    /// get worse if either changes shape again.
    public static func best(of candidates: [String?]) -> String? {
        let usable = candidates
            .compactMap { $0 }
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && $0.caseInsensitiveCompare("Unassigned") != .orderedSame }
        guard var best = usable.first else { return nil }
        for candidate in usable.dropFirst() where places(in: candidate) > places(in: best) {
            best = candidate
        }
        return best
    }

    /// How many places a location names. "Unassigned" placeholders and stray
    /// separators do not count.
    public static func places(in region: String) -> Int {
        region.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && $0.caseInsensitiveCompare("Unassigned") != .orderedSame }
            .count
    }
}
