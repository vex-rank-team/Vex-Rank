package com.vexrank.scout

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import android.view.HapticFeedbackConstants
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri

private val api = VexRankApi()

@Composable
private fun OpenInBrowser(url: String, label: String, theme: VexTheme) {
    val context = LocalContext.current
    Row(
        Modifier
            .heightIn(min = 48.dp)
            .clickable(role = Role.Button) {
                context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
            },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.OpenInNew, contentDescription = null, tint = theme.accent,
            modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text(label, color = theme.accent, fontSize = 14.sp)
    }
}

// MARK: - Team profile

@Composable
fun TeamScreen(
    number: String,
    theme: VexTheme,
    favourites: Favourites,
    onBack: () -> Unit,
    onOpenEvent: (String) -> Unit,
) {
    var profile by remember { mutableStateOf<TeamProfileResponse?>(null) }
    var ranking by remember { mutableStateOf<TeamRanking?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var season by remember { mutableStateOf<Int?>(null) }
    var starred by remember { mutableStateOf(favourites.contains(number)) }
    var reload by remember { mutableStateOf(0) }

    LaunchedEffect(number, reload) {
        error = null
        runCatching { api.teamProfile(number) }
            .onSuccess { profile = it }
            .onFailure { error = it.message }
        // Deliberately from the ranking endpoint rather than the last point of
        // ratingHistory: those two are computed differently and disagree, and
        // the ranking is the published number.
        runCatching { api.rankings() }.onSuccess { response ->
            ranking = response.rankings.firstOrNull { it.number.equals(number, true) }
        }
    }

    val view = LocalView.current
    ScreenScaffold(number, theme, onBack = onBack, actions = {
        IconButton(onClick = {
            favourites.toggle(FavouriteTeam(number, profile?.team?.name))
            starred = favourites.contains(number)
            // A tick under the thumb: the icon alone is easy to miss.
            view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
        }) {
            Icon(if (starred) Icons.Filled.Star else Icons.Filled.StarBorder,
                contentDescription = if (starred) "Remove from favourites" else "Add to favourites",
                tint = theme.accent)
        }
    }) { padding ->
        Box(Modifier.padding(padding)) {
            PhaseFade(profile to error, { (loaded, failure) ->
                if (loaded != null) 2 else if (failure != null) 1 else 0
            }) { (loaded, failure) ->
            when {
                failure != null && loaded == null -> Failed(failure, theme) { reload++ }
                loaded == null -> Loading("Loading profile…", theme)
                else -> {
                    val seasons = loaded.seasons
                    val active = season ?: seasons.firstOrNull()?.id
                    LazyColumn(Modifier.fillMaxSize()) {
                        item { TeamHeader(number, loaded, ranking, seasons, active, theme) { season = it } }
                        item { Spacer(Modifier.height(16.dp)) }
                        item { SeasonBand(loaded, active, theme) }
                        item { Spacer(Modifier.height(16.dp)) }
                        val skills = SeasonSkills.of(
                            loaded.skills.filter { active == null || it.seasonId == active })
                        if (skills.combined > 0) {
                            item { SkillsCard(skills, theme) }
                            item { Spacer(Modifier.height(16.dp)) }
                        }
                        val events = loaded.events
                            .filter { active == null || it.seasonId == active }
                            .sortedByDescending { it.start }
                        if (events.isNotEmpty()) {
                            item {
                                Card(theme, Modifier.padding(horizontal = 16.dp)) {
                                    Text("COMPETITION HISTORY", fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold, color = Color(0xFF8A94A3))
                                    Spacer(Modifier.height(10.dp))
                                    events.forEach { event ->
                                        EventHistoryRow(event, loaded, theme) { onOpenEvent(event.id.toString()) }
                                    }
                                }
                            }
                            item { Spacer(Modifier.height(16.dp)) }
                        }
                        val awards = loaded.awards.filter { active == null || it.seasonId == active }
                        if (awards.isNotEmpty()) {
                            item {
                                Card(theme, Modifier.padding(horizontal = 16.dp)) {
                                    Text("AWARDS", fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                                        color = Color(0xFF8A94A3))
                                    Spacer(Modifier.height(10.dp))
                                    awards.forEach { award ->
                                        Text(award.title ?: "Award", fontSize = 14.sp,
                                            color = Color(0xFFF2F4F8))
                                        if (!award.event.isNullOrBlank()) {
                                            Text(award.event, fontSize = 12.sp, color = Color(0xFF8A94A3))
                                        }
                                        Spacer(Modifier.height(8.dp))
                                    }
                                }
                            }
                        }
                        item { Spacer(Modifier.height(32.dp)) }
                    }
                }
            }
            }
        }
    }
}

@Composable
private fun TeamHeader(
    number: String,
    profile: TeamProfileResponse,
    ranking: TeamRanking?,
    seasons: List<TeamProfileResponse.Season>,
    active: Int?,
    theme: VexTheme,
    onSeason: (Int) -> Unit,
) {
    Column(Modifier.padding(16.dp)) {
        Text("V5RC TEAM PROFILE  /  ${if (profile.team.active) "ACTIVE" else "UNRATED"}",
            fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF8A94A3))
        Spacer(Modifier.height(8.dp))
        Text(number, fontSize = 44.sp, fontWeight = FontWeight.Bold, color = Color(0xFFF2F4F8))
        Spacer(Modifier.height(6.dp))
        // The richer answer wins: the rankings feed omits the city.
        val location = TeamLocation.best(listOf(profile.team.region, ranking?.region))
        if (location != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Place, contentDescription = null, tint = Color(0xFF8A94A3),
                    modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(location, fontSize = 16.sp, color = Color(0xFFD5DAE3))
            }
        }
        Spacer(Modifier.height(12.dp))
        OfficialLinks.team(number)?.let {
            OpenInBrowser(it, "View $number on events.vex.com", theme)
        }
        Spacer(Modifier.height(12.dp))
        HorizontalDivider(color = Color(0x14FFFFFF))
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Text(profile.team.name.uppercase(), fontSize = 17.sp, color = Color(0xFFF2F4F8))
                if (profile.team.organization.isNotBlank()) {
                    Text(profile.team.organization, fontSize = 12.sp, color = Color(0xFF8A94A3))
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                val isCurrent = active == null || active == seasons.firstOrNull()?.id
                val seasonEnd = active?.let { id ->
                    profile.ratingHistory.filter { it.seasonId == id }.maxByOrNull { it.eventDate }
                }
                val label = when {
                    isCurrent && ranking != null -> "LIVE VCR"
                    seasonEnd != null -> "SEASON END VCR"
                    else -> "RANKING STATUS"
                }
                val value = when {
                    isCurrent && ranking != null -> "${ranking.rating}"
                    seasonEnd != null -> "${seasonEnd.rating}"
                    else -> "Unrated"
                }
                Text(label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF8A94A3))
                Text(value, fontSize = if (value == "Unrated") 20.sp else 32.sp,
                    fontWeight = FontWeight.Bold, color = Color(0xFFF2F4F8))
            }
        }
        if (seasons.size > 1) {
            Spacer(Modifier.height(14.dp))
            Card(theme) {
                Text("SEASON", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF8A94A3))
                DropdownPicker(
                    seasons.firstOrNull { it.id == active }?.shortName ?: "—",
                    seasons.map { it.shortName }, null, theme,
                ) { picked ->
                    seasons.firstOrNull { it.shortName == picked }?.let { onSeason(it.id) }
                }
            }
        }
    }
}

