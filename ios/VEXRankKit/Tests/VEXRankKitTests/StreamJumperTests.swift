import XCTest
@testable import VEXRankKit

/// Mirrors website/tests/stream-jumper.test.mjs.
final class StreamJumperTests: XCTestCase {
    func testYouTubeIDsAndChannels() {
        for link in ["https://www.youtube.com/watch?v=3XiT_3haGR4", "https://youtu.be/3XiT_3haGR4?t=5", "https://youtube.com/live/3XiT_3haGR4?feature=share", "https://www.youtube.com/embed/3XiT_3haGR4", "https://m.youtube.com/watch?v=3XiT_3haGR4&t=1"] {
            XCTAssertEqual(StreamJumper.youtubeID(link), "3XiT_3haGR4", link)
        }
        XCTAssertNil(StreamJumper.youtubeID("https://www.youtube.com/@CautionTape/streams"))
        XCTAssertEqual(StreamJumper.youtubeChannel("https://www.youtube.com/@WHRobotics1/streams"), "@WHRobotics1")
        XCTAssertEqual(StreamJumper.youtubeChannel("https://www.youtube.com/channel/UC-grQ9qvMoKXjtxOPDrC-yg"), "UC-grQ9qvMoKXjtxOPDrC-yg")
        XCTAssertEqual(StreamJumper.youtubeChannel("https://www.youtube.com/user/929HZR"), "user:929HZR")
        let result = StreamJumper.streams(webcast: "Live: https://www.youtube.com/watch?v=3XiT_3haGR4. Channel: https://www.youtube.com/@cautiontape", added: [EventStream(videoId: "3XiT_3haGR4"), EventStream(videoId: "abcdefghijk")])
        XCTAssertEqual(result.streams.map(\.videoId), ["3XiT_3haGR4", "abcdefghijk"])
        XCTAssertEqual(result.channels, ["@cautiontape"])
    }

    // MARK: - Fixtures

    private func at(_ clock: String) -> String { "2026-10-31T\(clock)-04:00" }
    private func row(_ id: Int, _ scheduled: String?, _ started: String?, played: Bool = true) -> [String: Any] {
        var row: [String: Any] = ["id": id, "name": "Q\(id)", "round": 2, "matchnum": id]
        if let scheduled { row["scheduled"] = at(scheduled) }
        if let started { row["started"] = at(started) }
        row["alliances"] = played ? [["color": "red", "score": 10], ["color": "blue", "score": 20]] : []
        return row
    }
    private func divisions(_ rows: [[String: Any]], id: Int = 1, name: String = "Division 1") throws -> [Division] {
        let json: [String: Any] = ["id": id, "name": name, "rankings": [], "matches": rows]
        return [try JSONDecoder().decode(Division.self, from: JSONSerialization.data(withJSONObject: json))]
    }
    private func jumps(_ divisions: [Division], _ streams: [EventStream], nudges: [String: Double] = [:]) -> (jumps: [Int: MatchJump], times: [Int: MatchTime], timelines: [String: StreamTimeline]) {
        StreamJumper.jumps(divisions: divisions, streams: streams, nudges: nudges, eventStart: "2026-10-31T00:00:00-04:00", eventEnd: "2026-10-31T23:59:00-04:00")
    }
    private func clock(_ minutes: Int) -> String { String(format: "%02d:%02d:00", minutes / 60, minutes % 60) }
    /// A real day: a match every five minutes, 9:30-12:00 and 13:00-16:00.
    private func day() -> [[String: Any]] {
        var rows: [[String: Any]] = [], id = 1
        for m in stride(from: 570, through: 720, by: 5) { rows.append(row(id, clock(m), clock(m))); id += 1 }
        for m in stride(from: 780, through: 960, by: 5) { rows.append(row(id, clock(m), clock(m))); id += 1 }
        return rows
    }

    // MARK: - Timing

    func testPlacedByWhenStartedNotScheduleOrPlayOrder() throws {
        let d = try divisions([row(1, "09:00:00", "09:33:13"), row(2, "09:04:00", "09:50:00"), row(3, "09:08:00", "09:40:00")])
        let j = jumps(d, [EventStream(videoId: "v1", startTime: at("09:25:42"))]).jumps
        XCTAssertEqual(j[1]?.seconds, 451)
        XCTAssertEqual(j[3]?.seconds, 858)
        XCTAssertEqual(j[2]?.seconds, 1458)
    }

