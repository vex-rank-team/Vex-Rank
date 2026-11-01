package com.vexrank.scout

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

/// The Android port re-implements the rules the iOS kit settled, so these
/// mirror the Swift suite and run against the same captured payloads. If the
/// two clients ever disagree about a rule, one of these fails.
private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }

private inline fun <reified T> fixture(name: String): T {
    val stream = object {}.javaClass.classLoader!!.getResourceAsStream("$name.json")
        ?: error("missing fixture $name.json")
    return json.decodeFromString(stream.bufferedReader().use { it.readText() })
}

class TeamNumberTest {
    @Test fun `digits compare as numbers not as text`() {
        // The bug this replaces: "10188S" sorted above "2731K" because a
        // string comparison reaches 0 against 7 and stops.
        assertTrue(TeamNumber.precedes("2731K", "10188S"))
        assertFalse(TeamNumber.precedes("10188S", "2731K"))
        assertTrue(TeamNumber.precedes("2A", "2011A"))
        assertTrue(TeamNumber.precedes("2011A", "2011B"))
        assertTrue(TeamNumber.same("2011a", "2011A"))
    }

    @Test fun `registered teams at an event are in numeric order`() {
        val detail = fixture<EventDetailResponse>("event-detail")
        val sorted = detail.teams.sortedWith { a, b -> TeamNumber.compare(a.number, b.number) }
        assertTrue(sorted.size > 10)
        // And the order really differs from a plain string sort here.
        assertNotEquals(sorted.map { it.number }, detail.teams.map { it.number }.sorted())
    }
}

class EventDayTest {
    @Test fun `a plain date keeps its day`() {
        // Parsed as UTC midnight and printed locally, "2026-09-20" showed as
        // Sep 19 anywhere west of UTC.
        assertEquals(LocalDate.of(2026, 9, 20), EventDay.parse("2026-09-20"))
    }

    @Test fun `a timestamp keeps the day it names`() {
        assertEquals(LocalDate.of(2026, 9, 19), EventDay.parse("2026-09-19T00:00:00-04:00"))
        // A venue far east is the same story in the other direction.
        assertEquals(LocalDate.of(2026, 9, 20), EventDay.parse("2026-09-20T00:00:00+12:00"))
    }

    @Test fun `bad input is no date`() {
        assertNull(EventDay.parse(null))
        assertNull(EventDay.parse(""))
        assertNull(EventDay.parse("not a date"))
        assertNull(EventDay.parse("2026-09"))
    }

    @Test fun `every captured event still has a day`() {
        listOf("event-detail", "event-multi", "event-live", "event-dq").forEach { name ->
            assertNotNull(name, fixture<EventDetailResponse>(name).event.day)
        }
    }
}

class TeamLocationTest {
    @Test fun `the city survives when a team is ranked`() {
        val profile = fixture<TeamProfileResponse>("team")
        val ranked = fixture<RankingsResponse>("rankings")
            .rankings.firstOrNull { it.number == profile.team.number }
        assertEquals("Canterbury, Victoria, Australia", profile.team.region)
        assertEquals("Canterbury, Victoria, Australia",
            TeamLocation.best(listOf(profile.team.region, ranked?.region)))
    }

    @Test fun `the richer answer wins from either side`() {
        assertEquals("Canterbury, Victoria, Australia",
            TeamLocation.best(listOf("Victoria, Australia", "Canterbury, Victoria, Australia")))
        assertEquals("Canterbury, Victoria, Australia",
            TeamLocation.best(listOf("Canterbury, Victoria, Australia", "Victoria, Australia")))
    }

    @Test fun `placeholders and blanks are not locations`() {
        assertNull(TeamLocation.best(listOf(null, null)))
        assertNull(TeamLocation.best(listOf("", "   ")))
        assertNull(TeamLocation.best(listOf("Unassigned", "unassigned")))
        assertEquals("Ontario, Canada", TeamLocation.best(listOf("Unassigned", "Ontario, Canada")))
    }
}

class DirectoryTest {
    private fun indexed() = fixture<TeamDirectoryResponse>("team-directory")
        .teams.map { it to TeamDirectory.haystack(it) }

