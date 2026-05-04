package com.ott.app

import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@UnstableApi
class PlayerActivity : ComponentActivity() {
    private var player: ExoPlayer? = null
    private var playerView: PlayerView? = null

    // Ad cue-point tracking (mirrors webapp state.adCuePoints / firedAds)
    private val adCuePoints = listOf(30, 90)
    private val firedAds = mutableSetOf<Int>()
    private var adPlaying = false

    // Observability — track play start for per-session metrics
    private var videoId = "unknown"
    private var mpdUrl: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Security: block screenshots
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        // Immersive mode is handled in onResume to catch rotation changes correctly
        playerView = PlayerView(this).apply {
            useController = true
            keepScreenOn = true
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
        }
        setContentView(playerView)

        videoId = intent.getStringExtra("VIDEO_ID") ?: run {
            Toast.makeText(this, "No video ID provided", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        mpdUrl = intent.getStringExtra("MPD_URL")
        val videoTitle = intent.getStringExtra("VIDEO_TITLE") ?: videoId

        // Start observability session
        OTTMetrics.init(applicationContext)
        OTTMetrics.onPlayIntent(videoId)

        loadAndStartPlayback()
    }

    private fun loadAndStartPlayback() {
        CoroutineScope(Dispatchers.IO).launch {
            val fetchStart = System.currentTimeMillis()
            try {
                // Fetch ClearKey DRM credentials (matches webapp getClearKey())
                val repo = CatalogRepository(applicationContext)
                val keyPair = repo.getClearKey(videoId)
                OTTMetrics.onFetchTime(System.currentTimeMillis() - fetchStart)

                withContext(Dispatchers.Main) {
                    initializePlayer(videoId, keyPair)
                }
            } catch (e: Exception) {
                OTTMetrics.onError()
                OTTMetrics.onFetchTime(System.currentTimeMillis() - fetchStart)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@PlayerActivity, "Could not load playback keys", Toast.LENGTH_LONG).show()
                    // Still try to play without DRM (for clear streams)
                    initializePlayer(videoId, null)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Fullscreen immersive
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).let { ctrl ->
            ctrl.hide(WindowInsetsCompat.Type.systemBars())
            ctrl.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun initializePlayer(videoId: String, keyPair: Pair<String, String>?) {
        // Use passed MPD_URL or fallback to local construction
        val dashUrl = mpdUrl?.takeIf { it.isNotEmpty() } 
            ?: "${AppConfig.CDN_BASE}$videoId/manifest.mpd"

        player = ExoPlayer.Builder(this).build().also { exo ->
            playerView?.player = exo

            // Build MediaItem — with or without DRM
            val mediaItem = if (keyPair != null) {
                val (keyIdHex, keyHex) = keyPair
                val clearKeyJson = buildClearKeyJson(keyIdHex, keyHex)
                val dataUri = "data:application/json;base64," +
                        android.util.Base64.encodeToString(clearKeyJson.toByteArray(), android.util.Base64.NO_WRAP)

                MediaItem.Builder()
                    .setUri(dashUrl)
                    .setDrmConfiguration(
                        MediaItem.DrmConfiguration.Builder(C.CLEARKEY_UUID)
                            .setLicenseUri(dataUri)
                            .build()
                    )
                    .build()
            } else {
                MediaItem.fromUri(dashUrl)
            }

            exo.setMediaItem(mediaItem)
            exo.prepare()
            exo.playWhenReady = true

            // ── Player event listeners ─────────────────────────────────────
            exo.addListener(object : Player.Listener {

                override fun onPlaybackStateChanged(state: Int) {
                    when (state) {
                        Player.STATE_BUFFERING -> OTTMetrics.onBufferingStart()
                        Player.STATE_READY -> {
                            OTTMetrics.onFirstFrame()
                            OTTMetrics.onBufferingEnd()
                        }
                        Player.STATE_ENDED -> {
                            OTTMetrics.onVideoEnd()
                        }
                        else -> {}
                    }
                }

                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    if (isPlaying) OTTMetrics.onPlayResume()
                    else OTTMetrics.onPlayPause()
                }

                override fun onPlayerError(error: PlaybackException) {
                    OTTMetrics.onError()
                    // If DRM failed, try playing without DRM as fallback
                    if (error.errorCode == PlaybackException.ERROR_CODE_DRM_CONTENT_ERROR ||
                        error.errorCode == PlaybackException.ERROR_CODE_DRM_LICENSE_ACQUISITION_FAILED) {
                        Toast.makeText(this@PlayerActivity, "DRM Failed, trying clear fallback...", Toast.LENGTH_SHORT).show()
                        val clearItem = MediaItem.fromUri(dashUrl)
                        exo.setMediaItem(clearItem)
                        exo.prepare()
                    } else {
                        Toast.makeText(this@PlayerActivity,
                            "Playback error: ${error.errorCodeName}", Toast.LENGTH_LONG).show()
                    }
                }

                override fun onMetadata(metadata: androidx.media3.common.Metadata) {
                    for (i in 0 until metadata.length()) {
                        val entry = metadata.get(i)
                        val desc = entry.toString().lowercase()
                        if (desc.contains("scte") || desc.contains("splice")) {
                            handleAdBreak("SCTE-35 splice event detected")
                        }
                    }
                }
            })

            startMetricsPoll(exo)
        }
    }

    private fun startMetricsPoll(exo: ExoPlayer) {
        CoroutineScope(Dispatchers.Main).launch {
            while (player != null) {
                kotlinx.coroutines.delay(5_000)

                // Bitrate from current track
                val tracks = exo.currentTracks
                for (group in tracks.groups) {
                    if (group.isSelected) {
                        for (i in 0 until group.length) {
                            if (group.isTrackSelected(i)) {
                                val format = group.getTrackFormat(i)
                                if (format.bitrate > 0) {
                                    OTTMetrics.onBitrateChange(format.bitrate.toLong())
                                }
                            }
                        }
                    }
                }

                val currentSec = (exo.currentPosition / 1000).toInt()
                if (!adPlaying) {
                    for (cue in adCuePoints) {
                        if (currentSec >= cue && !firedAds.contains(cue)) {
                            firedAds.add(cue)
                            handleAdBreak("Cue point at ${cue}s")
                        }
                    }
                }
            }
        }
    }

    private fun handleAdBreak(reason: String) {
        if (adPlaying) return
        adPlaying = true
        player?.pause()
        Toast.makeText(this, "Ad Break (${reason})", Toast.LENGTH_SHORT).show()

        CoroutineScope(Dispatchers.Main).launch {
            kotlinx.coroutines.delay(5_000)
            adPlaying = false
            player?.play()
        }
    }

    private fun buildClearKeyJson(keyIdHex: String, keyHex: String): String {
        val kBase64 = base64UrlEncode(keyHex)
        val kidBase64 = base64UrlEncode(keyIdHex)
        // Standard ClearKey JSON response format
        return """{"keys":[{"kty":"oct","k":"$kBase64","kid":"$kidBase64"}]}"""
    }

    private fun hexStringToByteArray(s: String): ByteArray {
        val len = s.length
        val data = ByteArray(len / 2)
        for (i in 0 until len step 2) {
            val h = s.substring(i, i + 2)
            data[i / 2] = h.toInt(16).toByte()
        }
        return data
    }

    private fun base64UrlEncode(hex: String): String =
        android.util.Base64.encodeToString(
            hexStringToByteArray(hex),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP
        )

    override fun onStop() {
        super.onStop()
        OTTMetrics.flush()
        player?.pause()
    }

    override fun onDestroy() {
        super.onDestroy()
        OTTMetrics.onVideoEnd()
        player?.release()
        player = null
    }
}
