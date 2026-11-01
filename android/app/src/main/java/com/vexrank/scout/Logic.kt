package com.vexrank.scout

import java.time.LocalDate

/// How team numbers order.
///
/// A plain string comparison is wrong for them: it puts "10188S" before
/// "2731K", because it reaches "0" against "7" at the second character and
/// stops. Numbers have to be compared as numbers.
object TeamNumber {
    fun compare(a: String, b: String): Int {
        val digitsA = a.takeWhile { it.isDigit() }
        val digitsB = b.takeWhile { it.isDigit() }
        val numberA = digitsA.toLongOrNull()
        val numberB = digitsB.toLongOrNull()
        if (numberA != null && numberB != null && numberA != numberB) {
            return numberA.compareTo(numberB)
        }
        return a.compareTo(b, ignoreCase = true)
    }

    fun precedes(a: String, b: String) = compare(a, b) < 0
    fun same(a: String, b: String) = compare(a, b) == 0
}

/// The day an event happens on.
///
/// An event's date is a calendar day, not an instant: a tournament on the 20th
/// is on the 20th for everyone reading about it. The feeds express it two ways
/// - a plain "2026-09-20" and a timestamp at midnight in the *venue's* own
/// offset - and reading either as an instant and printing it in the reader's
/// timezone moves it back a day anywhere west of UTC.
object EventDay {
    fun parse(value: String?): LocalDate? {
        if (value.isNullOrEmpty()) return null
        val head = if (value.length >= 11 && value[10] == 'T') value.take(10) else value
        val parts = head.split("-")
        if (parts.size != 3) return null
        val year = parts[0].toIntOrNull() ?: return null
        val month = parts[1].toIntOrNull() ?: return null
        val day = parts[2].toIntOrNull() ?: return null
        return runCatching { LocalDate.of(year, month, day) }.getOrNull()
    }
}

/// Choosing which of the feeds' answers to a team's location to show.
///
/// The teams endpoint builds "Canterbury, Victoria, Australia"; the rankings
/// feed builds "Victoria, Australia", because it feeds a table column with no
/// room for a city. Reading the ranking first lost the city precisely when a
/// team was ranked.
object TeamLocation {
    fun best(candidates: List<String?>): String? {
        val usable = candidates.filterNotNull().map { it.trim() }
            .filter { it.isNotEmpty() && !it.equals("Unassigned", true) }
        var best = usable.firstOrNull() ?: return null
        usable.drop(1).forEach { if (places(it) > places(best)) best = it }
        return best
    }

    fun places(region: String): Int = region.split(",")
        .map { it.trim() }
        .count { it.isNotEmpty() && !it.equals("Unassigned", true) }
}

/// Links to the official site, for the things this app does not carry.
/// Both patterns were checked against the live site in a real browser.
object OfficialLinks {
    private const val SITE = "https://events.vex.com"
    const val PROGRAM = "V5RC"

    fun team(number: String): String? {
        val trimmed = number.trim().uppercase()
        return if (trimmed.isEmpty()) null else "$SITE/teams/$PROGRAM/$trimmed"
    }

    fun event(officialUrl: String?, sku: String?): String? {
        if (!officialUrl.isNullOrBlank() && officialUrl.startsWith("http")) return officialUrl
        if (sku.isNullOrBlank()) return null
        return "$SITE/robot-competitions/vex-robotics-competition/$sku.html"
    }
}