@Composable
private fun SeasonBand(profile: TeamProfileResponse, season: Int?, theme: VexTheme) {
    val events = profile.events.filter { season == null || it.seasonId == season }
    val awards = profile.awards.filter { season == null || it.seasonId == season }
    Column(
        Modifier.padding(horizontal = 16.dp).fillMaxWidth()
            .clip(RoundedCornerShape(16.dp)).background(theme.band).padding(18.dp)
    ) {
        Text("SEASON SUMMARY", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF9AA4B2))
        Spacer(Modifier.height(6.dp))
        Text("ON\nRECORD", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFFF2F4F8))
        Spacer(Modifier.height(16.dp))
        Row {
            Metric("Status", if (profile.team.active) "Active" else "Inactive",
                season?.let { profile.grade(it) } ?: "", Modifier.weight(1f))
            Metric("Season events", "${events.size}", "Official competitions", Modifier.weight(1f))
        }
        Spacer(Modifier.height(14.dp))
        Row {
            Metric("Season awards", "${awards.size}", "Official award records", Modifier.weight(1f))
            Metric("Seasons found", "${profile.team.seasons}", "Complete team history", Modifier.weight(1f))
        }
    }
}

@Composable
private fun Metric(label: String, value: String, detail: String, modifier: Modifier) {
    Column(modifier) {
        HorizontalDivider(color = Color(0x33FFFFFF))
        Spacer(Modifier.height(6.dp))
        Text(label, fontSize = 12.sp, color = Color(0xFF9AA4B2))
        Text(value, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFFF2F4F8))
        if (detail.isNotBlank()) Text(detail, fontSize = 11.sp, color = Color(0xFF8A94A3))
    }
}

