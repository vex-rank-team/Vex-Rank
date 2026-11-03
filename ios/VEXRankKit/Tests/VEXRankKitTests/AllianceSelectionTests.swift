import XCTest
@testable import VEXRankKit

/// Mirrors website/tests/alliance-selection.test.mjs.
final class AllianceSelectionTests: XCTestCase {
    func testHigherRankedPartnerCaptainsAndCaptainsAreSeededByRank() throws {
        let ranks = [("19109A", 1), ("81208X", 2), ("252H", 9), ("19109Z", 20), ("3505Z", 26), ("3505E", 30)]
        func side(_ color: String, _ teams: String...) -> [String: Any] {
            ["color": color, "score": 0, "teams": teams.map { team in ["team": ["id": ranks.firstIndex { $0.0 == team }!, "name": team]] }]
        }
        let matches: [(Int, [String: Any], [String: Any])] = [
            (2, side("red", "252H", "3505Z"), side("blue", "81208X", "19109A")), // a qualifier: not an alliance
            (6, side("red", "19109Z", "19109A"), side("blue", "3505E", "3505Z")),
            (6, side("red", "252H", "81208X"), side("blue", "3505Z", "3505E")),
        ]
        let json: [String: Any] = [
            "id": 1, "name": "Division 1",
            "matches": matches.enumerated().map { ["id": $0.offset, "round": $0.element.0, "alliances": [$0.element.1, $0.element.2]] },
            "rankings": ranks.enumerated().map { ["rank": $0.element.1, "team": ["id": $0.offset, "name": $0.element.0], "wins": 0, "losses": 0, "ties": 0] },
        ]
        let division = try JSONDecoder().decode(Division.self, from: JSONSerialization.data(withJSONObject: json))
        let selections = division.allianceSelections
        XCTAssertEqual(selections.map { [String($0.seed), $0.captain, $0.pick] }, [["1", "19109A", "19109Z"], ["2", "81208X", "252H"], ["3", "3505Z", "3505E"]])
        XCTAssertEqual(selections[1].sentence, "81208X selects 252H as the 2nd seed alliance")
        XCTAssertTrue(selections[1].includes("252h"))
    }

    func testOrdinals() {
        XCTAssertEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(AllianceSelection.ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"])
    }
}