    func testMissingStartIsEstimatedFromNeighbours() throws {
        let d = try divisions([row(1, "09:00:00", "09:30:00"), row(2, "09:10:00", nil), row(3, "09:20:00", "09:50:00"), row(4, "09:30:00", nil, played: false)])
        let result = jumps(d, [EventStream(videoId: "v1", startTime: at("09:00:00"))])
        XCTAssertEqual(result.jumps[2], MatchJump(videoId: "v1", seconds: 2400, estimated: true))
        XCTAssertNil(result.times[4], "not played")
    }

    func testBatchStampsAreTreatedAsMissing() throws {
        var rows = [row(1, "09:00:00", "09:30:00"), row(2, "09:10:00", "09:40:00")]
        for id in 3...6 { var entry = row(id, "10:0\(id):00", nil); entry["started"] = "2026-10-31T21:00:00-04:00"; rows.append(entry) }
        let times = StreamJumper.matchTimes(try divisions(rows)[0].matches ?? [], eventStart: "2026-10-31T00:00:00-04:00", eventEnd: "2026-10-31T23:00:00-04:00")
        for id in 3...6 { XCTAssertEqual(times[id]?.estimated, true, "match \(id)") }
    }

    func testDropoutOverLunch() throws {
        let rows = day()
        let d = try divisions(rows)
        let afterLunch = rows.first { $0["started"] as? String == at("13:00:00") }!["id"] as! Int
        let last = rows.last!["id"] as! Int
        let stream = EventStream(videoId: "v1", startTime: at("09:00:00"), endTime: at("17:00:00"), duration: 7 * 3600)
        let result = jumps(d, [stream])
        XCTAssertEqual(result.jumps[1]?.seconds, 1800, "before the dropout, from the start")
        XCTAssertEqual(result.jumps[afterLunch]?.seconds, 4 * 3600 - 3600 + 150)
        XCTAssertEqual(result.jumps[last]?.seconds, 7 * 3600 - 3600 + 150)
        XCTAssertEqual(result.timelines["v1"]?.dropouts.count, 1)
    }

    func testCorrectionsApplyFromTheirMatchOnAndFarOnesAreIgnored() throws {
        let d = try divisions([row(1, "09:30:00", "09:30:00"), row(2, "10:00:00", "10:00:00"), row(3, "14:00:00", "14:00:00")])
        let corrected = jumps(d, [EventStream(videoId: "v1", startTime: at("09:00:00"), anchors: [.init(matchId: 2, seconds: 3600 - 120)])]).jumps
        XCTAssertEqual(corrected[1]?.seconds, 1800, "the first half is left alone")
        XCTAssertEqual(corrected[2]?.seconds, 3480)
        XCTAssertEqual(corrected[3]?.seconds, 18000 - 120)
        let mistaken = jumps(d, [EventStream(videoId: "v1", startTime: at("09:00:00"), anchors: [.init(matchId: 2, seconds: 3600 - 40 * 60)])]).jumps
        XCTAssertEqual(mistaken[2]?.seconds, 3600)
    }

    func testUploadTimedFromCorrectionsAlone() throws {
        let d = try divisions([row(1, "09:30:00", "09:30:00"), row(2, "09:40:00", "09:40:00")])
        let stream = EventStream(videoId: "v1", anchors: [.init(matchId: 2, seconds: 700)])
        XCTAssertEqual(jumps(d, [stream]).jumps[1]?.seconds, 100)
        XCTAssertEqual(jumps(d, [stream], nudges: ["v1": -10]).jumps[1]?.seconds, 90)
        XCTAssertNil(jumps(d, [EventStream(videoId: "v2")]).jumps[1])
    }

