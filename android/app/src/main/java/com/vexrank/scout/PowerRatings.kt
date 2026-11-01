package com.vexrank.scout

import kotlin.math.abs
import kotlin.math.max

/// A team's contribution ratings at one event.
data class TeamEventStats(val opr: Double, val dpr: Double) {
    val ccwm: Double get() = opr - dpr
}

/// The fitted ratings for a division, and how much play stands behind them.
data class PowerRatings(
    val stats: Map<String, TeamEventStats>,
    val appearances: Double,
) {
    /// Fewer than four appearances each. The values are shrunk toward zero to
    /// stay meaningful, but they will still move a lot as the event goes on.
    val isProvisional: Boolean get() = appearances < 4
    val isEmpty: Boolean get() = stats.isEmpty()

    operator fun get(team: String): TeamEventStats? = stats[team.uppercase()]
}

/// OPR, DPR and CCWM, fitted from a division's qualification matches.
///
/// The API publishes WP, AP and SP per event but not these, because they are
/// not counted - they are fitted. Each played match says "these two teams
/// together scored this much", and the ratings are the per-team values that
/// best explain every such statement at once, in the least-squares sense.
/// Solved through the normal equations. Eliminations are excluded: alliances
/// there are chosen rather than drawn, so they say nothing about a team alone.
fun Division.powerRatings(): PowerRatings {
    val played = qualification.filter { it.isPlayed }
    if (played.size < 3) return PowerRatings(emptyMap(), 0.0)

    data class Side(val teams: List<String>, val scored: Double, val conceded: Double)
    val sides = ArrayList<Side>()
    played.forEach { match ->
        val red = match.red ?: return@forEach
        val blue = match.blue ?: return@forEach
        val redScore = red.score ?: return@forEach
        val blueScore = blue.score ?: return@forEach
        val redTeams = red.numbers.map { it.uppercase() }
        val blueTeams = blue.numbers.map { it.uppercase() }
        if (redTeams.isEmpty() || blueTeams.isEmpty()) return@forEach
        sides.add(Side(redTeams, redScore.toDouble(), blueScore.toDouble()))
        sides.add(Side(blueTeams, blueScore.toDouble(), redScore.toDouble()))
    }
    if (sides.isEmpty()) return PowerRatings(emptyMap(), 0.0)

    val teams = sides.flatMap { it.teams }.distinct().sortedWith { a, b -> TeamNumber.compare(a, b) }
    val appearances = 4.0 * played.size / teams.size
    val index = teams.withIndex().associate { (i, team) -> team to i }
    val n = teams.size

    val a = Array(n) { DoubleArray(n) }
    val offence = DoubleArray(n)
    val defence = DoubleArray(n)
    sides.forEach { side ->
        val rows = side.teams.mapNotNull { index[it] }
        rows.forEach { i ->
            offence[i] += side.scored
            defence[i] += side.conceded
            rows.forEach { j -> a[i][j] += 1.0 }
        }
    }

    // The ridge, scaled to how thin the data is.
    //
    // A team needs about four appearances before its own rating is pinned
    // down. Short of that an unregularised solve answers with numbers shaped
    // like ratings that are not: at 1.8 appearances each, one event fitted a
    // range of -115 to +183 that correlated with actual scoring at only 0.50.
    // Shrinking in proportion to the shortfall brings that to -2 to +53 at
    // 0.90. Once there is enough play the ridge vanishes.
    val ridge = if (appearances >= 4) 1e-6 else max(1e-6, 4 - appearances)
    for (i in 0 until n) a[i][i] += ridge

    val opr = solve(a, offence) ?: return PowerRatings(emptyMap(), appearances)
    val dpr = solve(a, defence) ?: return PowerRatings(emptyMap(), appearances)
    return PowerRatings(
        teams.withIndex().associate { (i, team) -> team to TeamEventStats(opr[i], dpr[i]) },
        appearances,
    )
}

/// Gaussian elimination with partial pivoting. Returns null if the system
/// turns out to be singular, which is better than numbers that mean nothing.
fun solve(matrix: Array<DoubleArray>, vector: DoubleArray): DoubleArray? {
    val n = vector.size
    if (n == 0 || matrix.size != n) return null
    val a = Array(n) { matrix[it].copyOf() }
    val b = vector.copyOf()

    for (column in 0 until n) {
        var pivot = column
        for (row in column + 1 until n) if (abs(a[row][column]) > abs(a[pivot][column])) pivot = row
        if (abs(a[pivot][column]) < 1e-9) return null
        if (pivot != column) {
            val swap = a[pivot]; a[pivot] = a[column]; a[column] = swap
            val value = b[pivot]; b[pivot] = b[column]; b[column] = value
        }
        val head = a[column][column]
        for (row in column + 1 until n) {
            val factor = a[row][column] / head
            if (factor == 0.0) continue
            for (col in column until n) a[row][col] -= factor * a[column][col]
            b[row] -= factor * b[column]
        }
    }

    val solution = DoubleArray(n)
    for (row in n - 1 downTo 0) {
        var total = b[row]
        for (col in row + 1 until n) total -= a[row][col] * solution[col]
        solution[row] = total / a[row][row]
    }
    return solution
}