    @Test fun `a number finds its whole family`() {
        val family = TeamDirectory.search(indexed(), "2011")
        assertTrue(family.size > 1)
        // And the suffix narrows it back to one.
        assertEquals("2011a", TeamDirectory.search(indexed(), " 2011a ").first().number.lowercase())
    }

    @Test fun `byte search agrees with string search`() {
        val teams = fixture<TeamDirectoryResponse>("team-directory").teams
        val indexed = teams.map { it to TeamDirectory.haystack(it) }
        listOf("2011", "2011a", "robotics", "team a", "zzz", "", "  ").forEach { query ->
            val fast = TeamDirectory.search(indexed, query).map { it.id }.toSet()
            val tokens = query.trim().lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
            val slow = teams.filter { team ->
                val hay = "${team.number} ${team.name.orEmpty()} ${team.organization.orEmpty()}".lowercase()
                tokens.all { hay.contains(it) }
            }.map { it.id }.toSet()
            assertEquals("disagreed on \"$query\"", slow, fast)
        }
    }

    @Test fun `countries normalize before they group`() {
        assertEquals("United States", TeamDirectory.normalizeCountry("USA"))
        assertEquals("United States", TeamDirectory.normalizeCountry("us"))
        assertEquals("Canada", TeamDirectory.normalizeCountry("Canada"))
        assertEquals("Unassigned", TeamDirectory.normalizeCountry(null))
    }

    @Test fun `an exact number outranks a prefix and a name`() {
        assertEquals(0, TeamDirectory.priority("2011A", "2011a"))
        assertEquals(1, TeamDirectory.priority("2011AB", "2011a"))
        assertEquals(2, TeamDirectory.priority("9999Z", "2011a"))
    }
}

class PowerRatingTest {
    private fun division() = fixture<EventDetailResponse>("event-detail").divisions.first()

    @Test fun `the fit solves the normal equations`() {
        val division = division()
        val ratings = division.powerRatings()
        assertFalse(ratings.isEmpty)

        // Solving the normal equations means A.x = b holds exactly; this
        // rebuilds both from the matches and checks it. That is the test that
        // would catch a wrong solver.
        data class Side(val teams: List<String>, val scored: Double)
        val sides = ArrayList<Side>()
        division.qualification.filter { it.isPlayed }.forEach { match ->
            val red = match.red ?: return@forEach
            val blue = match.blue ?: return@forEach
            sides.add(Side(red.numbers.map { it.uppercase() }, (red.score ?: 0).toDouble()))
            sides.add(Side(blue.numbers.map { it.uppercase() }, (blue.score ?: 0).toDouble()))
        }
        val teams = ratings.stats.keys.sorted()
        val index = teams.withIndex().associate { (i, t) -> t to i }
        val a = Array(teams.size) { DoubleArray(teams.size) }
        val b = DoubleArray(teams.size)
        sides.forEach { side ->
            val rows = side.teams.mapNotNull { index[it] }
            rows.forEach { i ->
                b[i] += side.scored
                rows.forEach { j -> a[i][j] += 1.0 }
            }
        }
        teams.indices.forEach { i ->
            val lhs = teams.indices.sumOf { j -> a[i][j] * ratings.stats[teams[j]]!!.opr }
            assertEquals("row ${teams[i]}", b[i], lhs, 0.001)
        }
    }

    @Test fun `ccwm is opr minus dpr`() {
        division().powerRatings().stats.values.forEach {
            assertEquals(it.opr - it.dpr, it.ccwm, 0.0001)
        }
    }

    @Test fun `a thin event is rated but shrunk toward zero`() {
        // 39 matches into a 219-match schedule across 97 teams. Unregularised
        // this fitted a range of -115 to +183, which is not a rating.
        val division = fixture<EventDetailResponse>("event-partial").divisions.first()
        val ratings = division.powerRatings()
        assertFalse(ratings.isEmpty)
        assertTrue(ratings.isProvisional)
        val best = division.qualification.filter { it.isPlayed }
            .flatMap { listOfNotNull(it.red?.score, it.blue?.score) }.max().toDouble()
        ratings.stats.values.forEach {
            assertTrue("fitted ${it.opr} against a best of $best", it.opr < best && it.opr > -best)
        }
    }