@Composable
private fun SkillsCard(skills: SeasonSkills, theme: VexTheme) {
    Card(theme, Modifier.padding(horizontal = 16.dp)) {
        Text("SEASON BEST SKILLS", fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
            color = Color(0xFF8A94A3))
        Spacer(Modifier.height(10.dp))
        Row {
            Metric("Driver", if (skills.driver > 0) "${skills.driver}" else "—", "", Modifier.weight(1f))
            Metric("Programming", if (skills.programming > 0) "${skills.programming}" else "—",
                "", Modifier.weight(1f))
            Metric("Combined", if (skills.combined > 0) "${skills.combined}" else "—",
                "Best pair at one event", Modifier.weight(1f))
        }
    }
}

@Composable
private fun EventHistoryRow(event: TeamEvent, profile: TeamProfileResponse,
                            theme: VexTheme, onOpen: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(vertical = 6.dp)) {
        HorizontalDivider(color = Color(0x14FFFFFF))
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.Top) {
            Text(event.name, fontSize = 14.sp, color = Color(0xFFF2F4F8), modifier = Modifier.weight(1f))
            Spacer(Modifier.width(8.dp))
            event.day?.let {
                Text(it.format(java.time.format.DateTimeFormatter.ofPattern("MMM d")),
                    fontSize = 12.sp, color = Color(0xFF8A94A3))
            }
        }
        if (!event.location.isNullOrBlank()) {
            Text(event.location, fontSize = 12.sp, color = Color(0xFF8A94A3))
        }
        event.eliminationResult?.let {
            Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = theme.accent)
        }
        profile.rankings.filter { it.eventId == event.id }.forEach { standing ->
            Text("Qualification #${standing.rank} · ${standing.record}",
                fontSize = 12.sp, color = Color(0xFFD5DAE3))
        }
    }
}

// MARK: - Event detail