/// How to order a division's qualification standings.
enum class StandingSort(val label: String) {
    RANK("Rank"), WP("WP"), AP("AP"), SP("SP"), HIGH("High"),
    OPR("OPR"), DPR("DPR"), CCWM("CCWM");

    /// DPR counts the points a team's opponents score, so the best value is
    /// the smallest - and seeding rank is already "1 is best".
    val ascending: Boolean get() = this == DPR || this == RANK
    val needsRatings: Boolean get() = this == OPR || this == DPR || this == CCWM
}

fun Division.standings(by: StandingSort, ratings: PowerRatings? = null): List<DivisionRanking> {
    fun value(row: DivisionRanking): Double? = when (by) {
        StandingSort.RANK -> row.rank.toDouble()
        StandingSort.WP -> row.wp?.toDouble()
        StandingSort.AP -> row.ap?.toDouble()
        StandingSort.SP -> row.sp?.toDouble()
        StandingSort.HIGH -> row.highScore?.toDouble()
        StandingSort.OPR -> ratings?.get(row.team.name)?.opr
        StandingSort.DPR -> ratings?.get(row.team.name)?.dpr
        StandingSort.CCWM -> ratings?.get(row.team.name)?.ccwm
    }

    return rankings.sortedWith { a, b ->
        val x = value(a)
        val y = value(b)
        when {
            // A team with no value sorts last, whichever way the column runs.
            x == null && y == null -> a.rank - b.rank
            x == null -> 1
            y == null -> -1
            x == y -> a.rank - b.rank
            by.ascending -> x.compareTo(y)
            else -> y.compareTo(x)
        }
    }
}

fun Division.availableSorts(): List<StandingSort> {
    val rated = !powerRatings().isEmpty
    return StandingSort.entries.filter { rated || !it.needsRatings }
}

/// One step of a team's run through a tournament.
data class MomentumPoint(
    val id: Int,
    val match: Int,
    val name: String,
    val margin: Int,
    val cumulative: Int,
    val outcome: TeamMatch.Outcome,
)

/// A team's tournament momentum: the running sum of its scoring margins.
///
/// A cumulative margin rather than a win count because it says how much, not
/// just whether - two narrow wins and one heavy loss is a different tournament
/// from three narrow wins, and a win-loss line cannot tell them apart.
object TeamMomentum {
    fun points(matches: List<TeamMatch>): List<MomentumPoint> {
        var running = 0
        val points = ArrayList<MomentumPoint>()
        matches.forEach { match ->
            if (!match.isPlayed) return@forEach
            val mine = match.scoreFor ?: return@forEach
            val theirs = match.scoreAgainst ?: return@forEach
            val margin = mine - theirs
            running += margin
            points.add(MomentumPoint(match.id, points.size + 1, match.name, margin, running, match.outcome))
        }
        return points
    }

    /// The y range to draw, padded, and always including zero so being level
    /// is visibly the middle rather than the floor.
    fun range(points: List<MomentumPoint>): ClosedFloatingPointRange<Double> {
        val values = points.map { it.cumulative.toDouble() } + 0.0
        val low = values.min()
        val high = values.max()
        val padding = max(10.0, (high - low) * 0.15)
        return (low - padding)..(high + padding)
    }
}

/// A team's wins, losses and ties at one event, as the scores read.
data class TeamEventRecord(val wins: Int, val losses: Int, val ties: Int, val remaining: Int) {
    val played: Int get() = wins + losses + ties
    val summary: String get() = "$wins–$losses–$ties"

    companion object {
        fun of(matches: List<TeamMatch>) = TeamEventRecord(
            wins = matches.count { it.outcome == TeamMatch.Outcome.WON },
            losses = matches.count { it.outcome == TeamMatch.Outcome.LOST },
            ties = matches.count { it.outcome == TeamMatch.Outcome.TIED },
            remaining = matches.count { !it.isPlayed },
        )
    }
}

