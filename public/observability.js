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

  const vitals = {
    LCP: 0,
    FID: 0,
    CLS: 0,
    TTFB: 0,
    FCP: 0
  };

  // Initialize Web Vitals tracking
  try {
    const po = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (entry.entryType === 'largest-contentful-paint') vitals.LCP = entry.startTime;
        if (entry.entryType === 'first-input') vitals.FID = entry.processingStart - entry.startTime;
        if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) vitals.CLS += entry.value;
        if (entry.entryType === 'paint' && entry.name === 'first-contentful-paint') vitals.FCP = entry.startTime;
      }
    });
    po.observe({ type: 'largest-contentful-paint', buffered: true });
    po.observe({ type: 'first-input', buffered: true });
    po.observe({ type: 'layout-shift', buffered: true });
    po.observe({ type: 'paint', buffered: true });
    
    // TTFB
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) vitals.TTFB = nav.responseStart - nav.requestStart;
  } catch (e) {
    console.warn("[OBS] Vitals tracking not supported", e);
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
        network_type:         session.networkType,
        // Include Vitals in heartbeat
        vitals_lcp: vitals.LCP,
        vitals_fid: vitals.FID,
        vitals_cls: vitals.CLS,
        vitals_ttfb: vitals.TTFB,
        vitals_fcp: vitals.FCP
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

  // Also push vitals on page load completion
  window.addEventListener('load', () => {
    setTimeout(async () => {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) vitals.TTFB = nav.responseStart - nav.requestStart;
      
      await pushMetrics({
        type: 'web_vitals',
        data: {
          lcp: vitals.LCP,
          fid: vitals.FID,
          cls: vitals.CLS,
          ttfb: vitals.TTFB,
          fcp: vitals.FCP,
          device_type: detectDeviceType(),
          network_type: detectNetworkType(),
          url: window.location.pathname
        }
      });
    }, 2000);
  });

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

  // Inject Vercel Analytics & Speed Insights using the package logic
  (async () => {
    try {
      // Use ESM imports to get the package behavior in a static site
      const { inject } = await import('https://esm.sh/@vercel/analytics');
      const { injectSpeedInsights } = await import('https://esm.sh/@vercel/speed-insights');
      
      inject();
      injectSpeedInsights();
      
      console.info("[OBS] Vercel Analytics & Speed Insights initialized via package.");
    } catch (e) {
      console.warn("[OBS] Vercel package injection failed, falling back to script tags.", e);
    }
  })();

  window.OTT_OBS = obs;
  console.info("[OBS] Observability module loaded.");
})();
