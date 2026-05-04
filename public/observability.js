/**
 * observability.js
 * ─────────────────────────────────────────────────────────────
 * Client-side QoE metrics collection and push to Vercel API.
 */

(() => {
  "use strict";

  const config = window.OTT_CONFIG || {};
  const PUSH_MS = 60_000;

  function detectDeviceType() {
    const ua = navigator.userAgent || "";
    if (/TV|SmartTV|HbbTV|Tizen|WebOS/i.test(ua)) return "tv";
    if (/Mobi|Android|iPhone|iPad/i.test(ua))      return "mobile";
    return "desktop";
  }

  function detectNetworkType() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return "unknown";
    const ect = conn.effectiveType || "";
    if (ect === "4g") {
      if (conn.downlink && conn.downlink > 20) return "5g";
      return "4g";
    }
    if (ect === "wifi" || conn.type === "wifi") return "wifi";
    return ect || "unknown";
  }

  let session = null;
  let pushTimer = null;

  function newSession() {
    return {
      sessionId: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      startTime: Date.now(),
      playClickTime: null,
      firstFrameTime: null,
      bufferingStartTime: null,
      bufferingTotalMs: 0,
      rebufferCount: 0,
      bitrateSamples: [],
      droppedFrames: 0,
      errors: 0,
      playTimeStartMs: null,
      playTimeTotalMs: 0,
      estimatedBandwidthBps: 0,
      deviceType: detectDeviceType(),
      networkType: detectNetworkType()
    };
  }

  function computeMetrics() {
    if (!session) return null;

    const now = Date.now();
    if (session.playTimeStartMs !== null) {
      session.playTimeTotalMs += now - session.playTimeStartMs;
      session.playTimeStartMs = now;
    }

    const playTimeSec = session.playTimeTotalMs / 1000;
    const startupSec  = (session.firstFrameTime && session.playClickTime)
      ? (session.firstFrameTime - session.playClickTime) / 1000
      : 0;
    const rebufRatio  = playTimeSec > 0
      ? session.bufferingTotalMs / (session.playTimeTotalMs || 1)
      : 0;
    const avgBitrate  = session.bitrateSamples.length
      ? session.bitrateSamples.reduce((a, b) => a + b, 0) / session.bitrateSamples.length / 1000
      : 0;
    const errorRate   = session.errors > 0 ? 1 : 0;
    const bandwidth   = session.estimatedBandwidthBps / 1000; // kbps

    return {
      type: 'qoe_update',
      data: {
        startup_time_seconds: startupSec,
        rebuffer_ratio:       Math.min(rebufRatio, 1),
        avg_bitrate_kbps:     avgBitrate,
        error_rate:           errorRate,
        avg_bandwidth_kbps:   bandwidth,
        dropped_frames:       session.droppedFrames,
        rebuffer_count:       session.rebufferCount,
        device_type:          session.deviceType,
        network_type:         session.networkType
      }
    };
  }

  async function pushMetrics(metrics) {
    if (!config.api?.metrics) return;

    try {
      await fetch(config.api.metrics, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metrics),
        keepalive: true
      });
    } catch (err) {
      console.warn("[OBS] Push error:", err);
    }
  }

  const obs = {
    async onPlayIntent() {
      if (session) await obs.onVideoEnd();
      session = newSession();
      session.playClickTime = Date.now();
      schedulePush();
    },

    onFirstFrame() {
      if (session && !session.firstFrameTime) {
        session.firstFrameTime = Date.now();
        session.playTimeStartMs = Date.now();
      }
    },

    onPlayResume() {
      if (session && session.playTimeStartMs === null) {
        session.playTimeStartMs = Date.now();
      }
    },

    onPlayPause() {
      if (session && session.playTimeStartMs !== null) {
        session.playTimeTotalMs += Date.now() - session.playTimeStartMs;
        session.playTimeStartMs = null;
      }
    },

    onBufferingStart() {
      if (!session) return;
      session.bufferingStartTime = Date.now();
    },

    onBufferingEnd() {
      if (!session || !session.bufferingStartTime) return;
      const elapsed = Date.now() - session.bufferingStartTime;
      session.bufferingTotalMs += elapsed;
      session.rebufferCount += 1;
      session.bufferingStartTime = null;
    },

    onBitrateChange(bitrateBps) {
      if (!session) return;
      session.bitrateSamples.push(bitrateBps);
      if (session.bitrateSamples.length > 200) session.bitrateSamples.shift();
    },

    onBandwidthEstimate(bps) {
      if (session) session.estimatedBandwidthBps = bps;
    },

    onError() {
      if (session) session.errors += 1;
    },

    onTimeUpdate(videoEl) {
      if (!session || !videoEl) return;
      const quality = videoEl.getVideoPlaybackQuality ? videoEl.getVideoPlaybackQuality() : null;
      if (quality) session.droppedFrames = quality.droppedVideoFrames || 0;
    },

    async onVideoEnd() {
      clearInterval(pushTimer);
      pushTimer = null;
      if (!session) return;
      obs.onPlayPause();
      const metrics = computeMetrics();
      session = null;
      if (metrics) await pushMetrics(metrics);
    },

    async flush() {
      const metrics = computeMetrics();
      if (metrics) await pushMetrics(metrics);
    }
  };

  function schedulePush() {
    clearInterval(pushTimer);
    pushTimer = setInterval(() => obs.flush(), PUSH_MS);
  }

  window.OTT_OBS = obs;
  console.info("[OBS] Observability module loaded.");
})();