/// One leaderboard on the stats tab.
data class StatCategory(
    val id: String,
    val valueLabel: String,
    val detail: String,
    val fromSkills: Boolean,
    val lowerIsBetter: Boolean,
    val fractionDigits: Int,
) {
    companion object {
        val all = listOf(
            StatCategory("Offense", "Offensive rating",
                "Teams that create the most scoring value, with at least 12 scored matches.",
                false, false, 1),
            StatCategory("Defense", "Defensive impact",
                "Lowest opponent score share among teams with at least 12 scored matches.",
                false, true, 1),
            StatCategory("Picking", "Strategic reliability",
                "A 0-100 proxy combining results, opponent-adjusted strength and scoring margin. Requires 36 matches across 4 events.",
                false, false, 0),
            StatCategory("Consistency", "Rating stability",
                "How firmly the rating is supported by repeat results. Requires 36 matches across 4 events.",
                false, false, 0),
            StatCategory("Auto skills", "Autonomous skills",
                "Official Event.VEX programming-skills score.", true, false, 0),
            StatCategory("Driver skills", "Driver skills",
                "Official Event.VEX driver-skills score.", true, false, 0),
            StatCategory("Combined skills", "Combined skills",
                "Official Event.VEX autonomous plus driver skills total.", true, false, 0),
        )
    }
}

data class StatLeader(
    val number: String,
    val name: String,
    val region: String,
    val context: String,
    val value: Double,
    val opensProfile: Boolean,
)

object StatLeaders {
    /// Win rate from the "W-L-T" record string. The API writes the separator
    /// as an en dash; a hyphen is accepted so a format change degrades to 0.
    fun winRate(record: String?, matches: Int?): Double {
        if (matches == null || matches <= 0) return 0.0
        val parts = (record ?: "").split("–", "-").mapNotNull { it.trim().toDoubleOrNull() }
        if (parts.size < 2) return 0.0
        val wins = parts[0]
        val ties = if (parts.size > 2) parts[2] else 0.0
        return (wins + ties * 0.5) / matches * 100
    }

    private fun clamp(value: Double) = value.coerceIn(0.0, 100.0)

    fun pickingScore(team: TeamRanking): Double = clamp(
        0.45 * winRate(team.record, team.matches) +
            0.35 * clamp((team.rating - 1250) / 7.5) +
            0.20 * clamp(((team.ccwm ?: 0.0) + 20) * 1.25)
    )

    /// Confidence is the plus-or-minus band beside the rating, so a small band
    /// means a stable rating; the score inverts it.
    fun consistencyScore(team: TeamRanking): Double = clamp(100.0 - team.confidence)

    fun rank(
        category: StatCategory,
        teams: List<TeamRanking>,
        skills: List<SkillsEntry>,
        country: String? = null,
    ): List<StatLeader> {
        val rows: List<StatLeader> = if (category.fromSkills) {
            fun value(entry: SkillsEntry) = when (category.id) {
                "Auto skills" -> entry.autoSkills
                "Driver skills" -> entry.driverSkills
                else -> entry.combinedSkills
            }.toDouble()
            skills.filter { value(it) > 0 && (country == null || it.country == country) }
                .map {
                    // Skills rows do not open a profile: that feed carries no
                    // rating history, so the page would be empty.
                    StatLeader(it.number, it.name, it.region ?: it.country ?: "Unassigned",
                        it.grade ?: "Unknown", value(it), false)
                }
        } else {
            val qualifies: (TeamRanking) -> Boolean
            val value: (TeamRanking) -> Double
            when (category.id) {
                "Offense" -> {
                    qualifies = { (it.matches ?: 0) >= 12 && it.opr != null }
                    value = { it.opr ?: 0.0 }
                }
                "Defense" -> {
                    qualifies = { (it.matches ?: 0) >= 12 && it.dpr != null }
                    value = { it.dpr ?: 0.0 }
                }
                "Consistency" -> {
                    qualifies = { (it.matches ?: 0) >= 36 && it.events >= 4 }
                    value = { consistencyScore(it) }
                }
                else -> {
                    qualifies = { (it.matches ?: 0) >= 36 && it.events >= 4 }
                    value = { pickingScore(it) }
                }
            }
            teams.filter { qualifies(it) && (country == null || it.country == country) }
                .map {
                    StatLeader(it.number, it.name, it.region ?: it.country ?: "Unassigned",
                        "World #${it.rank}", value(it), true)
                }
        }

        // Ties broken by team number so the order is stable across refreshes.
        return rows.sortedWith { a, b ->
            if (a.value == b.value) TeamNumber.compare(a.number, b.number)
            else if (category.lowerIsBetter) a.value.compareTo(b.value)
            else b.value.compareTo(a.value)
        }
    }

    fun countries(category: StatCategory, teams: List<TeamRanking>, skills: List<SkillsEntry>): List<String> =
        (if (category.fromSkills) skills.mapNotNull { it.country } else teams.mapNotNull { it.country })
            .filter { it.isNotBlank() }.distinct().sorted()
}