    func testStreamsPerDivisionByTitleAndPerDay() throws {
        let science = try divisions([row(1, "09:30:00", "09:30:00")], id: 1, name: "Science")
        let technology = try divisions([row(2, "09:31:00", "09:31:00")], id: 2, name: "Technology")
        let j = jumps(science + technology, [EventStream(videoId: "sci", title: "Worlds - Science Division", startTime: at("09:00:00")),
                                             EventStream(videoId: "tec", title: "Worlds - Technology Division", startTime: at("09:10:00"))]).jumps
        XCTAssertEqual(j[1]?.videoId, "sci")
        XCTAssertEqual(j[2]?.videoId, "tec")
        let days = try divisions([row(1, "09:30:00", "09:30:00"), row(2, "15:00:00", "15:00:00")])
        let d = jumps(days, [EventStream(videoId: "am", startTime: at("09:00:00"), endTime: at("12:00:00"), duration: 3 * 3600), EventStream(videoId: "pm", startTime: at("13:00:00"))]).jumps
        XCTAssertEqual(d[1]?.videoId, "am")
        XCTAssertEqual(d[2]?.videoId, "pm")
        XCTAssertEqual(StreamJumper.videoTime(3725), "1:02:05")
    }

    func testACorrectionMovesTheDropoutToWhereItHappened() throws {
        // Caution Tape's shape: lunch is the longest pause, but 14 minutes went
        // missing during alliance selection (16:05-16:40).
        var rows = day().filter { ($0["started"] as! String) <= at("16:00:00") }
        var id = 500
        for m in stride(from: 1000, through: 1080, by: 5) { var entry = row(id, clock(m), clock(m)); entry["round"] = 6; rows.append(entry); id += 1 }
        let d = try divisions(rows)
        let afterLunch = rows.first { $0["started"] as? String == at("13:00:00") }!["id"] as! Int
        let afternoon = rows.first { $0["started"] as? String == at("15:00:00") }!["id"] as! Int
        var stream = EventStream(videoId: "v1", startTime: at("09:00:00"), endTime: at("18:30:00"), duration: 9.5 * 3600 - 14 * 60)
        XCTAssertEqual(jumps(d, [stream]).jumps[afterLunch]?.seconds, 4 * 3600 - 14 * 60, "unaided: lunch")
        stream.anchors = [.init(matchId: afterLunch, seconds: Double(4 * 3600))]
        let told = jumps(d, [stream])
        XCTAssertEqual(told.jumps[afterLunch]?.seconds, 4 * 3600)
        XCTAssertEqual(told.jumps[afternoon]?.seconds, 6 * 3600)
        XCTAssertEqual(told.jumps[500]?.seconds, (1000 - 540) * 60 - 14 * 60)
        XCTAssertEqual(told.timelines["v1"]?.dropouts.first?.confirmed, true)
    }

    func testTwoDayEventUsesEachDaysStream() throws {
        func row(_ id: Int, _ started: String) -> [String: Any] {
            ["id": id, "name": "Q\(id)", "round": 2, "started": started, "scheduled": started, "alliances": [["color": "red", "score": 10], ["color": "blue", "score": 20]]]
        }
        let d = try divisions([row(1, "2026-09-18T10:05:00-04:00"), row(2, "2026-09-18T16:30:00-04:00"), row(3, "2026-09-19T09:40:00-04:00"), row(4, "2026-09-19T17:20:00-04:00")])
        let day1 = EventStream(videoId: "day1", title: "Speedway - Day 1", startTime: "2026-09-18T10:00:40-04:00", endTime: "2026-09-18T17:41:34-04:00", duration: 27660)
        let day2 = EventStream(videoId: "day2", title: "Speedway - Day 2", startTime: "2026-09-19T09:30:00-04:00", endTime: "2026-09-19T18:10:00-04:00", duration: 31200)
        let both = StreamJumper.jumps(divisions: d, streams: [day1, day2], eventStart: "2026-09-18T00:00:00-04:00", eventEnd: "2026-09-20T00:00:00-04:00").jumps
        XCTAssertEqual(both[2]?.videoId, "day1")
        XCTAssertEqual(both[3], MatchJump(videoId: "day2", seconds: 600))
        XCTAssertEqual(both[4], MatchJump(videoId: "day2", seconds: 28200))
        let only = StreamJumper.jumps(divisions: d, streams: [day1], eventStart: "2026-09-18T00:00:00-04:00", eventEnd: "2026-09-20T00:00:00-04:00").jumps
        XCTAssertNil(only[3], "with only day 1 known, no jump past its end")
        XCTAssertEqual(StreamJumper.label(for: day2, index: 1, in: [day1, day2]), "Day 2")
        XCTAssertEqual(StreamJumper.label(for: EventStream(videoId: "x"), index: 0, in: []), "Stream 1")
    }
}
