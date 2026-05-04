package com.ott.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.telephony.TelephonyManager
import androidx.annotation.RequiresApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.Credentials
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.Locale
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * OTTMetrics — Android observability module.
 *
 * Mirrors the JS observability.js behaviour exactly:
 *  - Aggregates all events locally into a session
 *  - Pushes every 60 seconds OR on session end
 *  - Uses Influx Line Protocol → Grafana Cloud Prometheus remote_write
 *  - Low-cardinality labels: region, device_type, network_type, manufacturer, platform
 *
 * Android-additional metrics (not in web):
 *  - android_fetch_time_ms  — manifest + key fetch latency
 *  - android_user_logged_in — 1 if session active
 */
object OTTMetrics {

    private var appContext: Context? = null
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    // ── Session state ────────────────────────────────────────────
    private var sessionId: String = newId()
    private var playClickTimeMs: Long = 0L
    private var firstFrameTimeMs: Long = 0L
    private var bufferingStartMs: Long = 0L
    private var bufferingTotalMs: Long = 0L
    private var rebufferCount: Int = 0
    private var bitrateSamples: MutableList<Long> = mutableListOf()
    private var droppedFrames: Long = 0L
    private var errorCount: Int = 0
    private var playStartMs: Long = 0L
    private var playTotalMs: Long = 0L
    private var estimatedBandwidthBps: Long = 0L
    private var fetchTimeMs: Long = 0L
    private var isPlaying: Boolean = false
    private var isUserLoggedIn: Boolean = false
    private var videoId: String = "unknown"

