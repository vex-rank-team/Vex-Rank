package com.vexrank.scout

import kotlinx.serialization.Serializable

@Serializable
data class EventDetailResponse(
    val event: EventDetail,
    val teams: List<EventTeam> = emptyList(),
    val divisions: List<Division> = emptyList(),
    val awards: List<EventAward> = emptyList(),
    val skills: List<EventSkill> = emptyList(),
) {
    /// The API serves one skills row per team *per type*, but the standing
    /// people read is the combined total, so the rows are folded per team.
    val skillsLeaderboard: List<SkillLeader>
        get() {
            val driver = HashMap<String, Int>()
            val programming = HashMap<String, Int>()
            skills.forEach { entry ->
                val number = entry.team?.name?.takeIf { it.isNotBlank() } ?: return@forEach
                val score = entry.score ?: return@forEach
                when (entry.type) {
                    "driver" -> driver[number] = maxOf(driver[number] ?: 0, score)
                    "programming" -> programming[number] = maxOf(programming[number] ?: 0, score)
                }
            }
            return (driver.keys + programming.keys)
                .map { SkillLeader(it, driver[it] ?: 0, programming[it] ?: 0) }
                .sortedWith(compareByDescending<SkillLeader> { it.total }
                    .thenComparator { a, b -> TeamNumber.compare(a.number, b.number) })
        }

    /// Which sections are worth offering, in order.
    val availableSections: List<EventSection>
        get() = EventSection.entries.filter { section ->
            when (section) {
                EventSection.RANKINGS, EventSection.BRACKET, EventSection.MATCHES ->
                    divisions(section).isNotEmpty()
                // An event in progress already lists every award it will give
                // out, all without a winner. Offering that reads as results
                // when it is only a list of categories.
                EventSection.AWARDS -> awards.any { !it.teamWinners.isNullOrEmpty() }
                EventSection.SKILLS -> skillsLeaderboard.isNotEmpty()
                EventSection.TEAMS -> teams.isNotEmpty()
            }
        }

    /// The divisions with anything to show under a section. A final-only
    /// division has no standings, so offering it under Rankings would give the
    /// reader an empty page.
    fun divisions(section: EventSection): List<Division> = when (section) {
        EventSection.RANKINGS -> divisions.filter { it.rankings.isNotEmpty() }
        EventSection.BRACKET -> divisions.filter { it.elimination.isNotEmpty() }
        EventSection.MATCHES -> divisions.filter { !it.matches.isNullOrEmpty() }
        else -> emptyList()
    }

    /// Every match a team is in, played and scheduled, in play order.
    fun matches(number: String): List<TeamMatch> {
        val wanted = number.uppercase()
        val found = ArrayList<TeamMatch>()
        divisions.forEach { division ->
            division.matches.orEmpty().forEach { match ->
                val red = match.red?.numbers.orEmpty()
                val blue = match.blue?.numbers.orEmpty()
                val onRed = red.any { it.uppercase() == wanted }
                val onBlue = blue.any { it.uppercase() == wanted }
                if (!onRed && !onBlue) return@forEach
                val mine = if (onRed) red else blue
                val played = match.isPlayed
                found.add(
                    TeamMatch(
                        id = match.id,
                        name = match.name ?: "Match",
                        field = match.field,
                        scheduledAt = match.scheduled,
                        division = division.name,
                        colour = if (onRed) "red" else "blue",
                        partners = mine.filter { it.uppercase() != wanted },
                        opponents = if (onRed) blue else red,
                        // An unplayed match carries 0 against 0; reading that
                        // as a score prints every fixture as a nil-all draw.
                        scoreFor = if (played) (if (onRed) match.red?.score else match.blue?.score) else null,
                        scoreAgainst = if (played) (if (onRed) match.blue?.score else match.red?.score) else null,
                        isPlayed = played,
                        isQualification = match.isQualification,
                    )
                )
            }
        }
        return found.sortedWith(compareBy({ it.scheduledAt ?: "￿" }, { it.id }))
    }

    fun upcomingMatches(number: String): List<TeamMatch> =
        matches(number).filter { !it.isPlayed }

    /// A team's standing in whichever division it plays in.
    fun standing(number: String): EventStanding? {
        val wanted = number.uppercase()
        divisions.forEach { division ->
            val row = division.rankings.firstOrNull { it.team.name.uppercase() == wanted }
            if (row != null) {
                val ratings = division.powerRatings()
                return EventStanding(
                    division = division.name,
                    rank = row.rank,
                    wins = row.wins, losses = row.losses, ties = row.ties,
                    wp = row.wp, ap = row.ap, sp = row.sp, highScore = row.highScore,
                    stats = ratings[row.team.name],
                    statsAreProvisional = ratings.isProvisional,
                )
            }
        }
        return null
    }
}

