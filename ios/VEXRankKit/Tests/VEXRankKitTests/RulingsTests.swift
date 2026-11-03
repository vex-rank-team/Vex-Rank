import XCTest
@testable import VEXRankKit

/// Mirrors website/tests/disqualifications.test.mjs.
final class RulingsTests: XCTestCase {
    private func side(_ color: String, _ score: Int, _ teams: String...) -> [String: Any] {
        ["color": color, "score": score, "teams": teams.enumerated().map { ["team": ["id": $0.offset + score * 10 + color.count, "name": $0.element]] }]
    }
    private func division(_ matches: [(Int, [String: Any], [String: Any])], rankings: [(String, Int, Int, Int)]) throws -> Division {
        let json: [String: Any] = [
            "id": 1, "name": "Division 1",
            "matches": matches.map { ["id": $0.0, "name": "Qualifier #\($0.0)", "round": 2, "alliances": [$0.1, $0.2]] },
            "rankings": rankings.enumerated().map { ["rank": $0.offset + 1, "team": ["id": $0.offset + 1000, "name": $0.element.0], "wins": $0.element.1, "losses": $0.element.2, "ties": $0.element.3] },
        ]
        return try JSONDecoder().decode(Division.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testIQZeroStationBesideAScoringPartnerIsADQ() throws {
        let d = try division([(1, side("red", 144, "19970A"), side("blue", 0, "5216A")), (2, side("red", 0, "1A"), side("blue", 0, "2A"))], rankings: [])
        let rulings = d.officialRulings(iq: true)
        XCTAssertEqual(rulings.ruling(match: 1, team: "5216A"), .dq)
        XCTAssertNil(rulings.ruling(match: 1, team: "19970A"))
        XCTAssertNil(rulings.byMatch[2], "an unplayed 0-0 is not a DQ")
        let partial = try division([(3, side("red", 90, "7A"), side("blue", 85, "8A"))], rankings: []).officialRulings(iq: true)
        XCTAssertEqual(partial.ruling(match: 3, team: "8A"), .dq, "any mismatch marks the lower station, as OpenScout does")
    }

    func testV5DQTeamLosesOpponentsWinPartnerKeepsResult() throws {
        // Caution Tape Q49 in miniature.
        let d = try division([(49, side("red", 28, "252H", "10909N"), side("blue", 160, "252W", "16610A"))],
                             rankings: [("252W", 0, 1, 0), ("16610A", 1, 0, 0), ("252H", 1, 0, 0), ("10909N", 1, 0, 0)])
        let rulings = d.officialRulings(iq: false)
        XCTAssertEqual(rulings.ruling(match: 49, team: "252W"), .dq)
        XCTAssertNil(rulings.ruling(match: 49, team: "16610A"))
    }

    func testV5BothPartnersDisqualified() throws {
        let d = try division([(89, side("red", 83, "2145V", "32K"), side("blue", 93, "2567U", "2567M"))],
                             rankings: [("2567U", 0, 1, 0), ("2567M", 0, 1, 0), ("2145V", 1, 0, 0), ("32K", 1, 0, 0)])
        let rulings = d.officialRulings(iq: false)
        XCTAssertEqual(rulings.ruling(match: 89, team: "2567U"), .dq)
        XCTAssertEqual(rulings.ruling(match: 89, team: "2567M"), .dq)
    }

    func testV5ADQAndAGivenWinCanCancelOut() throws {
        let d = try division([(1, side("red", 26, "3300Z", "2088V"), side("blue", 51, "2551A", "45519J")),
                              (24, side("red", 60, "14353S", "210B"), side("blue", 28, "3388H", "2551A"))],
                             rankings: [("2551A", 1, 1, 0), ("45519J", 1, 0, 0), ("3300Z", 1, 0, 0), ("2088V", 1, 0, 0),
                                        ("14353S", 1, 0, 0), ("210B", 0, 1, 0), ("3388H", 1, 0, 0)])
        let rulings = d.officialRulings(iq: false)
        XCTAssertEqual(rulings.ruling(match: 1, team: "2551A"), .dq)
        XCTAssertEqual(rulings.ruling(match: 24, team: "210B"), .dq)
    }

    func testV5AmbiguousGapMarksNothing() throws {
        let d = try division([(1, side("red", 50, "A1", "B1"), side("blue", 10, "C1", "D1")),
                              (2, side("red", 60, "A1", "B1"), side("blue", 20, "C1", "D1"))],
                             rankings: [("A1", 1, 1, 0), ("B1", 2, 0, 0), ("C1", 1, 1, 0), ("D1", 1, 1, 0)])
        XCTAssertTrue(d.officialRulings(iq: false).byMatch.isEmpty)
    }
}
