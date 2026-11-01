package com.vexrank.scout

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val favourites = Favourites(applicationContext)
        setContent {
            var themeId by remember { mutableStateOf(favourites.theme) }
            val theme = VexTheme.named(themeId)
            MakapakaTheme(theme) {
                Root(theme, favourites) {
                    themeId = it.name
                    favourites.theme = it.name
                }
            }
        }
    }
}

private enum class Tab(val label: String, val icon: ImageVector) {
    RANKINGS("Rankings", Icons.Filled.EmojiEvents),
    EVENTS("Events", Icons.Filled.CalendarMonth),
    STATS("Stats", Icons.Filled.BarChart),
    TEAMS("Teams", Icons.Filled.Group),
}

@Composable
private fun Root(theme: VexTheme, favourites: Favourites, onTheme: (VexTheme) -> Unit) {
    var tab by remember { mutableStateOf(Tab.RANKINGS) }
    val navigators = Tab.entries.associateWith { rememberNavController() }
    // Holds each tab's saved state while it is off screen. Without it a tab's
    // NavHost left composition on every switch and took its scroll positions,
    // filters and loaded lists with it, so every return started from the top.
    val saved = rememberSaveableStateHolder()

    Scaffold(
        containerColor = theme.page,
        bottomBar = {
            NavigationBar(containerColor = theme.surface) {
                Tab.entries.forEach { entry ->
                    NavigationBarItem(
                        selected = tab == entry,
                        onClick = {
                            // Tapping the tab you are on goes back to its top
                            // screen, as it does on iOS.
                            if (tab == entry) {
                                val nav = navigators.getValue(entry)
                                nav.graph.startDestinationRoute?.let { nav.popBackStack(it, inclusive = false) }
                            }
                            tab = entry
                        },
                        icon = { Icon(entry.icon, contentDescription = entry.label) },
                        label = { Text(entry.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = theme.accent,
                            selectedTextColor = theme.accent,
                            indicatorColor = theme.surfaceRaised,
                        ),
                    )
                }
            }
        },
    ) { padding ->
        Box(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .background(theme.page)
        ) {
            // Each tab keeps its own back stack, the way the iOS tabs each
            // keep their own navigation path. Switching is a quick fade-through:
            // tabs are peers, so nothing slides.
            AnimatedContent(
                targetState = tab,
                transitionSpec = { fadeIn(tween(180, delayMillis = 60)) togetherWith fadeOut(tween(90)) },
                label = "tab",
            ) { entry ->
                saved.SaveableStateProvider(entry.name) {
                    TabHost(entry, navigators.getValue(entry), theme, favourites, onTheme)
                }
            }
        }
    }
}

@Composable
private fun TabHost(
    tab: Tab,
    nav: NavHostController,
    theme: VexTheme,
    favourites: Favourites,
    onTheme: (VexTheme) -> Unit,
) {
    val start = when (tab) {
        Tab.RANKINGS -> "rankings"
        Tab.EVENTS -> "events"
        Tab.STATS -> "stats"
        Tab.TEAMS -> "teams"
    }
    // Push and pop move along the reading direction, so where a screen came
    // from is visible. The default was a 700ms crossfade with no direction,
    // which read as the app hesitating.
    NavHost(
        nav,
        startDestination = start,
        enterTransition = {
            slideInHorizontally(tween(300, easing = LinearOutSlowInEasing)) { it / 5 } +
                fadeIn(tween(220, delayMillis = 40))
        },
        exitTransition = {
            slideOutHorizontally(tween(260, easing = FastOutLinearInEasing)) { -it / 10 } +
                fadeOut(tween(160))
        },
        popEnterTransition = {
            slideInHorizontally(tween(300, easing = LinearOutSlowInEasing)) { -it / 10 } +
                fadeIn(tween(220, delayMillis = 40))
        },
        popExitTransition = {
            slideOutHorizontally(tween(240, easing = FastOutLinearInEasing)) { it / 5 } +
                fadeOut(tween(160))
        },
    ) {
        composable("rankings") { RankingsScreen(theme, onTheme) { nav.navigate("team/$it") } }
        composable("events") { EventsScreen(theme, onTheme) { nav.navigate("event/$it") } }
        composable("stats") { StatsScreen(theme, onTheme) { nav.navigate("team/$it") } }
        composable("teams") { TeamsScreen(theme, favourites, onTheme) { nav.navigate("team/$it") } }
        composable("team/{number}") { entry ->
            TeamScreen(
                number = entry.arguments?.getString("number").orEmpty(),
                theme = theme,
                favourites = favourites,
                onBack = { nav.popBackStack() },
                onOpenEvent = { nav.navigate("event/$it") },
            )
        }
        composable("event/{id}") { entry ->
            EventScreen(
                id = entry.arguments?.getString("id").orEmpty(),
                theme = theme,
                onBack = { nav.popBackStack() },
                onOpenTeam = { nav.navigate("team/$it") },
            )
        }
    }
}
