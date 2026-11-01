import Foundation

/// Loading a team profile one season at a time.
///
/// The profile endpoint without a season fetches the team's whole career from
/// the official API - every match, ranking, award and skills run since the
/// team began - and an uncached veteran took 3 to 14 seconds to answer. The
/// same request scoped to one season came back in about 0.45 seconds. The
/// screen only ever shows one season at a time, so it asks for the season on
/// screen and fetches another only when the reader picks it.
///
/// A season-scoped response still lists *every* event (the event list is not
/// filtered server-side), so the season picker is complete from the first
/// response; only the per-season rows - rankings, awards, skills and the
/// rating history - arrive a season at a time, and `loadedSeasonIds` says
/// which seasons they cover.
extension TeamProfileResponse {
    /// Whether the rows for `season` are in this response. A response without
    /// `loadedSeasonIds` predates scoping and carries everything.
    public func hasLoaded(season: Int) -> Bool {
        guard let loaded = loadedSeasonIds else { return true }
        return loaded.contains(season)
    }

    /// This profile with `other`'s seasons folded in.
    ///
    /// Rows for the seasons `other` loaded come from `other`; rows for every
    /// other season are kept from `self`, so reading one season never drops
    /// another that was already on screen.
    public func merging(_ other: TeamProfileResponse) -> TeamProfileResponse {
        let incoming = Set(other.loadedSeasonIds ?? [])
        // Keep a row unless the incoming response is the authority for its
        // season. A row with no season cannot be placed, so it stays.
        func keep(_ season: Int?) -> Bool { season.map { !incoming.contains($0) } ?? true }

        var grades = seasonGrades ?? [:]
        for (season, grade) in other.seasonGrades ?? [:] where incoming.contains(Int(season) ?? -1) || grades[season] == nil {
            grades[season] = grade
        }

        // Every response lists every event, but an event's elimination result
        // is worked out from matches, which are scoped - so an event outside
        // the loaded season arrives reading "No elimination result" whatever
        // actually happened. Each event is taken from the response that
        // loaded its season.
        let mergedEvents: [TeamEvent]? = {
            guard let theirs = other.events else { return events }
            let mine = Dictionary((events ?? []).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            return theirs.map { event in
                keep(event.seasonId) ? mine[event.id] ?? event : event
            }
        }()

        let history: [RatingPoint] = ratingHistory.filter { keep($0.seasonId) } + other.ratingHistory
        let standings: [TeamEventStanding] = (rankings ?? []).filter { keep($0.seasonId) } + (other.rankings ?? [])
        let awarded: [Award] = (awards ?? []).filter { keep($0.seasonId) } + (other.awards ?? [])
        let runs: [SkillRun] = (skills ?? []).filter { keep($0.seasonId) } + (other.skills ?? [])
        let loaded: [Int] = Array(Set(loadedSeasonIds ?? []).union(incoming)).sorted()
        return TeamProfileResponse(
            team: other.team,
            ratingHistory: history,
            events: mergedEvents,
            rankings: standings,
            awards: awarded,
            skills: runs,
            seasonGrades: grades,
            modelVersion: other.modelVersion ?? modelVersion,
            loadedSeasonIds: loaded,
            program: other.program ?? program,
            // The newer response knows whether a rating exists now.
            ratingStatus: other.ratingStatus
        )
    }
}
