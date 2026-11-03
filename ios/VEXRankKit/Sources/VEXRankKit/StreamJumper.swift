import Foundation

/// The jumper, after OpenScout's: an event's livestream beside its schedule,
/// and a jump from any played match to the moment it started. Mirrors
/// website/lib/stream-jumper.mjs - see there for the reasoning in full.
///
/// - When a match was played: its own recorded start, so play order never
///   matters; for a played match with none, its scheduled time plus the delay
///   its neighbours ran at (marked estimated). Impossible stamps are dropped.
/// - Where that is in the video: from YouTube's broadcast start, end and saved
///   length. Time the stream was down is missing from the video; it is placed
///   in the event's longest pauses, so later matches line up from the end.
/// - Corrections: "this match starts here", from that match on; one more than
///   20 minutes off YouTube's timing is a mistake. Uploads use them alone.
public struct EventStream: Codable, Sendable, Hashable, Identifiable {
    public struct Anchor: Codable, Sendable, Hashable {
        public let matchId: Int
        public let seconds: Double
        public init(matchId: Int, seconds: Double) { self.matchId = matchId; self.seconds = seconds }
    }
    public typealias Sync = Anchor

    public let videoId: String
    public var url: String?
    public var divisionId: Int?
    public var title: String?
    public var startTime: String?
    public var endTime: String?
    public var duration: Double?
    public var anchors: [Anchor]?
    /// The older single correction, still read.
    public var sync: Anchor?
    public var notLive: Bool?
    /// "event" (the organizer's webcast notes), "viewer" (added), or nil (found on a channel).
    public var source: String?
    public var addedAt: String?

    public var id: String { videoId }

    public init(videoId: String, url: String? = nil, divisionId: Int? = nil, title: String? = nil, startTime: String? = nil,
                endTime: String? = nil, duration: Double? = nil, anchors: [Anchor]? = nil, sync: Anchor? = nil, source: String? = nil) {
        self.videoId = videoId; self.url = url; self.divisionId = divisionId; self.title = title; self.startTime = startTime
        self.endTime = endTime; self.duration = duration; self.anchors = anchors; self.sync = sync; self.source = source
    }

    var allAnchors: [Anchor] { (anchors ?? []) + (sync.map { [$0] } ?? []) }
}

public struct SharedStreamsResponse: Codable, Sendable {
    public let streams: [EventStream]
}

public struct MatchJump: Sendable, Hashable {
    public let videoId: String
    public let seconds: Int
    public var estimated: Bool = false
    public init(videoId: String, seconds: Int, estimated: Bool = false) { self.videoId = videoId; self.seconds = seconds; self.estimated = estimated }
}

/// When a match was played, and whether that was estimated.
public struct MatchTime: Sendable, Hashable {
    public let time: Date
    public let estimated: Bool
}

/// Time the stream was down, left out of the video: every match from `at` on sits `seconds` earlier.
public struct Dropout: Sendable, Hashable {
    public let at: Date
    public let seconds: Double
    /// Placed by viewers' corrections rather than guessed from the pauses.
    public var confirmed: Bool = false
}

/// One stream's mapping from the clock to the video.
public struct StreamTimeline: Sendable {
    public let origin: Date
    public let end: Date?
    public let duration: Double?
    public let dropouts: [Dropout]
    public let corrections: Int
    public let automatic: Bool
    let base: (start: Date, dropouts: [Dropout])?
    let marks: [(t: Date, seconds: Double)]

    func baseSeconds(_ t: Date) -> Double? {
        guard let base else { return nil }
        return t.timeIntervalSince(base.start) - base.dropouts.filter { $0.at <= t }.reduce(0) { $0 + $1.seconds }
    }

    /// Seconds into the video for a moment on the clock.
    public func seconds(at t: Date) -> Double {
        let mark = marks.last { $0.t <= t }
        if let value = baseSeconds(t) {
            guard let mark, let markBase = baseSeconds(mark.t) else { return value }
            return value + mark.seconds - markBase
        }
        let anchor = mark ?? marks[0]
        return anchor.seconds + t.timeIntervalSince(anchor.t)
    }
}

public enum StreamJumper {
    static let matchLength: TimeInterval = 150
    static let correctionLimit: TimeInterval = 20 * 60
    static let batchStamp = 4

