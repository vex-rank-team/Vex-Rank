package com.vexrank.scout

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL
import kotlin.random.Random

class ApiException(message: String) : Exception(message)

/// The VEXRank Worker.
///
/// Carries the same two lessons the iOS client learned. Requests are retried
/// through the service's intermittent cold-start failures, and responses are
/// cached briefly with concurrent callers for the same thing coalesced - one
/// journey through the app otherwise fetches the same event detail three or
/// four times.
///
/// A forced refresh skips this cache and asks again, but deliberately does not
/// try to bust the edge: served from there a response arrives in about 80ms,
/// and on a miss the Worker fans out upstream and has been measured at twenty
/// seconds. The edge holds these about a minute, which is finer-grained than
/// anything polling them.
class VexRankApi(private val baseUrl: String = DEFAULT_BASE_URL) {

    companion object {
        const val DEFAULT_BASE_URL = "https://vexrank-api-test.qiansteven54.workers.dev"
    }

    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }
    private val lock = Mutex()
    private val cached = HashMap<String, Pair<Long, Any>>()
    private val inFlight = HashMap<String, CompletableDeferred<Any>>()

    /// Short for anything that changes during a competition, long for the
    /// directory, which is rebuilt daily.
    private fun lifetimeMillis(path: String): Long = when {
        path.startsWith("/api/team-directory") -> 3_600_000
        path.startsWith("/api/events/") -> 30_000
        else -> 120_000
    }

    suspend fun rankings(season: Int? = null, fresh: Boolean = false): RankingsResponse {
        var path = "/api/rankings?data=v49"
        if (season != null) path += "&season=$season"
        return get(path, fresh) { json.decodeFromString<RankingsResponse>(it) }
    }

    suspend fun events(season: Int = 204, fresh: Boolean = false): EventsResponse =
        get("/api/events?season=$season&classification=v49", fresh) {
            json.decodeFromString<EventsResponse>(it)
        }

    suspend fun eventDetail(id: String, fresh: Boolean = false): EventDetailResponse =
        get("/api/events/$id?results=v49", fresh) { json.decodeFromString<EventDetailResponse>(it) }

    suspend fun teamProfile(number: String, fresh: Boolean = false): TeamProfileResponse =
        get("/api/teams/$number?profile=v8", fresh) { json.decodeFromString<TeamProfileResponse>(it) }

    suspend fun skills(season: Int = 204, fresh: Boolean = false): SkillsResponse =
        get("/api/skills?season=$season", fresh) { json.decodeFromString<SkillsResponse>(it) }

    suspend fun teamDirectory(fresh: Boolean = false): TeamDirectoryResponse =
        get("/api/team-directory", fresh, attempts = 1) {
            json.decodeFromString<TeamDirectoryResponse>(it)
        }

    @Suppress("UNCHECKED_CAST")
    private suspend fun <T : Any> get(
        path: String,
        fresh: Boolean,
        attempts: Int = 3,
        decode: (String) -> T,
    ): T {
        if (!fresh) {
            val waiter = lock.withLock {
                val hit = cached[path]
                if (hit != null && System.currentTimeMillis() - hit.first < lifetimeMillis(path)) {
                    return hit.second as T
                }
                // A second caller for the same thing waits on the first rather
                // than starting its own request.
                inFlight[path]
            }
            if (waiter != null) return waiter.await() as T
        }

        val pending = CompletableDeferred<Any>()
        lock.withLock { inFlight[path] = pending }
        try {
            val value = fetch(path, attempts, decode)
            lock.withLock {
                cached[path] = System.currentTimeMillis() to value
                inFlight.remove(path)
            }
            pending.complete(value)
            return value
        } catch (error: Throwable) {
            lock.withLock { inFlight.remove(path) }
            pending.completeExceptionally(error)
            throw error
        }
    }

    /// Retries 5xx and transport failures with backoff and jitter. The service
    /// returns intermittent 502s on cold start, so a single failure should not
    /// reach the reader.
    private suspend fun <T> fetch(path: String, attempts: Int, decode: (String) -> T): T =
        withContext(Dispatchers.IO) {
            var last: Exception = ApiException("Could not reach the VEXRank service.")
            repeat(attempts) { attempt ->
                try {
                    val connection = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
                        connectTimeout = 30_000
                        readTimeout = 90_000
                        setRequestProperty("Accept", "application/json")
                    }
                    try {
                        val status = connection.responseCode
                        if (status in 200..299) {
                            val body = connection.inputStream.bufferedReader().use { it.readText() }
                            return@withContext try {
                                decode(body)
                            } catch (error: Exception) {
                                // Decoding failures are deterministic; retrying
                                // cannot help.
                                throw ApiException("The service returned something unexpected.")
                            }
                        }
                        // 4xx will not fix itself either.
                        if (status < 500) throw ApiException("The service replied $status.")
                        last = ApiException("The service replied $status.")
                    } finally {
                        connection.disconnect()
                    }
                } catch (error: ApiException) {
                    throw error
                } catch (error: Exception) {
                    last = ApiException("Could not reach the VEXRank service.")
                }
                if (attempt < attempts - 1) {
                    delay((250L shl attempt) + Random.nextLong(120))
                }
            }
            throw last
        }
}
