package com.vexrank.scout

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Models mirror the live responses from the VEXRank Worker exactly as served.
// They are the same shapes the iOS client decodes, and the same captured
// payloads back the tests, so the two apps cannot drift apart quietly.

@Serializable
data class RankingsResponse(
    val rankings: List<TeamRanking> = emptyList(),
    val eventsProcessed: Int = 0,
    val matchesProcessed: Int = 0,
    val season: String? = null,
) {
    /// The deployed Worker ranks by rating minus confidence while also
    /// returning the raw rating, so one of the two columns always looks out of
    /// order. Ordering by rank is the lesser evil: the leading number of every
    /// row then reads 1, 2, 3.
    val sortedForDisplay: List<TeamRanking>
        get() = rankings.sortedWith(compareBy<TeamRanking> { it.rank }
            .thenComparator { a, b -> TeamNumber.compare(a.number, b.number) })
}

@Serializable
data class TeamRanking(
    val id: Int = 0,
    val rank: Int = 0,
    val number: String = "",
    val name: String = "",
    val region: String? = null,
    val eventRegion: String? = null,
    val country: String? = null,
    val rating: Int = 0,
    val confidence: Int = 0,
    val record: String? = null,
    val events: Int = 0,
    val matches: Int? = null,
    val grade: String? = null,
    val organization: String? = null,
    val opr: Double? = null,
    val dpr: Double? = null,
    val ccwm: Double? = null,
)

@Serializable
data class TeamProfileResponse(
    val team: TeamIdentity,
    val ratingHistory: List<RatingPoint> = emptyList(),
    val events: List<TeamEvent> = emptyList(),
    val rankings: List<TeamEventStanding> = emptyList(),
    val awards: List<Award> = emptyList(),
    val skills: List<SkillRun> = emptyList(),
    val seasonGrades: Map<String, String> = emptyMap(),
) {
    /// Seasons this profile has results for, newest first.
    val seasons: List<Season>
        get() {
            val seen = LinkedHashMap<Int, String>()
            events.forEach { event ->
                val id = event.seasonId ?: return@forEach
                seen.getOrPut(id) { event.season ?: "Season $id" }
            }
            ratingHistory.forEach { point -> seen.getOrPut(point.seasonId) { point.event } }
            return seen.entries.map { Season(it.key, it.value) }.sortedByDescending { it.id }
        }

    fun grade(seasonId: Int): String = seasonGrades[seasonId.toString()] ?: team.grade

    data class Season(val id: Int, val name: String) {
        /// "2026-27 Override" rather than the API's full product name.
        val shortName: String
            get() {
                val game = name.substringAfterLast(':', name).trim()
                val years = Regex("20\\d{2}-20\\d{2}").find(name)?.value ?: return game
                return "${years.replace("-20", "–")} $game"
            }
    }
}

@Serializable
data class TeamIdentity(
    val id: Int = 0,
    val number: String = "",
    val name: String = "",
    val organization: String = "",
    val robot: String = "",
    val grade: String = "Unknown",
    val region: String = "",
    val country: String = "",
    val active: Boolean = false,
    val currentSeasonEvents: Int = 0,
    val seasons: Int = 0,
)

@Serializable
data class RatingPoint(
    val seasonId: Int = 0,
    val eventId: Int = 0,
    val event: String = "",
    val eventDate: String = "",
    val change: Int = 0,
    val rating: Int = 0,
    val matches: Int = 0,
)

@Serializable
data class TeamEvent(
    val id: Int = 0,
    val sku: String? = null,
    val name: String = "",
    val start: String? = null,
    val end: String? = null,
    val season: String? = null,
    val seasonId: Int? = null,
    val location: String? = null,
    val elimination: String? = null,
) {
    /// The calendar day the event starts on, read as the day it names rather
    /// than as an instant.
    val day: java.time.LocalDate? get() = EventDay.parse(start)

    /// The API writes "No elimination result" rather than omitting the field.
    val eliminationResult: String?
        get() = elimination?.takeIf { it.isNotBlank() && !it.contains("no elimination", true) }
}