@Serializable
data class EventDetail(
    val id: Int = 0,
    val sku: String? = null,
    val name: String = "",
    val start: String? = null,
    val end: String? = null,
    val location: EventLocation? = null,
    val officialUrl: String? = null,
) {
    val venueLine: String
        get() = listOfNotNull(location?.venue, location?.city, location?.region, location?.country)
            .filter { it.isNotBlank() }
            .joinToString(", ")

    val day: java.time.LocalDate? get() = EventDay.parse(start)
    val official: String? get() = OfficialLinks.event(officialUrl, sku)
}

@Serializable
data class EventLocation(
    val venue: String? = null,
    val city: String? = null,
    val region: String? = null,
    val country: String? = null,
)

@Serializable
data class EventTeam(
    val id: Int = 0,
    val number: String = "",
    val name: String? = null,
    val organization: String? = null,
    val grade: String? = null,
)

@Serializable
data class Division(
    val id: Int = 0,
    val name: String = "",
    val rankings: List<DivisionRanking> = emptyList(),
    val matches: List<DivisionMatch>? = null,
) {
    val qualification: List<DivisionMatch>
        get() = matches.orEmpty()
            .filter { it.isQualification }
            .sortedBy { it.matchnum ?: 0 }

    /// Elimination matches, earliest round first. Round 6 is the round of 16
    /// and sorts *before* the quarter-finals at 3, so this cannot sort on the
    /// round number - the API's numbering is not chronological.
    val elimination: List<DivisionMatch>
        get() = matches.orEmpty()
            .filter { match ->
                val round = match.round ?: return@filter false
                round >= 3 && match.name?.contains("qual", true) != true &&
                    match.name?.contains("practice", true) != true
            }
            .sortedWith(compareBy({ bracketOrder(it.round) }, { it.matchnum ?: 0 }))

    companion object {
        fun bracketOrder(round: Int?): Int = when (round) {
            null -> Int.MAX_VALUE
            6 -> 0
            else -> round
        }

        /// Order-independent identity for an alliance.
        fun allianceKey(numbers: List<String>): String =
            numbers.map { it.uppercase() }.sorted().joinToString("|")
    }
}

@Serializable
data class DivisionRanking(
    val rank: Int = 0,
    val team: DivisionTeam = DivisionTeam(),
    val wins: Int = 0,
    val losses: Int = 0,
    val ties: Int = 0,
    val wp: Int? = null,
    val ap: Int? = null,
    val sp: Int? = null,
    val highScore: Int? = null,
) {
    val record: String get() = "$wins–$losses–$ties"
}

/// The API puts the team *number* in `name` here.
@Serializable
data class DivisionTeam(val id: Int = 0, val name: String = "", val code: String? = null)

@Serializable
data class DivisionMatch(
    val id: Int = 0,
    val name: String? = null,
    val round: Int? = null,
    val instance: Int? = null,
    val matchnum: Int? = null,
    val field: String? = null,
    val scheduled: String? = null,
    val alliances: List<MatchAlliance>? = null,
) {
    /// Deliberately not the API's `scored` flag: that is false on completed
    /// matches in the captured payloads, so trusting it would print "Not
    /// played" beside a real 153-123 result.
    /// Whether this match counts toward the qualification standings.
    val isQualification: Boolean
        get() = round == 2 || name?.contains("qual", true) == true

    val isPlayed: Boolean
        get() = alliances.orEmpty().any { (it.score ?: -1) >= 0 } &&
            alliances.orEmpty().any { (it.score ?: 0) > 0 }

    val red: MatchAlliance? get() = alliances?.firstOrNull { it.color == "red" }
    val blue: MatchAlliance? get() = alliances?.firstOrNull { it.color == "blue" }

    val winner: String?
        get() {
            if (!isPlayed) return null
            val r = red?.score ?: return null
            val b = blue?.score ?: return null
            return if (r == b) null else if (r > b) "red" else "blue"
        }
}