    @Test fun `an event with nothing played has no ratings`() {
        val division = fixture<EventDetailResponse>("event-live").divisions.first()
        assertTrue(division.qualification.isNotEmpty())
        assertTrue(division.powerRatings().isEmpty)
    }

    @Test fun `the solver handles a known system`() {
        // 2x + y = 5, x + 3y = 10  ->  x = 1, y = 3
        val answer = solve(arrayOf(doubleArrayOf(2.0, 1.0), doubleArrayOf(1.0, 3.0)),
            doubleArrayOf(5.0, 10.0))!!
        assertEquals(1.0, answer[0], 0.0001)
        assertEquals(3.0, answer[1], 0.0001)
        // A singular system returns nothing rather than nonsense.
        assertNull(solve(arrayOf(doubleArrayOf(1.0, 2.0), doubleArrayOf(2.0, 4.0)),
            doubleArrayOf(3.0, 6.0)))
    }
}

class StandingSortTest {
    private fun division() = fixture<EventDetailResponse>("event-detail").divisions.first()

    @Test fun `lower dpr is better and everything else is higher`() {
        val division = division()
        val ratings = division.powerRatings()
        val dprs = division.standings(StandingSort.DPR, ratings)
            .mapNotNull { ratings[it.team.name]?.dpr }
        assertEquals("DPR must run smallest first", dprs.sorted(), dprs)

        val oprs = division.standings(StandingSort.OPR, ratings)
            .mapNotNull { ratings[it.team.name]?.opr }
        assertEquals("OPR must run largest first", oprs.sortedDescending(), oprs)
    }

    @Test fun `the best dpr is not the worst team`() {
        val division = division()
        val ratings = division.powerRatings()
        val rows = division.standings(StandingSort.DPR, ratings)
        // Reversing the comparison would silently put the leakiest defence on
        // top, which is the mistake this ordering exists to avoid.
        assertTrue(ratings[rows.first().team.name]!!.dpr < ratings[rows.last().team.name]!!.dpr)
    }

    @Test fun `every sort keeps every team`() {
        val division = division()
        val ratings = division.powerRatings()
        StandingSort.entries.forEach { sort ->
            assertEquals(sort.label, division.rankings.size, division.standings(sort, ratings).size)
        }
    }
}

class EventSectionTest {
    @Test fun `a final-only division is not offered under rankings`() {
        val detail = fixture<EventDetailResponse>("event-multi")
        assertEquals(3, detail.divisions.size)
        val standings = detail.divisions(EventSection.RANKINGS)
        assertEquals("only the two playing divisions have standings", 2, standings.size)
        assertFalse(standings.any { it.name.contains("final", true) })
        // It does hold matches, so it belongs under the bracket.
        assertTrue(detail.divisions(EventSection.BRACKET).any { it.name.contains("final", true) })
    }

    @Test fun `awards without winners are not offered`() {
        val live = fixture<EventDetailResponse>("event-live")
        assertTrue(live.awards.isNotEmpty())
        assertTrue(live.awards.all { it.teamWinners.isNullOrEmpty() })
        assertFalse("a list of categories is not a list of results",
            live.availableSections.contains(EventSection.AWARDS))
        assertTrue(fixture<EventDetailResponse>("event-detail")
            .availableSections.contains(EventSection.AWARDS))
    }

    @Test fun `round of sixteen sorts before the quarter finals`() {
        val rounds = fixture<EventDetailResponse>("event-detail")
            .divisions.first().elimination.mapNotNull { it.round }
        // The API numbers the round of 16 as 6, above the quarter-finals at 3.
        assertEquals(6, rounds.first())
        assertEquals(5, rounds.last())
    }
}

class TeamMatchTest {
    @Test fun `scores are oriented to the team`() {
        val detail = fixture<EventDetailResponse>("event-detail")
        val team = detail.divisions.first().rankings.first().team.name
        val matches = detail.matches(team)
        assertTrue(matches.isNotEmpty())
        val raw = detail.divisions.first().matches.orEmpty()
        matches.filter { it.isPlayed }.forEach { match ->
            val source = raw.first { it.id == match.id }
            val mine = if (match.colour == "red") source.red?.score else source.blue?.score
            assertEquals(mine, match.scoreFor)
        }
    }