    /// The YouTube video id in a link, or nil. Channel and playlist links have none.
    public static func youtubeID(_ link: String) -> String? {
        guard let url = URL(string: link.trimmingCharacters(in: .whitespacesAndNewlines)), let rawHost = url.host?.lowercased() else { return nil }
        let host = rawHost.replacingOccurrences(of: #"^(www|m|music)\."#, with: "", options: .regularExpression)
        let parts = url.path.split(separator: "/").map(String.init)
        var id: String?
        if host == "youtu.be" { id = parts.first }
        else if host == "youtube.com" || host == "youtube-nocookie.com" {
            if parts.first == "watch" { id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "v" }?.value }
            else if let kind = parts.first, ["live", "embed", "shorts", "v"].contains(kind), parts.count > 1 { id = parts[1] }
        }
        guard let id, id.range(of: #"^[A-Za-z0-9_-]{11}$"#, options: .regularExpression) != nil else { return nil }
        return id
    }

    /// A YouTube channel in a link - "@handle", "UC…", or "user:Name" - or nil.
    public static func youtubeChannel(_ link: String) -> String? {
        guard let url = URL(string: link.trimmingCharacters(in: .whitespacesAndNewlines)), let rawHost = url.host?.lowercased() else { return nil }
        let host = rawHost.replacingOccurrences(of: #"^(www|m)\."#, with: "", options: .regularExpression)
        guard host == "youtube.com" else { return nil }
        let parts = url.path.split(separator: "/").map { String($0).removingPercentEncoding ?? String($0) }
        guard let first = parts.first else { return nil }
        let second = parts.count > 1 ? parts[1] : ""
        func matches(_ value: String, _ pattern: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }
        if matches(first, #"^@[\w.-]{3,30}$"#) { return first }
        if first == "channel", matches(second, #"^UC[\w-]{22}$"#) { return second }
        if first == "user", matches(second, #"^[\w.-]{2,40}$"#) { return "user:\(second)" }
        if first == "c", matches(second, #"^[\w.-]{2,40}$"#) { return "@\(second)" }
        return nil
    }

    /// Every link in a block of text, in order, once each.
    public static func links(in text: String?) -> [String] {
        guard let text, let regex = try? NSRegularExpression(pattern: #"https?://[^\s<>"')\]]+"#) else { return [] }
        var seen = Set<String>(), found: [String] = []
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let range = Range(match.range, in: text) else { continue }
            let link = String(text[range]).replacingOccurrences(of: #"[.,;:!?]+$"#, with: "", options: .regularExpression)
            if seen.insert(link).inserted { found.append(link) }
        }
        return found
    }

    /// The event's streams: YouTube videos in its webcast notes, then found or
    /// added ones, once per video; channel links (for the Worker to search) and
    /// other links (to open as plain links) come back separately.
    public static func streams(webcast: String?, added: [EventStream] = []) -> (streams: [EventStream], others: [String], channels: [String]) {
        var streams: [EventStream] = [], others: [String] = [], channels: [String] = [], seen = Set<String>()
        for link in links(in: webcast) {
            if let id = youtubeID(link) {
                if seen.insert(id).inserted { streams.append(EventStream(videoId: id, url: link, source: "event")) }
            } else {
                others.append(link)
                if let channel = youtubeChannel(link), !channels.contains(channel) { channels.append(channel) }
            }
        }
        for stream in added where seen.insert(stream.videoId).inserted {
            var copy = stream
            if copy.source == nil && copy.addedAt != nil { copy.source = "viewer" }
            streams.append(copy)
        }
        return (streams, others, channels)
    }

    static func time(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }

    /// When each played match was played, by match id. See the note at the top.
    public static func matchTimes(_ matches: [DivisionMatch], eventStart: String? = nil, eventEnd: String? = nil) -> [Int: MatchTime] {
        let low = time(eventStart).map { $0.addingTimeInterval(-86400) } ?? .distantPast
        let high = time(eventEnd).map { $0.addingTimeInterval(2 * 86400) } ?? .distantFuture
        var stamps: [Date: Int] = [:]
        for match in matches { if let t = time(match.started) { stamps[t, default: 0] += 1 } }
        var times: [Int: MatchTime] = [:], delays: [(scheduled: Date, delay: TimeInterval)] = []
        for match in matches {
            guard let t = time(match.started), t >= low, t <= high, (stamps[t] ?? 0) < batchStamp else { continue }
            times[match.id] = MatchTime(time: t, estimated: false)
            if let scheduled = time(match.scheduled) { delays.append((scheduled, t.timeIntervalSince(scheduled))) }
        }
        delays.sort { $0.scheduled < $1.scheduled }
        for match in matches where times[match.id] == nil && match.isPlayed {
            guard let scheduled = time(match.scheduled), !delays.isEmpty else { continue }
            let before = delays.last { $0.scheduled <= scheduled }, after = delays.first { $0.scheduled > scheduled }
            let delay: TimeInterval
            if let before, let after {
                delay = before.delay + (after.delay - before.delay) * scheduled.timeIntervalSince(before.scheduled) / max(1, after.scheduled.timeIntervalSince(before.scheduled))
            } else { delay = (before ?? after)!.delay }
            times[match.id] = MatchTime(time: scheduled.addingTimeInterval(delay), estimated: true)
        }
        return times
    }

    /// Where YouTube's archive left out time the stream was down. Without
    /// evidence, in the longest pauses; with corrections (`marks`), in the
    /// pause that agrees with them - one mark after the true dropout moves it there.
    public static func placeDropouts(start: Date, end: Date, duration: Double, times: [Date], marks: [(t: Date, seconds: Double)] = []) -> [Dropout] {
        let missing = end.timeIntervalSince(start) - duration
        guard missing > 20 else { return [] }
        let played = times.filter { $0 >= start && $0 <= end }.sorted()
        guard let first = played.first, let last = played.last else { return [] }
        struct Slot { let at: Date?; let room: Double; let weight: Double }
        var slots = [Slot(at: first, room: first.timeIntervalSince(start), weight: 0.5)]
        for (a, b) in zip(played, played.dropFirst()) {
            let room = b.timeIntervalSince(a) - matchLength
            if room > 0 { slots.append(Slot(at: b, room: room, weight: 1)) }
        }
        slots.append(Slot(at: nil, room: end.timeIntervalSince(last) - matchLength, weight: 0.5))
        slots.sort { $0.room * $0.weight > $1.room * $1.weight }
        let useful = marks.filter { $0.t >= start && $0.t <= end }
        if !useful.isEmpty {
            func misfit(_ at: Date?) -> Double {
                useful.reduce(0) { sum, mark in
                    let shifted = mark.t.timeIntervalSince(start) - ((at.map { $0 <= mark.t } ?? false) ? missing : 0)
                    return sum + min(600, abs(mark.seconds - shifted))
                }
            }
            var best: (slot: Slot, score: Double)?
            for slot in slots where slot.room >= missing * 0.9 {
                let score = misfit(slot.at)
                if best == nil || score < best!.score - 1 { best = (slot, score) } // ties keep the likelier pause
            }
            if let best { return best.slot.at.map { [Dropout(at: $0, seconds: missing, confirmed: true)] } ?? [] }
        }
        var gaps: [Dropout] = [], left = missing
        for slot in slots where left > 0 {
            let take = min(max(0, slot.room), left)
            guard take > 0 else { continue }
            if let at = slot.at { gaps.append(Dropout(at: at, seconds: take)) }
            left -= take
        }
        // More missing than any pause holds: the start of the archive is gone.
        if left > 1 { gaps.append(Dropout(at: first, seconds: left)) }
        return gaps
    }

    /// One stream's timeline, or nil when nothing times it.
    public static func timeline(for stream: EventStream, times: [Int: MatchTime]) -> StreamTimeline? {
        let start = time(stream.startTime), end = time(stream.endTime)
        let duration = (stream.duration ?? 0) > 0 ? stream.duration : nil
        let raw = stream.allAnchors.compactMap { anchor -> (t: Date, seconds: Double)? in
            guard let t = times[anchor.matchId]?.time, anchor.seconds >= 0 else { return nil }
            return (t, anchor.seconds)
        }
        // Corrections first say where the dropout was; what they still disagree by is a correction proper.
        var dropouts: [Dropout] = []
        if let start, let end, let duration { dropouts = placeDropouts(start: start, end: end, duration: duration, times: times.values.map(\.time), marks: raw) }
        let base = start.map { (start: $0, dropouts: dropouts) }
        let probe = StreamTimeline(origin: start ?? .distantPast, end: end, duration: duration, dropouts: dropouts, corrections: 0, automatic: start != nil, base: base, marks: [])
        let marks = raw
            .filter { mark in probe.baseSeconds(mark.t).map { abs(mark.seconds - $0) <= correctionLimit } ?? true }
            .sorted { $0.t < $1.t }
        if base == nil && marks.isEmpty { return nil }
        let origin = start ?? marks[0].t.addingTimeInterval(-marks[0].seconds)
        return StreamTimeline(origin: origin, end: end, duration: duration, dropouts: dropouts, corrections: marks.count, automatic: start != nil, base: base, marks: marks)
    }

    /// Every match's jump. A match is on the stream for its division (or for
    /// every division, or titled with its division's name) that was running
    /// when it was played; failing that, the one that began most recently before.
    public static func jumps(divisions: [Division], streams: [EventStream], nudges: [String: Double] = [:],
                             eventStart: String? = nil, eventEnd: String? = nil) -> (jumps: [Int: MatchJump], times: [Int: MatchTime], timelines: [String: StreamTimeline]) {
        let matches = divisions.flatMap { $0.matches ?? [] }
        let divisionOf = Dictionary(divisions.flatMap { division in (division.matches ?? []).map { ($0.id, division.id) } }, uniquingKeysWith: { first, _ in first })
        let times = matchTimes(matches, eventStart: eventStart, eventEnd: eventEnd)
        let multiple = divisions.filter { !($0.matches ?? []).isEmpty }.count > 1
        let timed: [(stream: EventStream, division: Int?, timeline: StreamTimeline)] = streams.compactMap { stream in
            guard let timeline = timeline(for: stream, times: times) else { return nil }
            var division = stream.divisionId
            if division == nil, multiple, let title = stream.title?.lowercased() {
                division = divisions.first { !$0.name.isEmpty && title.contains($0.name.lowercased()) }?.id
            }
            return (stream, division, timeline)
        }
        var jumps: [Int: MatchJump] = [:]
        for match in matches {
            guard let when = times[match.id] else { continue }
            let fits = timed.filter { $0.division == nil || $0.division == divisionOf[match.id] }
            let running = fits.filter { $0.timeline.origin <= when.time && ($0.timeline.end.map { when.time <= $0.addingTimeInterval(matchLength) } ?? true) }
            let pool = running.isEmpty ? fits.filter { $0.timeline.origin <= when.time } : running
            guard let pick = pool.max(by: { $0.timeline.origin < $1.timeline.origin }) else { continue }
            let seconds = (pick.timeline.seconds(at: when.time) + (nudges[pick.stream.videoId] ?? 0)).rounded()
            guard seconds >= 0, pick.timeline.duration.map({ seconds <= $0 + 60 }) ?? true else { continue }
            jumps[match.id] = MatchJump(videoId: pick.stream.videoId, seconds: Int(seconds), estimated: when.estimated)
        }
        return (jumps, times, Dictionary(timed.map { ($0.stream.videoId, $0.timeline) }, uniquingKeysWith: { first, _ in first }))
    }

    /// "Day 2" when the title says so, else the day it went live, else "Stream 2".
    public static func label(for stream: EventStream, index: Int, in all: [EventStream]) -> String {
        if let title = stream.title, let range = title.range(of: #"(?i)\bday\s*(\d+)\b"#, options: .regularExpression),
           let number = title[range].split(whereSeparator: { !$0.isNumber }).last {
            return "Day \(number)"
        }
        let days = Set(all.compactMap { time($0.startTime).map { Calendar.current.startOfDay(for: $0) } })
        if days.count > 1, let start = time(stream.startTime) { return start.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) }
        return "Stream \(index + 1)"
    }

    /// "1:02:03" / "4:05" for a video position.
    public static func videoTime(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.rounded())), h = s / 3600, m = s % 3600 / 60, r = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, r) : String(format: "%d:%02d", m, r)
    }
}

extension EventDetailResponse {
    /// Every match at the event by id.
    public var matchesByID: [Int: DivisionMatch] {
        Dictionary(divisions.flatMap { $0.matches ?? [] }.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }
}