@Serializable
data class MatchAlliance(
    val color: String? = null,
    val score: Int? = null,
    val teams: List<MatchTeamSlot>? = null,
) {
    val numbers: List<String>
        get() = teams.orEmpty().mapNotNull { it.team?.name }.filter { it.isNotBlank() }
}

@Serializable
data class MatchTeamSlot(val team: DivisionTeam? = null, val sitting: Boolean? = null)

@Serializable
data class EventAward(val title: String? = null, val teamWinners: List<AwardWinner>? = null)

@Serializable
data class AwardWinner(val team: DivisionTeam? = null)

@Serializable
data class EventSkill(
    val rank: Int? = null,
    val score: Int? = null,
    val type: String? = null,
    val team: DivisionTeam? = null,
)

data class SkillLeader(val number: String, val driver: Int, val programming: Int) {
    val total: Int get() = driver + programming
}

enum class EventSection(val label: String) {
    RANKINGS("Rankings"), BRACKET("Bracket"), MATCHES("Matches"),
    AWARDS("Awards"), SKILLS("Skills"), TEAMS("Teams");

    val isPerDivision: Boolean get() = this == RANKINGS || this == BRACKET || this == MATCHES
}

data class TeamMatch(
    val id: Int,
    val name: String,
    val field: String?,
    val scheduledAt: String?,
    val division: String,
    val colour: String,
    val partners: List<String>,
    val opponents: List<String>,
    val scoreFor: Int?,
    val scoreAgainst: Int?,
    val isPlayed: Boolean,
    /// A qualification match, the only kind the event's standings count.
    val isQualification: Boolean,
) {
    enum class Outcome { WON, LOST, TIED, SCHEDULED }

    val outcome: Outcome
        get() {
            if (!isPlayed || scoreFor == null || scoreAgainst == null) return Outcome.SCHEDULED
            return when {
                scoreFor > scoreAgainst -> Outcome.WON
                scoreFor < scoreAgainst -> Outcome.LOST
                else -> Outcome.TIED
            }
        }

    val time: String?
        get() = scheduledAt?.let {
            runCatching {
                java.time.OffsetDateTime.parse(it)
                    .format(java.time.format.DateTimeFormatter.ofPattern("h:mm a"))
            }.getOrNull()
        }
}

data class EventStanding(
    val division: String,
    val rank: Int,
    val wins: Int,
    val losses: Int,
    val ties: Int,
    val wp: Int?,
    val ap: Int?,
    val sp: Int?,
    val highScore: Int?,
    val stats: TeamEventStats?,
    val statsAreProvisional: Boolean,
) {
    val record: String get() = "$wins–$losses–$ties"
}

/// What the scores say against what the event says.
///
/// A team can lose on points and still be credited with the win, because the
/// other alliance was disqualified. Nothing in the match payload marks that,
/// so comparing scores calls it a loss while the standings call it a win. The
/// standings are the authority.
data class RecordCheck(
    val officialWins: Int, val officialLosses: Int, val officialTies: Int,
    val scoredWins: Int, val scoredLosses: Int, val scoredTies: Int,
) {
    val agrees: Boolean
        get() = officialWins == scoredWins && officialLosses == scoredLosses && officialTies == scoredTies

    val unexplainedWins: Int get() = maxOf(0, officialWins - scoredWins)
    val officialSummary: String get() = "$officialWins–$officialLosses–$officialTies"

    companion object {
        fun of(standing: EventStanding, matches: List<TeamMatch>): RecordCheck {
            // The standings are qualification only; eliminations would make
            // every team that reached them look as if the two disagree.
            val counted = matches.filter { it.isQualification }
            return RecordCheck(
                officialWins = standing.wins,
                officialLosses = standing.losses,
                officialTies = standing.ties,
                scoredWins = counted.count { it.outcome == TeamMatch.Outcome.WON },
                scoredLosses = counted.count { it.outcome == TeamMatch.Outcome.LOST },
                scoredTies = counted.count { it.outcome == TeamMatch.Outcome.TIED },
            )
        }
    }
}