    private var pushJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO)

    // ── Initialise ───────────────────────────────────────────────
    fun init(context: Context) {
        appContext = context.applicationContext
    }

    fun setUserLoggedIn(loggedIn: Boolean) {
        isUserLoggedIn = loggedIn
    }

    // ── Session lifecycle (mirrors observability.js public API) ──

    fun onPlayIntent(vid: String) {
        if (isPlaying) onVideoEnd()
        resetSession()
        videoId = vid
        playClickTimeMs = System.currentTimeMillis()
        isPlaying = true
        startPeriodicPush()
    }

    fun onFirstFrame() {
        if (firstFrameTimeMs == 0L) {
            firstFrameTimeMs = System.currentTimeMillis()
            playStartMs = firstFrameTimeMs
        }
    }

    fun onPlayResume() {
        if (playStartMs == 0L) playStartMs = System.currentTimeMillis()
    }

    fun onPlayPause() {
        if (playStartMs > 0L) {
            playTotalMs += System.currentTimeMillis() - playStartMs
            playStartMs = 0L
        }
    }

    fun onBufferingStart() {
        bufferingStartMs = System.currentTimeMillis()
    }

    fun onBufferingEnd() {
        if (bufferingStartMs > 0L) {
            bufferingTotalMs += System.currentTimeMillis() - bufferingStartMs
            rebufferCount++
            bufferingStartMs = 0L
        }
    }

    fun onBitrateChange(bps: Long) {
        bitrateSamples.add(bps)
        if (bitrateSamples.size > 200) bitrateSamples.removeAt(0)
    }

    fun onBandwidthEstimate(bps: Long) {
        estimatedBandwidthBps = bps
    }

    fun onDroppedFrames(count: Long) {
        droppedFrames = count
    }

    fun onError() {
        errorCount++
    }

    fun onFetchTime(ms: Long) {
        fetchTimeMs = ms
    }

    fun onVideoEnd() {
        onPlayPause()
        stopPeriodicPush()
        pushMetrics()
        resetSession()
        isPlaying = false
    }

    fun flush() {
        pushMetrics()
    }

    // ── Internal helpers ─────────────────────────────────────────

    private fun resetSession() {
        sessionId = newId()
        playClickTimeMs = 0L
        firstFrameTimeMs = 0L
        bufferingStartMs = 0L
        bufferingTotalMs = 0L
        rebufferCount = 0
        bitrateSamples.clear()
        droppedFrames = 0L
        errorCount = 0
        playStartMs = 0L
        playTotalMs = 0L
        estimatedBandwidthBps = 0L
        fetchTimeMs = 0L
    }

    private fun startPeriodicPush() {
        stopPeriodicPush()
        pushJob = scope.launch {
            while (true) {
                delay(AppConfig.PUSH_INTERVAL_MS)
                pushMetrics()
            }
        }
    }

    private fun stopPeriodicPush() {
        pushJob?.cancel()
        pushJob = null
    }

    // ── Aggregation state for per-minute intervals ────────────────
    private var lastBitrateAvg: Double = 0.0
    private var lastBandwidthAvg: Double = 0.0
    private var lastRebufferRatio: Double = 0.0
    private var intervalBufferingMs: Long = 0L
    private var intervalPlayTimeMs: Long = 0L
    private var lastPushTimeMs: Long = System.currentTimeMillis()

    private fun computeMetrics(): Map<String, Double> {
        val now = System.currentTimeMillis()
        val intervalMs = now - lastPushTimeMs
        
        // Update current play time if playing
        if (playStartMs > 0L) {
            val deltaPlay = now - playStartMs
            playTotalMs += deltaPlay
            intervalPlayTimeMs += deltaPlay
            playStartMs = now
        }

        // Update current buffering if buffering
        if (bufferingStartMs > 0L) {
            val deltaBuf = now - bufferingStartMs
            bufferingTotalMs += deltaBuf
            intervalBufferingMs += deltaBuf
            bufferingStartMs = now
        }

        // 1. Session-level (Total)
        val startupSec = if (firstFrameTimeMs > 0L && playClickTimeMs > 0L)
            (firstFrameTimeMs - playClickTimeMs) / 1000.0 else 0.0

        // 2. Interval-level (Per Minute)
        val intervalRebufRatio = if (intervalPlayTimeMs > 0L)
            intervalBufferingMs.toDouble() / intervalPlayTimeMs.toDouble() else 0.0
        
        val intervalAvgBitrate = if (bitrateSamples.isNotEmpty())
            bitrateSamples.average() / 1000.0 else 0.0
        
        val bandwidth = estimatedBandwidthBps / 1000.0

        // Store interval results for logging/return
        lastBitrateAvg = intervalAvgBitrate
        lastBandwidthAvg = bandwidth
        lastRebufferRatio = intervalRebufRatio.coerceAtMost(1.0)

        val results = mapOf(
            "startup_time_seconds" to startupSec,
            "rebuffer_ratio" to lastRebufferRatio,
            "avg_bitrate_kbps" to lastBitrateAvg,
            "avg_bandwidth_kbps" to lastBandwidthAvg,
            "error_rate" to (if (errorCount > 0) 1.0 else 0.0),
            "dropped_frames" to droppedFrames.toDouble(),
            "rebuffer_count" to rebufferCount.toDouble(),
            "fetch_time_ms" to fetchTimeMs.toDouble(),
            "user_logged_in" to (if (isUserLoggedIn) 1.0 else 0.0)
        )

        // RESET interval counters after computation
        intervalBufferingMs = 0L
        intervalPlayTimeMs = 0L
        bitrateSamples.clear()
        lastPushTimeMs = now
        
        return results
    }

    private fun pushMetrics() {
        val ctx = appContext ?: return
        val metrics = computeMetrics()

        val networkType = detectNetworkType(ctx)
        val manufacturer = Build.MANUFACTURER.lowercase(Locale.ROOT)
        val osVersion = "android_${Build.VERSION.SDK_INT}"
        val region = AppConfig.REGION

        // Escape label values (Influx Line Protocol)
        fun esc(s: String) = s.replace(" ", "\\ ").replace(",", "\\,").replace("=", "\\=")

        val appTag = esc(AppConfig.APP_NAME)
        val labels = "app=${esc(appTag)},region=${esc(region)},device_type=mobile," +
                "network_type=${esc(networkType)},manufacturer=${esc(manufacturer)}," +
                "os=${esc(osVersion)},platform=android"

        val tsNs = System.currentTimeMillis() * 1_000_000L

        val lines = buildString {
            appendLine("qoe_startup_time_seconds,$labels value=${metrics["startup_time_seconds"]!!.fmt(3)} $tsNs")
            appendLine("qoe_rebuffer_ratio,$labels value=${metrics["rebuffer_ratio"]!!.fmt(4)} $tsNs")
            appendLine("qoe_avg_bitrate_kbps,$labels value=${metrics["avg_bitrate_kbps"]!!.toLong()} $tsNs")
            appendLine("qoe_avg_bandwidth_kbps,$labels value=${metrics["avg_bandwidth_kbps"]!!.toLong()} $tsNs")
            appendLine("qoe_error_rate,$labels value=${metrics["error_rate"]!!.fmt(1)} $tsNs")
            appendLine("qoe_dropped_frames,$labels value=${metrics["dropped_frames"]!!.toLong()} $tsNs")
            appendLine("qoe_rebuffer_count,$labels value=${metrics["rebuffer_count"]!!.toLong()} $tsNs")
            appendLine("qoe_active_sessions,$labels value=${if (isPlaying) 1 else 0} $tsNs")
            appendLine("android_fetch_time_ms,$labels value=${metrics["fetch_time_ms"]!!.toLong()} $tsNs")
            appendLine("android_user_logged_in,$labels value=${metrics["user_logged_in"]!!.toInt()} $tsNs")
        }.trimEnd()

        val credential = Credentials.basic(AppConfig.PROMETHEUS_USER, AppConfig.PROMETHEUS_API_KEY)

        // Use the Influx line protocol endpoint for easier browser-alike push
        val influxUrl = AppConfig.PROMETHEUS_INFLUX_URL

        scope.launch {
            try {
                val request = Request.Builder()
                    .url(influxUrl)
                    .addHeader("Authorization", credential)
                    .addHeader("Content-Type", "text/plain")
                    .post(lines.toRequestBody("text/plain".toMediaType()))
                    .build()

                val response = httpClient.newCall(request).execute()
                if (response.isSuccessful) {
                    android.util.Log.i("OTTMetrics", "[OBS] Metrics pushed OK – ${lines.lines().size} series")
                } else {
                    val body = response.body?.string()?.take(200) ?: ""
                    android.util.Log.w("OTTMetrics", "[OBS] Push failed ${response.code}: $body")
                    // Fallback to Prometheus remote_write endpoint
                    pushViaRemoteWrite(lines, credential)
                }
                response.close()
            } catch (e: Exception) {
                android.util.Log.w("OTTMetrics", "[OBS] Push exception: ${e.message}")
            }
        }
    }

    private fun pushViaRemoteWrite(influxLines: String, credential: String) {
        // Convert influx lines to simple Prometheus text format and try the push endpoint
        // This is a best-effort fallback
        try {
            val tsNs = System.currentTimeMillis() * 1_000_000L
            val request = Request.Builder()
                .url(AppConfig.PROMETHEUS_URL)
                .addHeader("Authorization", credential)
                .addHeader("Content-Type", "text/plain")
                .post(influxLines.toRequestBody("text/plain".toMediaType()))
                .build()
            httpClient.newCall(request).execute().close()
        } catch (_: Exception) {}
    }

    // ── Network detection ────────────────────────────────────────

    fun detectNetworkType(context: Context): String {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = cm.activeNetwork ?: return "unknown"
            val caps = cm.getNetworkCapabilities(network) ?: return "unknown"
            return when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> detectCellularType(context)
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                else -> "unknown"
            }
        }
        @Suppress("DEPRECATION")
        val netInfo = cm.activeNetworkInfo ?: return "unknown"
        return if (netInfo.type == ConnectivityManager.TYPE_WIFI) "wifi" else "cellular"
    }

    private fun detectCellularType(context: Context): String {
        val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            ?: return "4g"
        return try {
            when (tm.dataNetworkType) {
                TelephonyManager.NETWORK_TYPE_NR -> "5g"
                TelephonyManager.NETWORK_TYPE_LTE -> "4g"
                TelephonyManager.NETWORK_TYPE_HSPAP,
                TelephonyManager.NETWORK_TYPE_HSDPA,
                TelephonyManager.NETWORK_TYPE_HSPA -> "3g"
                TelephonyManager.NETWORK_TYPE_EDGE,
                TelephonyManager.NETWORK_TYPE_GPRS -> "2g"
                else -> "4g"
            }
        } catch (_: SecurityException) {
            "4g"
        }
    }

    fun isOnline(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
            return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        }
        @Suppress("DEPRECATION")
        return cm.activeNetworkInfo?.isConnected == true
    }

    // ── Util ─────────────────────────────────────────────────────

    private fun newId() = UUID.randomUUID().toString().take(8)
    private fun Double.fmt(decimals: Int) = "%.${decimals}f".format(this)
    private fun Double.toInt() = this.toInt()
}
