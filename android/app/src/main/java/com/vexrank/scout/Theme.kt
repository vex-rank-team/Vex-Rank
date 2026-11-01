package com.vexrank.scout

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/// The same four palettes the iOS app and the website offer, with the same
/// values - each accent checked to clear AA on its own surface. They had
/// drifted: Midnight was sky blue here and red everywhere else.
///
/// `onAccent` is the ink for text on an accent fill. White on the three lighter
/// accents measured 1.5 to 2.1:1, so those themes use near-black; the red keeps
/// white, its brand pairing (4.07:1), and only carries semibold labels.
enum class VexTheme(val label: String, val page: Color, val surface: Color,
                    val surfaceRaised: Color, val accent: Color, val onAccent: Color,
                    val band: Color) {
    MIDNIGHT("Midnight", Color(0xFF090B0F), Color(0xFF101319), Color(0xFF151A22),
        Color(0xFFEE3240), Color.White, Color(0xFF282C20)),
    EMBER("Ember", Color(0xFF0D0B09), Color(0xFF17130F), Color(0xFF1E1914),
        Color(0xFFF5A524), Ink.onLightAccent, Color(0xFF2C2416)),
    ABYSS("Abyss", Color(0xFF070A12), Color(0xFF0E1420), Color(0xFF141C2C),
        Color(0xFF38BDF8), Ink.onLightAccent, Color(0xFF16283A)),
    MOSS("Moss", Color(0xFF0A0C09), Color(0xFF121711), Color(0xFF1A2018),
        Color(0xFFA3E635), Ink.onLightAccent, Color(0xFF232D1C));

    companion object {
        fun named(id: String?) = entries.firstOrNull { it.name == id } ?: MIDNIGHT
    }
}

/// Text colours, by role. Measured on the darkest and lightest surfaces above.
object Ink {
    val primary = Color(0xFFF2F4F8)
    /// Secondary lines: 6.1:1.
    val muted = Color(0xFF8A94A3)
    /// The quietest text that still reads, 4.9:1. `#6B7484`, used before for
    /// record and location lines, measured 3.9:1.
    val subtle = Color(0xFF7A8492)
    val onLightAccent = Color(0xFF0B0D10)
}

@Composable
fun MakapakaTheme(theme: VexTheme, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = theme.accent,
            background = theme.page,
            surface = theme.surface,
            surfaceVariant = theme.surfaceRaised,
            onPrimary = theme.onAccent,
            onBackground = Ink.primary,
            onSurface = Ink.primary,
        ),
        content = content,
    )
}
