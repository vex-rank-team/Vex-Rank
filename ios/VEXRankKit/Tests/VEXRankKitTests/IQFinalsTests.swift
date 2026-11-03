import XCTest
@testable import VEXRankKit

/// Mirrors the iqFinals test in website/tests/viqrc.test.mjs.
final class IQFinalsTests: XCTestCase {
    private func division(_ finals: [(Int, String, String, Int)]) throws -> Division {
        let matches = finals.map { id, a, b, score -> [String: Any] in
            ["id": id, "name": "Match #\(id)", "round": 15, "instance": 1, "matchnum": id, "scheduled": "2026-11-01T1\(id):00:00Z",
             "alliances": [["color": "red", "score": score, "teams": [["team": ["id": id * 10, "name": a]]]],
                           ["color": "blue", "score": score, "teams": [["team": ["id": id * 10 + 1, "name": b]]]]]]
        } + [["id": 99, "name": "TeamWork #1", "round": 2, "alliances": [
            ["color": "red", "score": 50, "teams": [["team": ["id": 1, "name": "1A"]]]],
            ["color": "blue", "score": 50, "teams": [["team": ["id": 3, "name": "3A"]]]]]]]
        let json: [String: Any] = ["id": 1, "name": "Middle School", "rankings": [], "matches": matches]
        return try JSONDecoder().decode(Division.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testPlacedByScoreWithSharedPlacesAndTiebreaks() throws {
        let finals = try division([(1, "1A", "2A", 180), (2, "3A", "4A", 200), (3, "5A", "6A", 180), (4, "7A", "8A", 0)])
        XCTAssertEqual(finals.iqFinals.count, 4, "qualification matches are not finals")
        XCTAssertTrue(finals.elimination.isEmpty, "IQ finals are not a V5 bracket")
        XCTAssertEqual(finals.iqFinalPlaces.map { [String($0.place), $0.id, String($0.score)] },
                       [["1", "3A+4A", "200"], ["2", "1A+2A", "180"], ["2", "5A+6A", "180"]])
        let tiebroken = try division([(1, "1A", "2A", 180), (2, "3A", "4A", 200), (3, "5A", "6A", 180), (5, "5A", "6A", 190), (6, "1A", "2A", 170)])
        XCTAssertEqual(tiebroken.iqFinalPlaces.map { "\($0.place) \($0.id)" }, ["1 3A+4A", "2 5A+6A", "3 1A+2A"])
    }
}
