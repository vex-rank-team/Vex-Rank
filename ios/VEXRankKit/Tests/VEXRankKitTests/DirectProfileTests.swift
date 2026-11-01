import XCTest
@testable import VEXRankKit

/// The direct profile is built from raw events.vex records and must decode as
/// the same `TeamProfileResponse` the Worker sends, so the screen and
/// `merging` treat both alike.
final class DirectProfileTests: XCTestCase {
    private func sample(program: Program = .v5rc) throws -> TeamProfileResponse {
        let override: [String: Any] = ["id": 204, "name": "VEX V5 Robotics Competition 2026-2027: Override"]
        let json = DirectProfile.build(
            team: ["id": 7, "number": "229V", "team_name": "Ace", "organization": "Ace Robotics",
                   "robot_name": "", "grade": "High School", "registered": true,
                   "location": ["city": "Austin", "region": "Texas", "country": "United States"]],
            events: [
                ["id": 1, "sku": "RE-1", "name": "Older", "start": "2026-09-01", "season": override, "location": [:]],
                ["id": 2, "sku": "RE-2", "name": "Newer", "start": "2026-10-01", "season": override,
                 "location": ["city": "Dallas", "country": "United States"]],
            ],
            rankings: [["event": ["id": 2, "name": "Newer"], "division": ["name": "Div 1"],
                        "rank": 3, "wins": 5, "losses": 1, "ties": 0, "wp": 10, "high_score": 120]],
            awards: [["event": ["id": 2, "name": "Newer"], "title": "Excellence Award"]],
            skills: [["event": ["id": 1, "name": "Older"], "type": "driver", "score": 40, "season": override],
                     ["event": ["id": 2, "name": "Newer"], "type": "programming", "score": 60, "season": override]],
            season: 204, program: program)
        return try JSONDecoder().decode(TeamProfileResponse.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testOfficialRecordsDecodeAsAProfile() throws {
        let profile = try sample()
        XCTAssertEqual(profile.team.number, "229V")
        XCTAssertEqual(profile.team.region, "Austin, Texas, United States")
        XCTAssertEqual(profile.team.currentSeasonEvents, 2)
        XCTAssertEqual(profile.events?.map(\.name), ["Newer", "Older"], "newest first, as the Worker sends them")
        XCTAssertEqual(profile.rankings?.first?.seasonId, 204, "a standing takes its season from its event")
        XCTAssertEqual(profile.rankings?.first?.highScore, 120)
        XCTAssertEqual(profile.awards?.first?.title, "Excellence Award")
        XCTAssertEqual(profile.skills?.map(\.score), [60, 40], "best run first")
        XCTAssertEqual(profile.loadedSeasonIds, [204])
    }

    func testCalculatedPartsAreLeftForTheWorker() throws {
        let profile = try sample()
        XCTAssertTrue(profile.ratingHistory.isEmpty)
        XCTAssertNil(profile.seasonGrades)
        XCTAssertNil(profile.events?.first?.elimination)
        // Not "pending": VEX IQ ratings are published, and the Worker's
        // profile brings the team's VIQCR history.
        XCTAssertNil(try sample(program: .viqrc).ratingStatus)
    }

    func testTheWorkersProfileReplacesTheDirectRowsForItsSeason() throws {
        let direct = try sample()
        let worker = try JSONDecoder().decode(TeamProfileResponse.self, from: JSONSerialization.data(withJSONObject: [
            "team": ["id": 7, "number": "229V", "name": "Ace", "organization": "Ace Robotics", "robot": "",
                     "grade": "High School", "region": "Austin, Texas, United States", "country": "United States",
                     "registered": true, "active": true, "currentSeasonEvents": 2, "seasons": 1],
            "ratingHistory": [["seasonId": 204, "eventId": 2, "event": "Newer", "eventDate": "2026-10-01T00:00:00Z",
                               "change": 12, "rating": 1512, "matches": 6]],
            "awards": [["title": "Excellence Award", "event": "Newer", "eventId": 2, "seasonId": 204]],
            "loadedSeasonIds": [204],
        ] as [String: Any]))
        let merged = direct.merging(worker)
        XCTAssertEqual(merged.ratingHistory.map(\.rating), [1512])
        XCTAssertEqual(merged.awards?.count, 1, "not one from each source")
    }
}