@Serializable
data class TeamEventStanding(
    val event: String? = null,
    val eventId: Int? = null,
    val seasonId: Int? = null,
    val division: String? = null,
    val rank: Int = 0,
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

@Serializable
data class Award(
    val title: String? = null,
    val event: String? = null,
    val eventId: Int? = null,
    val seasonId: Int? = null,
)

@Serializable
data class SkillRun(
    val event: String? = null,
    val eventId: Int? = null,
    val type: String? = null,
    val score: Int? = null,
    val rank: Int? = null,
    val seasonId: Int? = null,
)

/// A season's best skills scores. Combined is the best driver-plus-programming
/// at a *single* event, not the sum of two bests from different events, which
/// is how the official standings read it.
data class SeasonSkills(val driver: Int, val programming: Int, val combined: Int) {
    companion object {
        fun of(runs: List<SkillRun>): SeasonSkills {
            val byEvent = HashMap<Int, IntArray>()
            var bestDriver = 0
            var bestProgramming = 0
            runs.forEach { run ->
                val score = run.score ?: return@forEach
                if (score <= 0) return@forEach
                val pair = byEvent.getOrPut(run.eventId ?: -1) { intArrayOf(0, 0) }
                when (run.type) {
                    "driver" -> { bestDriver = maxOf(bestDriver, score); pair[0] = maxOf(pair[0], score) }
                    "programming" -> { bestProgramming = maxOf(bestProgramming, score); pair[1] = maxOf(pair[1], score) }
                }
            }
            val combined = byEvent.values.maxOfOrNull { it[0] + it[1] } ?: 0
            return SeasonSkills(bestDriver, bestProgramming, combined)
        }
    }
}

@Serializable
data class SkillsResponse(val rankings: List<SkillsEntry> = emptyList(), val season: String? = null)

@Serializable
data class SkillsEntry(
    val id: Int = 0,
    val number: String = "",
    val name: String = "",
    val organization: String? = null,
    val region: String? = null,
    val country: String? = null,
    val grade: String? = null,
    val autoSkills: Int = 0,
    val driverSkills: Int = 0,
    val combinedSkills: Int = 0,
    val skillsRank: Int = 0,
)

@Serializable
data class EventsResponse(val events: List<VexEvent> = emptyList())

@Serializable
data class VexEvent(
    val id: String = "",
    val sku: String? = null,
    val date: String = "",
    val name: String = "",
    val city: String? = null,
    val region: String? = null,
    val eventRegion: String? = null,
    val status: String? = null,
    val teams: Int? = null,
    @SerialName("class") val eventClass: String? = null,
) {
    val day: java.time.LocalDate? get() = EventDay.parse(date)

    val isUpcoming: Boolean
        get() = day?.let { !it.isBefore(java.time.LocalDate.now()) } ?: false

    /// `city` already carries "City, Region" and `eventRegion` repeats the
    /// region, so naively joining produced "Hamburg, Hamburg, Hamburg".
    val place: String
        get() {
            val seen = LinkedHashSet<String>()
            listOfNotNull(city, eventRegion, region).forEach { field ->
                field.split(",").forEach { part ->
                    val text = part.trim()
                    if (text.isNotEmpty()) seen.add(text)
                }
            }
            return seen.joinToString(", ")
        }
}

@Serializable
data class TeamDirectoryResponse(
    val asOf: String = "",
    val total: Int = 0,
    val teams: List<DirectoryTeam> = emptyList(),
)

@Serializable
data class DirectoryTeam(
    val id: Int = 0,
    val number: String = "",
    val name: String? = null,
    val organization: String? = null,
    val country: String? = null,
    val region: String? = null,
    val city: String? = null,
    val grade: String? = null,
    val registered: Boolean? = null,
) {
    val place: String
        get() = listOfNotNull(city, region, country)
            .filter { it.isNotBlank() && it != "Unassigned" }
            .joinToString(", ")
}