/// Narrowing the world ranking by school level, country and event region.
data class RankingFilter(
    val grade: Grade = Grade.ALL,
    val country: String? = null,
    val region: String? = null,
    val search: String = "",
) {
    enum class Grade(val label: String) {
        ALL("All teams"), HIGH("High School"), MIDDLE("Middle School")
    }

    fun apply(teams: List<TeamRanking>): List<TeamRanking> {
        val needle = search.trim().lowercase()
        return teams.filter { team ->
            if (grade != Grade.ALL && team.grade != grade.label) return@filter false
            if (country != null && team.country != country) return@filter false
            if (region != null && regionOf(team) != region) return@filter false
            needle.isEmpty() ||
                team.number.lowercase().contains(needle) ||
                team.name.lowercase().contains(needle)
        }
    }

    companion object {
        /// A team's event region, falling back to the first component of its
        /// postal region. `region` is a full "Victoria, Australia" string, so
        /// matching on it whole would put every team in its own group.
        fun regionOf(team: TeamRanking): String? {
            team.eventRegion?.takeIf { it.isNotBlank() }?.let { return it }
            return team.region?.split(",")?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
        }

        fun countries(teams: List<TeamRanking>): List<String> =
            teams.mapNotNull { it.country }.filter { it.isNotBlank() }.distinct().sorted()

        /// Regions are scoped to the chosen country: offering regions from
        /// elsewhere would list rows that match nothing.
        fun regions(teams: List<TeamRanking>, country: String?): List<String> {
            val scoped = country?.let { name -> teams.filter { it.country == name } } ?: teams
            return scoped.mapNotNull { regionOf(it) }.filter { it.isNotBlank() }.distinct().sorted()
        }
    }
}

/// Every V5RC team on record, searchable.
object TeamDirectory {
    /// One row's searchable text, as lowercased bytes. Bytes rather than a
    /// String because of what a keystroke costs over 56,000 rows.
    fun haystack(team: DirectoryTeam): ByteArray =
        "${team.number} ${team.name.orEmpty()} ${team.organization.orEmpty()}"
            .lowercase().toByteArray()

    fun contains(hay: ByteArray, needle: ByteArray): Boolean {
        if (needle.isEmpty()) return true
        if (needle.size > hay.size) return false
        val limit = hay.size - needle.size
        var i = 0
        while (i <= limit) {
            if (hay[i] == needle[0]) {
                var j = 1
                while (j < needle.size && hay[i + j] == needle[j]) j++
                if (j == needle.size) return true
            }
            i++
        }
        return false
    }

    /// The feed spells the United States three ways, and ungrouped they sort
    /// into three separate menu rows with the teams split between them.
    fun normalizeCountry(value: String?): String = when (value?.lowercase()) {
        null, "" -> "Unassigned"
        "usa", "us", "united states of america" -> "United States"
        else -> value
    }

    data class Filters(val country: String? = null, val region: String? = null, val grade: String? = null)

    fun search(
        indexed: List<Pair<DirectoryTeam, ByteArray>>,
        query: String,
        filters: Filters = Filters(),
    ): List<DirectoryTeam> {
        val needle = query.trim().lowercase()
        val tokens = needle.split(Regex("\\s+")).filter { it.isNotEmpty() }.map { it.toByteArray() }
        return indexed.filter { (team, hay) ->
            if (filters.country != null && normalizeCountry(team.country) != filters.country) return@filter false
            if (filters.region != null && (team.region ?: "Unassigned") != filters.region) return@filter false
            if (filters.grade != null && team.grade != filters.grade) return@filter false
            // Every token must appear, so "robotics club ohio" narrows rather
            // than widens. A bare number matches its whole family.
            tokens.all { contains(hay, it) }
        }.sortedWith(
            compareBy<Pair<DirectoryTeam, ByteArray>> { priority(it.first.number, needle) }
                .thenComparator { a, b -> TeamNumber.compare(a.first.number, b.first.number) }
                .thenBy { it.first.id }
        ).map { it.first }
    }

    /// An exact number beats a prefix, which beats a match in a name.
    fun priority(number: String, needle: String): Int {
        if (needle.isEmpty()) return 2
        val lowered = number.lowercase()
        return when {
            lowered == needle -> 0
            lowered.startsWith(needle) -> 1
            else -> 2
        }
    }

    fun locations(teams: List<DirectoryTeam>, country: String? = null): Pair<List<String>, List<String>> {
        val countries = teams.map { normalizeCountry(it.country) }.distinct().sorted()
        val scoped = country?.let { name -> teams.filter { normalizeCountry(it.country) == name } } ?: teams
        val regions = scoped.map { it.region?.takeIf { r -> r.isNotBlank() } ?: "Unassigned" }
            .distinct().sorted()
        return countries to regions
    }
}