    @Test fun `an unplayed match carries no score`() {
        // The feed sends 0 against 0 for a fixture; reading that as a score
        // would print every upcoming match as a nil-all draw.
        fixture<EventDetailResponse>("event-live").matches("663D").forEach {
            assertFalse(it.isPlayed)
            assertNull(it.scoreFor)
            assertEquals(TeamMatch.Outcome.SCHEDULED, it.outcome)
        }
    }

    @Test fun `a disqualification shows up as a record the scores do not explain`() {
        // 252H: the standings credit two wins, but on score they lost their
        // first match 28-115 and won the second 78-77.
        val detail = fixture<EventDetailResponse>("event-dq")
        val standing = detail.standing("252H")!!
        val check = RecordCheck.of(standing, detail.matches("252H"))
        assertEquals(2, check.officialWins)
        assertEquals(1, check.scoredWins)
        assertEquals(1, check.scoredLosses)
        assertFalse(check.agrees)
        assertEquals(1, check.unexplainedWins)
    }

    @Test fun `eliminations do not count against the standings`() {
        // 19600Z went 7-1-0 in qualification and then played eliminations.
        val detail = fixture<EventDetailResponse>("event-detail")
        val matches = detail.matches("19600Z")
        assertTrue(matches.any { !it.isQualification && it.isPlayed })
        val check = RecordCheck.of(detail.standing("19600Z")!!, matches)
        assertTrue(check.agrees)
        assertEquals(0, check.unexplainedWins)
        assertEquals("7–1–0", check.officialSummary)
    }

    @Test fun `a genuine mismatch survives ignoring eliminations`() {
        // 978Z is credited 2-6 but went 1-7 on score in qualification.
        val detail = fixture<EventDetailResponse>("event-detail")
        val check = RecordCheck.of(detail.standing("978Z")!!, detail.matches("978Z"))
        assertFalse(check.agrees)
        assertEquals(1, check.unexplainedWins)
    }

    @Test fun `a finished event agrees with itself`() {
        val detail = fixture<EventDetailResponse>("event-detail")
        val team = detail.divisions.first().rankings.first().team.name
        val check = RecordCheck.of(detail.standing(team)!!, detail.matches(team))
        assertTrue("a finished event's scores should add up to its standings", check.agrees)
    }
}

class MomentumTest {
    private fun matches() = fixture<EventDetailResponse>("event-detail").matches("19600Z")

    @Test fun `the running total is the sum of the margins so far`() {
        val points = TeamMomentum.points(matches())
        assertTrue(points.isNotEmpty())
        var running = 0
        points.forEach { running += it.margin; assertEquals(running, it.cumulative) }
    }

    @Test fun `a win moves it up and a loss down`() {
        TeamMomentum.points(matches()).forEach {
            when (it.outcome) {
                TeamMatch.Outcome.WON -> assertTrue(it.margin > 0)
                TeamMatch.Outcome.LOST -> assertTrue(it.margin < 0)
                TeamMatch.Outcome.TIED -> assertEquals(0, it.margin)
                TeamMatch.Outcome.SCHEDULED -> fail("an unplayed match must not be plotted")
            }
        }
    }

    @Test fun `the range always straddles zero`() {
        val range = TeamMomentum.range(TeamMomentum.points(matches()))
        assertTrue(range.start < 0)
        assertTrue(range.endInclusive > 0)
    }
}

class StatLeaderTest {
    private fun teams() = fixture<RankingsResponse>("rankings").rankings
    private fun skills() = fixture<SkillsResponse>("skills").rankings

    @Test fun `win rate counts ties as half`() {
        assertEquals(70.0, StatLeaders.winRate("6–2–2", 10), 0.001)
        assertEquals(70.0, StatLeaders.winRate("6-2-2", 10), 0.001)
        assertEquals(0.0, StatLeaders.winRate(null, 10), 0.001)
        assertEquals(0.0, StatLeaders.winRate("6–2–2", 0), 0.001)
    }

