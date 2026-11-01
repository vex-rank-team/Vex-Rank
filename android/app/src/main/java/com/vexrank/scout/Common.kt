package com.vexrank.scout

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScreenScaffold(
    title: String,
    theme: VexTheme,
    onTheme: ((VexTheme) -> Unit)? = null,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    Scaffold(
        containerColor = theme.page,
        topBar = {
            TopAppBar(
                title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    if (onBack != null) {
                        IconButton(onClick = onBack) {
                            Icon(Icons.Filled.ArrowBack, contentDescription = "Back")
                        }
                    }
                },
                actions = {
                    actions()
                    if (onTheme != null) ThemeMenu(theme, onTheme)
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = theme.page,
                    titleContentColor = Color(0xFFF2F4F8),
                ),
            )
        },
        content = content,
    )
}

@Composable
private fun ThemeMenu(theme: VexTheme, onTheme: (VexTheme) -> Unit) {
    var open by remember { mutableStateOf(false) }
    IconButton(onClick = { open = true }) {
        Icon(Icons.Filled.Contrast, contentDescription = "Colour theme", tint = theme.accent)
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        VexTheme.entries.forEach { option ->
            DropdownMenuItem(
                text = { Text(option.label) },
                onClick = { onTheme(option); open = false },
            )
        }
    }
}

/// A chip row, the same control the iOS app uses for stat categories and
/// event sections.
@Composable
fun <T> ChipRow(
    options: List<T>,
    selected: T?,
    theme: VexTheme,
    label: (T) -> String,
    onSelect: (T) -> Unit,
) {
    Row(
        Modifier
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        options.forEach { option ->
            val active = option == selected
            // Eased rather than snapped, and short: the list under the chips
            // changes at the same moment and should not wait on it.
            val fill by animateColorAsState(if (active) theme.accent else theme.surface,
                tween(180), label = "chip fill")
            val ink by animateColorAsState(if (active) theme.onAccent else Color(0xFFB9C0CC),
                tween(180), label = "chip ink")
            Box(
                Modifier
                    // The pill stays 32dp; the touch target around it is 48dp.
                    .minimumInteractiveComponentSize()
                    .clip(RoundedCornerShape(50))
                    .background(fill)
                    .selectable(selected = active, role = Role.Tab) { onSelect(option) }
                    .padding(horizontal = 14.dp, vertical = 7.dp)
            ) {
                Text(label(option), color = ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
fun DropdownPicker(
    label: String,
    options: List<String>,
    resetLabel: String?,
    theme: VexTheme,
    onSelect: (String?) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier
                .heightIn(min = 48.dp)
                .clip(RoundedCornerShape(8.dp))
                .clickable(role = Role.DropdownList) { open = true }
                .padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, color = theme.accent, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(Icons.Filled.ArrowDropDown, contentDescription = null, tint = theme.accent)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (resetLabel != null) {
                DropdownMenuItem(text = { Text(resetLabel) }, onClick = { onSelect(null); open = false })
            }
            options.forEach { option ->
                DropdownMenuItem(text = { Text(option) }, onClick = { onSelect(option); open = false })
            }
        }
    }
}

@Composable
fun Stat(label: String, value: String?, modifier: Modifier = Modifier) {
    if (value == null) return
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = Ink.subtle)
        Spacer(Modifier.width(3.dp))
        Text(value, fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = Color(0xFFB9C0CC))
    }
}

@Composable
fun Loading(message: String, theme: VexTheme) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = theme.accent)
            Spacer(Modifier.height(12.dp))
            Text(message, color = Color(0xFF8A94A3), fontSize = 13.sp)
        }
    }
}

/// Says what went wrong and offers the way out, rather than an empty list that
/// reads as "nothing exists".
@Composable
fun Failed(message: String, theme: VexTheme, onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp),
        ) {
            Icon(Icons.Filled.CloudOff, contentDescription = null, tint = Color(0xFF8A94A3))
            Spacer(Modifier.height(12.dp))
            Text(message, color = Color(0xFF8A94A3), fontSize = 14.sp)
            Spacer(Modifier.height(16.dp))
            Button(onClick = onRetry, colors = ButtonDefaults.buttonColors(containerColor = theme.accent)) {
                Text("Retry")
            }
        }
    }
}

/// Fades between loading, failed and loaded - and only between them. Keyed on
/// the phase, so a refresh that lands new data on a loaded list recomposes it
/// in place and keeps its scroll position, instead of fading in a fresh copy.
@Composable
fun <T> PhaseFade(state: T, phase: (T) -> Int, content: @Composable (T) -> Unit) {
    AnimatedContent(
        targetState = state,
        contentKey = phase,
        // The outgoing phase leaves quickly; the arrival waits a beat so the
        // two never sit on screen at half strength together.
        transitionSpec = { fadeIn(tween(220, delayMillis = 60)) togetherWith fadeOut(tween(120)) },
        label = "phase",
    ) { content(it) }
}

@Composable
fun Card(theme: VexTheme, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(theme.surface)
            .padding(16.dp),
        content = content,
    )
}
