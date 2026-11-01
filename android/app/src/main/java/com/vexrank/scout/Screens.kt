package com.vexrank.scout

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val api = VexRankApi()

@Composable
fun SearchField(value: String, placeholder: String, theme: VexTheme, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        placeholder = { Text(placeholder, color = Color(0xFF7A8492)) },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, tint = Color(0xFF7A8492)) },
        singleLine = true,
        keyboardOptions = KeyboardOptions.Default,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = theme.accent,
            unfocusedBorderColor = Color(0x22FFFFFF),
            focusedContainerColor = theme.surface,
            unfocusedContainerColor = theme.surface,
        ),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

// MARK: - Rankings

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RankingsScreen(theme: VexTheme, onTheme: (VexTheme) -> Unit, onOpenTeam: (String) -> Unit) {
    var state by remember { mutableStateOf<Result<RankingsResponse>?>(null) }
    var filter by remember { mutableStateOf(RankingFilter()) }
    var reload by remember { mutableStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(reload) {
        state = null
        state = runCatching { api.rankings() }
    }

    ScreenScaffold("World ranking", theme, onTheme) { padding ->
        Box(Modifier.padding(padding)) {
            PhaseFade(state, ::phaseOf) { result ->
            when {
                result == null -> Loading("Loading world ranking…", theme)
                result.isFailure -> Failed(
                    result.exceptionOrNull()?.message ?: "Could not load rankings", theme
                ) { reload++ }
                else -> {
                    val response = result.getOrThrow()
                    val all = response.sortedForDisplay
                    val shown = filter.apply(all)
                    Column {
                        SearchField(filter.search, "Search team number or name", theme) {
                            filter = filter.copy(search = it)
                        }
                        ChipRow(RankingFilter.Grade.entries.toList(), filter.grade, theme,
                            label = { if (it == RankingFilter.Grade.ALL) "All" else it.label }) {
                            filter = filter.copy(grade = it)
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            DropdownPicker(filter.country ?: "All countries",
                                RankingFilter.countries(all), "All countries", theme) {
                                // A region from the old country matches nothing.
                                filter = filter.copy(country = it, region = null)
                            }
                            DropdownPicker(filter.region ?: "All regions",
                                RankingFilter.regions(all, filter.country), "All regions", theme) {
                                filter = filter.copy(region = it)
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        Summary(shown, response, filter, theme)
                        HorizontalDivider(color = Color(0x14FFFFFF))
                        // A pull keeps the table on screen and swaps the rows
                        // in place; a failed refresh keeps the old ones.
                        PullToRefreshBox(isRefreshing = refreshing, onRefresh = {
                            scope.launch {
                                refreshing = true
                                runCatching { api.rankings(fresh = true) }
                                    .onSuccess { state = Result.success(it) }
                                refreshing = false
                            }
                        }) {
                            LazyColumn(Modifier.fillMaxSize()) {
                                items(shown, key = { it.number }) { team ->
                                    RankingRow(team, theme) { onOpenTeam(team.number) }
                                    HorizontalDivider(color = Color(0x0FFFFFFF))
                                }
                            }
                        }
                    }
                }
            }
            }
        }
    }
}

/// Loading, failed or loaded, for `PhaseFade`.
private fun phaseOf(result: Result<*>?): Int = when {
    result == null -> 0
    result.isFailure -> 1
    else -> 2
}

@Composable
private fun Summary(shown: List<TeamRanking>, response: RankingsResponse,
                    filter: RankingFilter, theme: VexTheme) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        SummaryItem(
            if (filter.grade == RankingFilter.Grade.ALL) "Teams rated" else "${filter.grade.label} rated",
            "${shown.size}", filter.country ?: "4+ official matches", Modifier.weight(1f))
        SummaryItem("Events processed", "${response.eventsProcessed}",
            "${response.matchesProcessed} matches", Modifier.weight(1f))
        SummaryItem("Rating leader", shown.firstOrNull()?.rating?.toString() ?: "—",
            shown.firstOrNull()?.number ?: "No qualifying teams", Modifier.weight(1f))
    }
}

@Composable
private fun SummaryItem(label: String, value: String, detail: String, modifier: Modifier) {
    Column(modifier) {
        Text(label, fontSize = 11.sp, color = Color(0xFF8A94A3), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(value, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFFF2F4F8))
        Text(detail, fontSize = 11.sp, color = Ink.subtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun RankingRow(team: TeamRanking, theme: VexTheme, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("#${team.rank}", color = theme.accent, fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp, modifier = Modifier.width(48.dp))
        Column(Modifier.weight(1f)) {
            Text(team.number, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFFF2F4F8))
            Text(team.name, fontSize = 13.sp, color = Color(0xFF8A94A3), maxLines = 1,
                overflow = TextOverflow.Ellipsis)
            val record = team.record
            if (record != null) {
                Text("$record · ${RankingFilter.regionOf(team) ?: "Unassigned"}",
                    fontSize = 11.sp, color = Ink.subtle, maxLines = 1,
                    overflow = TextOverflow.Ellipsis)
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            Text("${team.rating}", fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
                color = Color(0xFFF2F4F8), fontFamily = FontFamily.Monospace)
            Text("±${team.confidence}", fontSize = 11.sp, color = Color(0xFF8A94A3))
        }
    }
}

// MARK: - Events

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventsScreen(theme: VexTheme, onTheme: (VexTheme) -> Unit, onOpenEvent: (String) -> Unit) {
    var state by remember { mutableStateOf<Result<EventsResponse>?>(null) }
    var query by remember { mutableStateOf("") }
    var upcomingOnly by remember { mutableStateOf(true) }
    var reload by remember { mutableStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(reload) {
        state = null
        state = runCatching { api.events() }
    }

    ScreenScaffold("Events", theme, onTheme) { padding ->
        Box(Modifier.padding(padding)) {
            PhaseFade(state, ::phaseOf) { result ->
            when {
                result == null -> Loading("Loading events…", theme)
                result.isFailure -> Failed(
                    result.exceptionOrNull()?.message ?: "Could not load events", theme) { reload++ }
                else -> {
                    val needle = query.trim().lowercase()
                    val shown = result.getOrThrow().events
                        .filter { !upcomingOnly || it.isUpcoming }
                        .filter {
                            needle.isEmpty() || it.name.lowercase().contains(needle) ||
                                it.place.lowercase().contains(needle)
                        }
                        .sortedBy { it.date }
                    Column {
                        SearchField(query, "Search events by name or place", theme) { query = it }
                        ChipRow(listOf(true, false), upcomingOnly, theme,
                            label = { if (it) "Upcoming" else "All" }) { upcomingOnly = it }
                        Spacer(Modifier.height(10.dp))
                        HorizontalDivider(color = Color(0x14FFFFFF))
                        PullToRefreshBox(isRefreshing = refreshing, onRefresh = {
                            scope.launch {
                                refreshing = true
                                runCatching { api.events(fresh = true) }
                                    .onSuccess { state = Result.success(it) }
                                refreshing = false
                            }
                        }) {
                            LazyColumn(Modifier.fillMaxSize()) {
                                if (shown.isEmpty()) item {
                                    // Says why the list is empty, rather than
                                    // leaving a blank that reads as broken.
                                    Text(if (needle.isEmpty()) "No upcoming events. Choose All to see past ones."
                                        else "No events match \"$query\".",
                                        fontSize = 14.sp, color = Ink.muted,
                                        modifier = Modifier.padding(24.dp))
                                }
                                items(shown, key = { it.id }) { event ->
                                    EventRow(event, theme) { onOpenEvent(event.id) }
                                    HorizontalDivider(color = Color(0x0FFFFFFF))
                                }
                            }
                        }
                    }
                }
            }
            }
        }
    }
}

@Composable
private fun EventRow(event: VexEvent, theme: VexTheme, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                event.day?.format(java.time.format.DateTimeFormatter.ofPattern("MMM d"))
                    ?: event.date,
                color = theme.accent, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
            )
            Spacer(Modifier.width(10.dp))
            Text(event.status ?: "", color = Color(0xFF8A94A3), fontSize = 13.sp)
        }
        Spacer(Modifier.height(4.dp))
        Text(event.name, fontSize = 15.sp, color = Color(0xFFF2F4F8), maxLines = 2,
            overflow = TextOverflow.Ellipsis)
        if (event.place.isNotEmpty()) {
            Text(event.place, fontSize = 12.sp, color = Ink.subtle, maxLines = 1,
                overflow = TextOverflow.Ellipsis)
        }
    }
}

// MARK: - Stats

@Composable
fun StatsScreen(theme: VexTheme, onTheme: (VexTheme) -> Unit, onOpenTeam: (String) -> Unit) {
    var teams by remember { mutableStateOf<List<TeamRanking>>(emptyList()) }
    var skills by remember { mutableStateOf<List<SkillsEntry>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var category by remember { mutableStateOf(StatCategory.all.first()) }
    var country by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableStateOf(0) }

    LaunchedEffect(reload) {
        loading = true
        error = null
        runCatching {
            // Both feeds are needed before anything can rank.
            teams = api.rankings().rankings
            skills = api.skills().rankings
        }.onFailure { error = it.message }
        loading = false
    }

    ScreenScaffold("Stat leaders", theme, onTheme) { padding ->
        Box(Modifier.padding(padding)) {
            PhaseFade(loading to error, { (busy, failure) -> if (busy) 0 else if (failure != null) 1 else 2 }) { (busy, failure) ->
            when {
                busy -> Loading("Loading leaderboards…", theme)
                failure != null -> Failed(failure, theme) { reload++ }
                else -> {
                    val rows = StatLeaders.rank(category, teams, skills, country)
                    Column {
                        ChipRow(StatCategory.all, category, theme, label = { it.id }) {
                            category = it
                            // A country in one feed may not exist in the other.
                            country = null
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Text(category.detail, fontSize = 11.sp, color = Color(0xFF8A94A3),
                                modifier = Modifier.weight(1f))
                            Spacer(Modifier.width(12.dp))
                            DropdownPicker(country ?: "All regions",
                                StatLeaders.countries(category, teams, skills), "All regions", theme) {
                                country = it
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        HorizontalDivider(color = Color(0x14FFFFFF))
                        LazyColumn {
                            items(rows.size) { index ->
                                val row = rows[index]
                                StatRow(index + 1, row, category, theme) {
                                    if (row.opensProfile) onOpenTeam(row.number)
                                }
                                HorizontalDivider(color = Color(0x0FFFFFFF))
                            }
                        }
                    }
                }
            }
            }
        }
    }
}

@Composable
private fun StatRow(position: Int, row: StatLeader, category: StatCategory,
                    theme: VexTheme, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = row.opensProfile, onClick = onClick).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("#$position", color = theme.accent, fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp, modifier = Modifier.width(48.dp))
        Column(Modifier.weight(1f)) {
            Text(row.number, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFFF2F4F8))
            Text(row.name, fontSize = 13.sp, color = Color(0xFF8A94A3), maxLines = 1,
                overflow = TextOverflow.Ellipsis)
            Text("${row.context} · ${row.region}", fontSize = 11.sp, color = Ink.subtle,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(String.format("%.${category.fractionDigits}f", row.value),
            fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFFF2F4F8),
            fontFamily = FontFamily.Monospace)
    }
}

// MARK: - Teams

@Composable
fun TeamsScreen(theme: VexTheme, favourites: Favourites, onTheme: (VexTheme) -> Unit,
                onOpenTeam: (String) -> Unit) {
    var favouritesOnly by remember { mutableStateOf(true) }
    var query by remember { mutableStateOf("") }
    var indexed by remember { mutableStateOf<List<Pair<DirectoryTeam, ByteArray>>>(emptyList()) }
    var total by remember { mutableStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var starred by remember { mutableStateOf(favourites.teams) }
    var reload by remember { mutableStateOf(0) }

    // The directory is only fetched when the reader asks for it: it is 11MB,
    // and the favourites list must not wait on it.
    LaunchedEffect(favouritesOnly, reload) {
        if (favouritesOnly || indexed.isNotEmpty()) return@LaunchedEffect
        loading = true
        error = null
        runCatching {
            val response = api.teamDirectory()
            total = response.total
            // Built off the main thread: lowercasing 56,000 rows into bytes
            // freezes the interface if done where the UI runs.
            indexed = withContext(Dispatchers.Default) {
                response.teams.map { it to TeamDirectory.haystack(it) }
            }
        }.onFailure { error = it.message }
        loading = false
    }

    ScreenScaffold("Teams", theme, onTheme) { padding ->
        Column(Modifier.padding(padding)) {
            ChipRow(listOf(true, false), favouritesOnly, theme,
                label = { if (it) "Favourites" else "All teams" }) { favouritesOnly = it }
            Spacer(Modifier.height(8.dp))
            SearchField(query, if (favouritesOnly) "Search your teams" else "Team number, name or organization",
                theme) { query = it }
            HorizontalDivider(color = Color(0x14FFFFFF))

            if (favouritesOnly) {
                val needle = query.trim().lowercase()
                val shown = starred.filter {
                    needle.isEmpty() || it.number.lowercase().contains(needle) ||
                        (it.name ?: "").lowercase().contains(needle)
                }
                if (starred.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.padding(32.dp)) {
                            Text("No favourite teams yet", fontSize = 17.sp, color = Color(0xFFF2F4F8))
                            Spacer(Modifier.height(8.dp))
                            Text("Star a team from its profile and it will be waiting here.",
                                fontSize = 13.sp, color = Color(0xFF8A94A3))
                            Spacer(Modifier.height(16.dp))
                            Button(onClick = { favouritesOnly = false },
                                colors = ButtonDefaults.buttonColors(containerColor = theme.accent)) {
                                Text("Browse all teams")
                            }
                        }
                    }
                } else {
                    LazyColumn {
                        items(shown, key = { it.number }) { team ->
                            Row(Modifier.fillMaxWidth().clickable { onOpenTeam(team.number) }.padding(16.dp)) {
                                Column(Modifier.weight(1f)) {
                                    Text(team.number, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                                        color = Color(0xFFF2F4F8))
                                    if (!team.name.isNullOrBlank()) {
                                        Text(team.name, fontSize = 13.sp, color = Color(0xFF8A94A3),
                                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                                TextButton(onClick = {
                                    favourites.remove(team.number)
                                    starred = favourites.teams
                                }) { Text("Remove", color = Color(0xFF8A94A3), fontSize = 12.sp) }
                            }
                            HorizontalDivider(color = Color(0x0FFFFFFF))
                        }
                    }
                }
            } else {
                when {
                    loading -> Loading("Loading every team on record…", theme)
                    error != null -> Failed(error!!, theme) { reload++ }
                    else -> {
                        val shown = TeamDirectory.search(indexed, query)
                        Column {
                            Text(
                                if (shown.size == total) "${total} teams" else "${shown.size} of $total teams",
                                fontSize = 11.sp, color = Color(0xFF8A94A3),
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                            )
                            LazyColumn {
                                items(shown, key = { it.id }) { team ->
                                    DirectoryRow(team, theme, favourites.contains(team.number),
                                        onOpen = { onOpenTeam(team.number) }) { starring ->
                                        if (starring) {
                                            favourites.add(FavouriteTeam(team.number, team.name))
                                        } else {
                                            favourites.remove(team.number)
                                        }
                                        starred = favourites.teams
                                    }
                                    HorizontalDivider(color = Color(0x0FFFFFFF))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DirectoryRow(team: DirectoryTeam, theme: VexTheme, starred: Boolean,
                         onOpen: () -> Unit, onStar: (Boolean) -> Unit) {
    var isStarred by remember(team.id) { mutableStateOf(starred) }
    // The row opens the team, as every other team row does; it used to be
    // inert, so a team found here could only be starred, never looked at.
    Row(Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(start = 16.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(team.number, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                    color = Color(0xFFF2F4F8))
                if (team.registered != true) {
                    Spacer(Modifier.width(8.dp))
                    // Otherwise a long-dead team reads as current.
                    Text("INACTIVE", fontSize = 9.sp, fontWeight = FontWeight.SemiBold,
                        color = Ink.subtle)
                }
            }
            if (!team.name.isNullOrBlank()) {
                Text(team.name, fontSize = 13.sp, color = Color(0xFF8A94A3), maxLines = 1,
                    overflow = TextOverflow.Ellipsis)
            }
            Text(listOfNotNull(team.grade, team.place).filter { it.isNotBlank() }.joinToString(" · "),
                fontSize = 11.sp, color = Ink.subtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = { isStarred = !isStarred; onStar(isStarred) }) {
            Icon(
                if (isStarred) Icons.Filled.Star else Icons.Filled.StarBorder,
                contentDescription = if (isStarred) "Remove from favourites" else "Add to favourites",
                tint = theme.accent,
            )
        }
    }
}