@Composable
fun EventScreen(id: String, theme: VexTheme, onBack: () -> Unit, onOpenTeam: (String) -> Unit) {
    var detail by remember { mutableStateOf<EventDetailResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var section by remember { mutableStateOf<EventSection?>(null) }
    var divisionId by remember { mutableStateOf<Int?>(null) }
    var sort by remember { mutableStateOf(StandingSort.RANK) }
    var reload by remember { mutableStateOf(0) }

    LaunchedEffect(id, reload) {
        error = null
        runCatching { api.eventDetail(id) }
            .onSuccess { detail = it }
            .onFailure { error = it.message }
    }

    ScreenScaffold(detail?.event?.name ?: "Event", theme, onBack = onBack) { padding ->
        Box(Modifier.padding(padding)) {
            PhaseFade(detail to error, { (loaded, failure) ->
                if (loaded != null) 2 else if (failure != null) 1 else 0
            }) { (loaded, failure) ->
            when {
                failure != null && loaded == null -> Failed(failure, theme) { reload++ }
                loaded == null -> Loading("Loading event…", theme)
                else -> {
                    val sections = loaded.availableSections
                    val active = section ?: sections.firstOrNull()
                    val divisions = active?.let { loaded.divisions(it) }.orEmpty()
                    val division = divisions.firstOrNull { it.id == divisionId } ?: divisions.firstOrNull()
                    // Fitted once per division, not on every recomposition: it
                    // solves a system across every qualification match, and the
                    // chip and section changes recompose this screen often.
                    val ratings = remember(division) { division?.powerRatings() }

                    Column {
                        if (sections.isNotEmpty()) {
                            ChipRow(sections, active, theme, label = { it.label }) {
                                section = it
                                // The chosen division may not exist under the
                                // new section; let it fall back.
                                divisionId = null
                            }
                            Spacer(Modifier.height(8.dp))
                        }
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            if (divisions.size > 1 && active?.isPerDivision == true) {
                                DropdownPicker(division?.name ?: "Division",
                                    divisions.map { it.name }, null, theme) { picked ->
                                    divisionId = divisions.firstOrNull { it.name == picked }?.id
                                }
                            }
                            if (active == EventSection.RANKINGS && division != null) {
                                val sorts = division.availableSorts()
                                DropdownPicker(
                                    if (sort == StandingSort.RANK) "Seeding rank" else "By ${sort.label}",
                                    sorts.map {
                                        if (it == StandingSort.RANK) "Seeding rank"
                                        // Says which way the column runs,
                                        // because for DPR the best is smallest.
                                        else "${it.label} · ${if (it.ascending) "lowest first" else "highest first"}"
                                    }, null, theme,
                                ) { picked ->
                                    sort = sorts.firstOrNull {
                                        picked == (if (it == StandingSort.RANK) "Seeding rank"
                                        else "${it.label} · ${if (it.ascending) "lowest first" else "highest first"}")
                                    } ?: StandingSort.RANK
                                }
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        HorizontalDivider(color = Color(0x14FFFFFF))

                        LazyColumn {
                            item { EventHeaderCard(loaded, theme) }
                            when (active) {
                                EventSection.RANKINGS -> if (division != null && ratings != null) {
                                    val rows = division.standings(sort, ratings)
                                    items(rows.size) { index ->
                                        StandingRow(index + 1, rows[index], ratings, sort, theme) {
                                            onOpenTeam(rows[index].team.name)
                                        }
                                    }
                                }
                                EventSection.MATCHES -> if (division != null) {
                                    items(division.qualification + division.elimination) { match ->
                                        MatchRow(match, theme)
                                    }
                                }
                                EventSection.BRACKET -> if (division != null) {
                                    items(division.elimination) { match -> MatchRow(match, theme) }
                                }
                                EventSection.AWARDS -> items(loaded.awards) { award ->
                                    Column(Modifier.padding(16.dp)) {
                                        Text(award.title ?: "Award", fontSize = 14.sp, color = Color(0xFFF2F4F8))
                                        val winners = award.teamWinners.orEmpty()
                                            .mapNotNull { it.team?.name }.joinToString(", ")
                                        if (winners.isNotEmpty()) {
                                            Text(winners, fontSize = 12.sp, color = Color(0xFF8A94A3))
                                        }
                                    }
                                }
                                EventSection.SKILLS -> {
                                    val leaders = loaded.skillsLeaderboard
                                    items(leaders.size) { index ->
                                        val leader = leaders[index]
                                        Row(Modifier.fillMaxWidth().padding(16.dp)) {
                                            Text("#${index + 1}", color = theme.accent,
                                                fontWeight = FontWeight.SemiBold,
                                                modifier = Modifier.width(44.dp))
                                            Text(leader.number, color = Color(0xFFF2F4F8),
                                                modifier = Modifier.weight(1f))
                                            Text("${leader.total}", color = Color(0xFFF2F4F8),
                                                fontFamily = FontFamily.Monospace)
                                        }
                                    }
                                }
                                EventSection.TEAMS -> {
                                    val teams = loaded.teams.sortedWith { a, b ->
                                        TeamNumber.compare(a.number, b.number)
                                    }
                                    items(teams, key = { it.id }) { team ->
                                        Row(Modifier.fillMaxWidth()
                                            .clickable { onOpenTeam(team.number) }.padding(16.dp)) {
                                            Column {
                                                Text(team.number, fontSize = 15.sp,
                                                    fontWeight = FontWeight.SemiBold, color = Color(0xFFF2F4F8))
                                                if (!team.name.isNullOrBlank()) {
                                                    Text(team.name, fontSize = 12.sp, color = Color(0xFF8A94A3))
                                                }
                                            }
                                        }
                                    }
                                }
                                null -> item {
                                    Text("No official results were published for this event.",
                                        fontSize = 13.sp, color = Color(0xFF8A94A3),
                                        modifier = Modifier.padding(16.dp))
                                }
                            }
                            item { Spacer(Modifier.height(32.dp)) }
                        }
                    }
                }
            }
            }
        }
    }
}

@Composable
private fun EventHeaderCard(detail: EventDetailResponse, theme: VexTheme) {
    Card(theme, Modifier.padding(16.dp)) {
        Text(detail.event.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
            color = Color(0xFFF2F4F8))
        Spacer(Modifier.height(8.dp))
        detail.event.day?.let {
            Text(it.format(java.time.format.DateTimeFormatter.ofPattern("MMMM d, yyyy")),
                fontSize = 13.sp, color = Color(0xFF8A94A3))
        }
        if (detail.event.venueLine.isNotBlank()) {
            Text(detail.event.venueLine, fontSize = 13.sp, color = Color(0xFF8A94A3))
        }
        detail.event.official?.let {
            Spacer(Modifier.height(8.dp))
            OpenInBrowser(it, "View on events.vex.com", theme)
        }
    }
}

@Composable
private fun StandingRow(position: Int, row: DivisionRanking, ratings: PowerRatings,
                        sort: StandingSort, theme: VexTheme, onClick: () -> Unit) {
    val stats = ratings[row.team.name]
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("#${if (sort == StandingSort.RANK) row.rank else position}",
                color = theme.accent, fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp, modifier = Modifier.width(44.dp))
            Text(row.team.name, fontSize = 15.sp, color = Color(0xFFF2F4F8), modifier = Modifier.weight(1f))
            Text(row.record, fontSize = 12.sp, color = Color(0xFF8A94A3), fontFamily = FontFamily.Monospace)
        }
        Spacer(Modifier.height(4.dp))
        Row(Modifier.padding(start = 44.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            // When the order is not the seeding, the official seed moves into
            // the stat line so neither number pretends to be the other.
            if (sort != StandingSort.RANK) Stat("Seed", "#${row.rank}")
            Stat("WP", row.wp?.toString())
            Stat("AP", row.ap?.toString())
            Stat("SP", row.sp?.toString())
            Stat("High", row.highScore?.toString())
        }
        if (stats != null) {
            Row(Modifier.padding(start = 44.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Stat("OPR", String.format("%.1f", stats.opr))
                Stat("DPR", String.format("%.1f", stats.dpr))
                Stat("CCWM", String.format("%.1f", stats.ccwm))
            }
        }
    }
}

@Composable
private fun MatchRow(match: DivisionMatch, theme: VexTheme) {
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Row {
            Text(match.name ?: "Match", fontSize = 14.sp, fontWeight = FontWeight.Medium,
                color = Color(0xFFF2F4F8), modifier = Modifier.weight(1f))
            Text(if (match.isPlayed) (match.field ?: "Final") else "Not played",
                fontSize = 11.sp, color = Color(0xFF8A94A3))
        }
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            AllianceColumn(match.red, Color(0xFFFF5A5F), match.winner == "red", match.isPlayed,
                Modifier.weight(1f))
            AllianceColumn(match.blue, Color(0xFF4FA8FF), match.winner == "blue", match.isPlayed,
                Modifier.weight(1f))
        }
    }
}

@Composable
private fun AllianceColumn(alliance: MatchAlliance?, colour: Color, won: Boolean,
                           played: Boolean, modifier: Modifier) {
    Row(modifier) {
        Box(Modifier.width(2.dp).height(44.dp).background(colour))
        Spacer(Modifier.width(8.dp))
        Column {
            Text(if (played) (alliance?.score?.toString() ?: "—") else "—",
                fontSize = 18.sp, color = colour, fontFamily = FontFamily.Monospace,
                fontWeight = if (won) FontWeight.Bold else FontWeight.Normal)
            alliance?.numbers.orEmpty().forEach {
                Text(it, fontSize = 11.sp, color = Color(0xFF8A94A3))
            }
        }
    }
}
