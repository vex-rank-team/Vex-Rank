package com.vexrank.scout

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class FavouriteTeam(val number: String, val name: String? = null)

/// Starred teams, kept on the device.
///
/// The name is stored with the number so the favourites list draws the moment
/// the app opens. Looking it up would mean waiting on the 56,000-team
/// directory, which is the one thing a shortcut must not do.
class Favourites(context: Context) {
    private val prefs = context.getSharedPreferences("makapaka", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    var theme: String
        get() = prefs.getString("theme", VexTheme.MIDNIGHT.name) ?: VexTheme.MIDNIGHT.name
        set(value) = prefs.edit().putString("theme", value).apply()

    var teams: List<FavouriteTeam> = load()
        private set

    private fun load(): List<FavouriteTeam> {
        val raw = prefs.getString("favourites", null) ?: return emptyList()
        val stored = runCatching { json.decodeFromString<List<FavouriteTeam>>(raw) }.getOrNull()
            ?: return emptyList()
        // Deduplicated on the way in: an older build could have written the
        // same team twice under different capitalisation.
        val seen = HashSet<String>()
        return stored.filter { seen.add(it.number.uppercase()) }
            .sortedWith { a, b -> TeamNumber.compare(a.number, b.number) }
    }

    fun contains(number: String) = teams.any { it.number.equals(number, ignoreCase = true) }

    fun add(team: FavouriteTeam) {
        val existing = teams.indexOfFirst { it.number.equals(team.number, ignoreCase = true) }
        val next = teams.toMutableList()
        if (existing >= 0) {
            // A team starred from a match list, where only the number is known,
            // picks up its name the first time it is seen somewhere with one.
            val name = team.name?.takeIf { it.isNotBlank() } ?: return
            next[existing] = next[existing].copy(name = name)
        } else {
            next.add(team)
        }
        save(next)
    }

    fun remove(number: String) = save(teams.filterNot { it.number.equals(number, ignoreCase = true) })

    fun toggle(team: FavouriteTeam) =
        if (contains(team.number)) remove(team.number) else add(team)

    private fun save(next: List<FavouriteTeam>) {
        teams = next.sortedWith { a, b -> TeamNumber.compare(a.number, b.number) }
        prefs.edit().putString("favourites",
            json.encodeToString(kotlinx.serialization.builtins.ListSerializer(FavouriteTeam.serializer()), teams)).apply()
    }
}
