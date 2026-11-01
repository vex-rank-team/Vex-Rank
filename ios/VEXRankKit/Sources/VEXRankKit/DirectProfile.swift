import Foundation

/// Team profiles read straight from events.vex, with the token built into the
/// app (App/Config/Base.xcconfig -> App/Info.plist).
///
/// Only the official records come this way: the team, its events, standings,
/// awards and skills runs. What the Worker works out - the rating graph, each
/// season's grade, elimination results - is left empty here and arrives with
/// the Worker's profile, which `TeamProfileResponse.merging` folds over this
/// one. So a team opened for the first time shows its records as soon as
/// events.vex answers, and the graph fills in after.
///
/// The token is readable by anyone who unpacks the app. That was a deliberate
/// choice; it never enters the repository.
public enum DirectProfile {
    static let root = "https://events.vex.com/api/v2"

    /// The built-in token, or nil when the build has none.
    public static var token: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "VEXDirectToken") as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        // An unset build setting can arrive unexpanded.
        return trimmed.isEmpty || trimmed.hasPrefix("$(") ? nil : trimmed
    }

    /// One season of `number`'s official records, or nil for any failure - no
    /// token, a rejected or rate-limited token, no such team, no network. The
    /// caller always has the Worker to fall back on.
    public static func profile(number: String, season: Int, program: Program,
                               token: String? = DirectProfile.token,
                               session: URLSession = .shared) async -> TeamProfileResponse? {
        guard let token else { return nil }
        let client = Client(token: token, session: session)
        do {
            let programId = program.isIQ ? 41 : 1
            let teams = try await client.collection("teams", ["number[]": number, "program[]": String(programId)])
            guard let team = teams.first(where: {
                ($0["number"] as? String)?.caseInsensitiveCompare(number) == .orderedSame
            }), let id = team["id"] as? Int else { return nil }

            let scoped = ["season[]": String(season)]
            async let events = client.pages("teams/\(id)/events", [:])
            async let rankings = client.pages("teams/\(id)/rankings", scoped)
            async let awards = client.pages("teams/\(id)/awards", scoped)
            async let skills = client.pages("teams/\(id)/skills", scoped)
            let json = build(team: team,
                             events: try Client.rows(await events),
                             rankings: try Client.rows(await rankings),
                             awards: try Client.rows(await awards),
                             skills: try Client.rows(await skills),
                             season: season, program: program)
            return try JSONDecoder().decode(TeamProfileResponse.self,
                                            from: JSONSerialization.data(withJSONObject: json))
        } catch {
            return nil
        }
    }

    /// The Worker's profile shape (lib/team-profile-build.ts), from raw
    /// events.vex records, minus the parts the Worker calculates.
    static func build(team: [String: Any], events: [[String: Any]], rankings: [[String: Any]],
                      awards: [[String: Any]], skills: [[String: Any]],
                      season: Int, program: Program) -> [String: Any] {
        func text(_ value: Any?) -> String? { (value as? String).flatMap { $0.isEmpty ? nil : $0 } }
        func place(_ location: Any?) -> [String] {
            let location = location as? [String: Any]
            return ["city", "region", "country"].compactMap { text(location?[$0]) }
        }
        func seasonId(_ row: [String: Any]) -> Int? { (row["season"] as? [String: Any])?["id"] as? Int }
        func eventId(_ row: [String: Any]) -> Int? { (row["event"] as? [String: Any])?["id"] as? Int }
        func eventName(_ row: [String: Any]) -> String {
            let event = row["event"] as? [String: Any]
            return text(event?["name"]) ?? text(event?["code"]) ?? "Official event"
        }

        let sortedEvents = events.sorted { (text($0["start"]) ?? "") > (text($1["start"]) ?? "") }
        let eventsById = Dictionary(sortedEvents.compactMap { event in (event["id"] as? Int).map { ($0, event) } },
                                    uniquingKeysWith: { first, _ in first })
        let seasonOf = { (id: Int?) -> (id: Int?, name: String) in
            let event = id.flatMap { eventsById[$0] }
            let season = event?["season"] as? [String: Any]
            return (season?["id"] as? Int, text(season?["name"]) ?? "")
        }
        let seasonIds = Set(sortedEvents.compactMap(seasonId))
        let current = sortedEvents.filter { seasonId($0) == season }
        let location = team["location"] as? [String: Any]

        var profile: [String: Any] = [
            "team": [
                "id": team["id"] as? Int ?? 0,
                "number": text(team["number"]) ?? "",
                "name": text(team["team_name"]) ?? text(team["organization"]) ?? text(team["number"]) ?? "",
                "organization": text(team["organization"]) ?? "",
                "robot": text(team["robot_name"]) ?? "",
                "grade": text(team["grade"]) ?? "Unknown",
                "region": place(location).joined(separator: ", ").nilIfEmpty ?? "Unassigned",
                "country": text(location?["country"]) ?? "Unassigned",
                "registered": team["registered"] as? Bool ?? false,
                "active": !current.isEmpty,
                "currentSeasonEvents": current.count,
                "seasons": seasonIds.count,
            ] as [String: Any],
            "events": sortedEvents.map { event -> [String: Any] in
                let season = event["season"] as? [String: Any]
                var row: [String: Any] = [
                    "id": event["id"] as? Int ?? 0,
                    "name": text(event["name"]) ?? "",
                    "season": text(season?["name"]) ?? "Unknown season",
                    "location": place(event["location"]).joined(separator: ", "),
                ]
                row["sku"] = text(event["sku"])
                row["start"] = text(event["start"])
                row["end"] = text(event["end"])
                row["seasonId"] = season?["id"] as? Int
                row["level"] = text(event["level"])
                return row
            },
            "rankings": rankings.map { standing -> [String: Any] in
                let id = eventId(standing)
                let season = seasonOf(id)
                var row: [String: Any] = [
                    "event": eventName(standing),
                    "season": season.name,
                    "division": text((standing["division"] as? [String: Any])?["name"]) ?? "",
                    "rank": standing["rank"] as? Int ?? 0,
                    "wins": standing["wins"] as? Int ?? 0,
                    "losses": standing["losses"] as? Int ?? 0,
                    "ties": standing["ties"] as? Int ?? 0,
                ]
                row["eventId"] = id
                row["seasonId"] = season.id
                row["wp"] = standing["wp"] as? Int
                row["ap"] = standing["ap"] as? Int
                row["sp"] = standing["sp"] as? Int
                row["highScore"] = standing["high_score"] as? Int
                if program.isIQ { row["averagePoints"] = standing["average_points"] as? Double }
                return row
            },
            "awards": awards.map { award -> [String: Any] in
                let id = eventId(award)
                let season = seasonOf(id)
                var row: [String: Any] = ["event": eventName(award), "season": season.name]
                row["title"] = text(award["title"]) ?? text(award["name"])
                row["eventId"] = id
                row["seasonId"] = season.id
                return row
            },
            "skills": skills
                .sorted { ($0["score"] as? Int ?? 0) > ($1["score"] as? Int ?? 0) }
                .map { run -> [String: Any] in
                    let id = eventId(run)
                    var row: [String: Any] = [
                        "event": eventName(run),
                        "season": text((run["season"] as? [String: Any])?["name"]) ?? "",
                    ]
                    row["eventId"] = id
                    row["type"] = text(run["type"])
                    row["score"] = run["score"] as? Int
                    row["attempts"] = run["attempts"] as? Int
                    row["rank"] = run["rank"] as? Int
                    row["seasonId"] = seasonId(run) ?? seasonOf(id).id
                    return row
                },
            // Calculated by the Worker (VIQCR history included); filled in when
            // its profile arrives.
            "ratingHistory": [Any](),
            "loadedSeasonIds": [season],
            "program": program.rawValue,
        ]
        return profile
    }

    /// events.vex collections: 250 rows a page, every page, or an error.
    struct Client {
        let token: String
        let session: URLSession

        func pages(_ path: String, _ query: [String: String]) async throws -> [Data] {
            let first = try await page(path, query, 1)
            let meta = (try JSONSerialization.jsonObject(with: first) as? [String: Any])?["meta"] as? [String: Any]
            let last = max(1, meta?["last_page"] as? Int ?? 1)
            var all = [first]
            for number in stride(from: 2, through: last, by: 1) { all.append(try await page(path, query, number)) }
            return all
        }

        func collection(_ path: String, _ query: [String: String]) async throws -> [[String: Any]] {
            try Self.rows(await pages(path, query))
        }

        static func rows(_ pages: [Data]) throws -> [[String: Any]] {
            try pages.flatMap { data -> [[String: Any]] in
                guard let rows = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["data"] as? [[String: Any]] else {
                    throw URLError(.cannotParseResponse)
                }
                return rows
            }
        }

        private func page(_ path: String, _ query: [String: String], _ number: Int) async throws -> Data {
            var components = URLComponents(string: "\(DirectProfile.root)/\(path)")!
            components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
                + [URLQueryItem(name: "per_page", value: "250"), URLQueryItem(name: "page", value: String(number))]
            var request = URLRequest(url: components.url!, timeoutInterval: 10)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            let (data, response) = try await session.data(for: request)
            // A rejected token is redirected to a sign-in page, which arrives
            // here as a 200 of HTML; `rows` refuses it as unparseable.
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            return data
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