    @Test fun `scores stay inside zero to one hundred`() {
        teams().forEach {
            assertTrue(StatLeaders.pickingScore(it) in 0.0..100.0)
            assertTrue(StatLeaders.consistencyScore(it) in 0.0..100.0)
        }
    }

    @Test fun `every category is sorted best first`() {
        StatCategory.all.forEach { category ->
            val rows = StatLeaders.rank(category, teams(), skills())
            assertTrue(category.id, rows.isNotEmpty())
            rows.zipWithNext().forEach { (a, b) ->
                if (category.lowerIsBetter) assertTrue(category.id, a.value <= b.value)
                else assertTrue(category.id, a.value >= b.value)
            }
        }
    }

    @Test fun `skills rows do not offer a profile`() {
        assertFalse(StatLeaders.rank(StatCategory.all[6], teams(), skills()).any { it.opensProfile })
        assertTrue(StatLeaders.rank(StatCategory.all[0], teams(), skills()).all { it.opensProfile })
    }
}

class RankingFilterTest {
    private fun teams() = fixture<RankingsResponse>("rankings").rankings

    @Test fun `region uses the event region and otherwise the first component`() {
        // A full "Victoria, Australia" must reduce to "Victoria", or every
        // team ends up in a region of its own.
        teams().take(50).forEach {
            val region = RankingFilter.regionOf(it) ?: return@forEach
            assertFalse(region, region.contains(","))
        }
    }

    @Test fun `each filter narrows the field`() {
        val teams = teams()
        assertEquals(teams.size, RankingFilter().apply(teams).size)
        val country = RankingFilter.countries(teams).first()
        val byCountry = RankingFilter(country = country).apply(teams)
        assertTrue(byCountry.isNotEmpty())
        assertTrue(byCountry.size < teams.size)
        assertTrue(byCountry.all { it.country == country })
    }

    @Test fun `regions are scoped to the chosen country`() {
        val teams = teams()
        val country = RankingFilter.countries(teams).first()
        assertTrue(RankingFilter.regions(teams, country).size < RankingFilter.regions(teams, null).size)
    }
}

class OfficialLinkTest {
    @Test fun `team link matches the verified pattern`() {
        // Opened in a browser: this returns "V5RC Team : 252H : VEX Events".
        assertEquals("https://events.vex.com/teams/V5RC/252H", OfficialLinks.team("252H"))
        assertEquals("https://events.vex.com/teams/V5RC/252H", OfficialLinks.team("252h"))
        assertNull(OfficialLinks.team("  "))
    }

    @Test fun `event link prefers what the api supplies`() {
        val detail = fixture<EventDetailResponse>("event-dq")
        assertEquals(detail.event.officialUrl, detail.event.official)
        assertTrue(detail.event.official!!.contains("events.vex.com"))
    }

    @Test fun `event link falls back to the sku`() {
        assertEquals(
            "https://events.vex.com/robot-competitions/vex-robotics-competition/RE-V5RC-26-4359.html",
            OfficialLinks.event(null, "RE-V5RC-26-4359"))
        assertNull(OfficialLinks.event(null, null))
    }
}

class SeasonTest {
    @Test fun `seasons are newest first and named for the picker`() {
        val profile = fixture<TeamProfileResponse>("team")
        val seasons = profile.seasons
        assertTrue(seasons.size > 1)
        assertEquals(seasons.map { it.id }.sortedDescending(), seasons.map { it.id })
        // "VEX V5 Robotics Competition 2026-2027: Override" is too long for a
        // picker row; the reader needs the years and the game.
        assertEquals("2026–27 Override", seasons.first().shortName)
    }

    @Test fun `combined skills come from one event not two`() {
        val best = SeasonSkills.of(fixture<TeamProfileResponse>("team").skills)
        assertTrue(best.combined > 0)
        // The official standing is the best pair at a single event.
        assertTrue(best.combined <= best.driver + best.programming)
        assertTrue(best.combined >= maxOf(best.driver, best.programming))
    }

    @Test fun `grade is read per season`() {
        val profile = fixture<TeamProfileResponse>("team")
        profile.seasons.forEach { assertTrue(profile.grade(it.id).isNotEmpty()) }
        // An unknown season falls back rather than going blank.
        assertEquals(profile.team.grade, profile.grade(-1))
    }
}
