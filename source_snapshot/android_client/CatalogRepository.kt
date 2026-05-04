package com.ott.app

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * CatalogRepository
 *
 * Matches webapp loadCatalog() + authorize() logic exactly:
 *  - Fetches allowed_emails.json + allowed_userids.json from GitHub
 *  - Fetches description.json + mpd_mapping.json
 *  - Merges static videos from AppConfig with remote descriptions
 *  - Persists My List to SharedPreferences
 */
class CatalogRepository(private val context: Context) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .build()

    private val prefs: SharedPreferences =
        context.getSharedPreferences("ott_prefs", Context.MODE_PRIVATE)

    companion object {
        private const val SESSION_KEY = "ott_session_v1"
        private const val MY_LIST_KEY = "ott_my_list_v1"
    }

    // ── Session ───────────────────────────────────────────────────

    fun saveSession(session: UserSession) {
        prefs.edit().putString(SESSION_KEY, JSONObject().apply {
            put("email", session.email)
            put("userId", session.userId)
            put("displayName", session.displayName)
            put("authorizedBy", session.authorizedBy)
            put("signedInAt", session.signedInAt)
        }.toString()).apply()
    }

    fun loadSession(): UserSession? {
        val raw = prefs.getString(SESSION_KEY, null) ?: return null
        return try {
            val j = JSONObject(raw)
            UserSession(
                email = j.optString("email"),
                userId = j.optString("userId"),
                displayName = j.optString("displayName"),
                authorizedBy = j.optString("authorizedBy"),
                signedInAt = j.optString("signedInAt")
            )
        } catch (_: Exception) { null }
    }

    fun clearSession() {
        prefs.edit().remove(SESSION_KEY).apply()
    }

    // ── My List ───────────────────────────────────────────────────

    fun getMyList(): Set<String> {
        val raw = prefs.getString(MY_LIST_KEY, null) ?: return emptySet()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { arr.getString(it) }.toSet()
        } catch (_: Exception) { emptySet() }
    }

    fun toggleMyList(videoId: String): Set<String> {
        val list = getMyList().toMutableSet()
        if (list.contains(videoId)) list.remove(videoId) else list.add(videoId)
        val arr = JSONArray(list.toList())
        prefs.edit().putString(MY_LIST_KEY, arr.toString()).apply()
        return list.toSet()
    }

    // ── Authorization (matches webapp authorize()) ────────────────

    suspend fun authorize(email: String, userId: String): Pair<Boolean, String> =
        withContext(Dispatchers.IO) {
            val normedEmail = email.trim().lowercase()
            val normedUserId = userId.trim().lowercase()

            // Check hard-coded lists first (same as webapp config.js)
            if (normedEmail.isNotEmpty() && AppConfig.ALLOWED_EMAILS.map { it.lowercase() }.contains(normedEmail))
                return@withContext Pair(true, "email")
            if (normedUserId.isNotEmpty() && AppConfig.ALLOWED_USER_IDS.map { it.lowercase() }.contains(normedUserId))
                return@withContext Pair(true, "userId")

            // Fetch remote lists
            try {
                val emailsJson = fetchJson(AppConfig.ALLOWED_EMAILS_URL)
                val userIdsJson = fetchJson(AppConfig.ALLOWED_USER_IDS_URL)

                if (normedEmail.isNotEmpty()) {
                    val arr = emailsJson?.optJSONArray("allowed_emails")
                        ?: emailsJson?.optJSONArray("emails")
                    if (arr != null) {
                        for (i in 0 until arr.length()) {
                            if (arr.getString(i).trim().lowercase() == normedEmail)
                                return@withContext Pair(true, "email")
                        }
                    }
                }

                if (normedUserId.isNotEmpty()) {
                    val arr = userIdsJson?.optJSONArray("allowed_userids")
                        ?: userIdsJson?.optJSONArray("allowed_user_ids")
                    if (arr != null) {
                        for (i in 0 until arr.length()) {
                            if (arr.getString(i).trim().lowercase() == normedUserId)
                                return@withContext Pair(true, "userId")
                        }
                    }
                }
            } catch (_: Exception) {}

            Pair(false, "")
        }

    // ── Catalog loading (matches webapp loadCatalog()) ────────────

    suspend fun loadCatalog(): List<VideoItem> = withContext(Dispatchers.IO) {
        val start = System.currentTimeMillis()

        // Start with static default videos
        val byId = mutableMapOf<String, VideoItem>()
        for (v in AppConfig.DEFAULT_VIDEOS) byId[v.id] = v

        try {
            // Fetch remote descriptions
            val descriptionsJson = fetchJson(AppConfig.DESCRIPTIONS_URL)
            descriptionsJson?.keys()?.forEach { id ->
                val obj = descriptionsJson.optJSONObject(id) ?: return@forEach
                val existing = byId[id] ?: VideoItem(id, titleFromId(id), "Streaming item", "Browse")
                byId[id] = existing.copy(
                    title = obj.optString("title", existing.title),
                    description = obj.optString("description", existing.description),
                    category = obj.optString("category", existing.category),
                    year = obj.optString("year", existing.year),
                    duration = obj.optString("duration", existing.duration),
                    maturity = obj.optString("maturity", existing.maturity)
                )
            }

            // Fetch MPD mapping
            val mappingJson = fetchJson(AppConfig.MPD_MAPPING_URL)
            mappingJson?.keys()?.forEach { id ->
                var mpdUrl = mappingJson.optString(id, "")
                if (mpdUrl.isNotEmpty()) {
                    // Prepend CDN_BASE if it's a relative path
                    if (!mpdUrl.startsWith("http")) {
                        mpdUrl = "${AppConfig.CDN_BASE}$mpdUrl"
                    }
                    
                    val existing = byId[id] ?: VideoItem(id, titleFromId(id), "Streaming item", "Browse")
                    byId[id] = existing.copy(mpdUrl = mpdUrl)
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("CatalogRepo", "Remote fetch failed, using defaults: ${e.message}")
        }

        // Record fetch time for observability
        OTTMetrics.onFetchTime(System.currentTimeMillis() - start)

        byId.values.toList()
    }

    // ── Key store (matches webapp getKeyStore() / getClearKey()) ──

    suspend fun getClearKey(videoId: String): Pair<String, String>? = withContext(Dispatchers.IO) {
        try {
            val json = fetchJson(AppConfig.KEYS_URL) ?: return@withContext null
            val videoData = if (json.has(videoId)) json.getJSONObject(videoId) else null
                ?: return@withContext null
            val keyId = videoData.optString("key_id", "")
            val key = videoData.optString("key", "")
            if (keyId.isEmpty() || key.isEmpty()) null else Pair(keyId, key)
        } catch (_: Exception) {
            null
        }
    }

    // ── Helpers ───────────────────────────────────────────────────

    private fun fetchJson(url: String): JSONObject? {
        val request = Request.Builder()
            .url("$url?t=${System.currentTimeMillis()}")
            .build()
        return client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val body = response.body?.string() ?: return null
            JSONObject(body)
        }
    }

    private fun titleFromId(id: String): String =
        id.replace("_", " ").split(" ").joinToString(" ") { w ->
            w.replaceFirstChar { it.uppercaseChar() }
        }
}
