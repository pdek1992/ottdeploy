/**
 * observability.js
 * ─────────────────────────────────────────────────────────────
 * Client-side QoE metrics collection and push to Grafana Cloud.
 *
 * Design principles:
 *  - Aggregates locally; never sends raw per-event data
 *  - Pushes every 30 s OR on video end
 *  - Low-cardinality labels only: region, device_type, network_type
 *  - Uses Influx Line Protocol for robust browser-to-Grafana pushing.
 *
 * Integration: loaded AFTER observability_config.js and shaka-player.
 */

(() => {
  "use strict";

  /* ── production config (encrypted) ───────────────────────── */
  const PASSPHRASE = "VIGIL_SIDDHI_PROD_2026";
  const CONFIG_URL = "keys/observability.json";

  // Relative path handled by proxy if available
  const CORS_PROXY_URL = "/metrics-proxy"; 

  let CFG = {};
  let PROM_URL = "";
  let PROM_USER = "";
  let PROM_API_KEY = "";
  let PUSH_MS = 30_000;
  let REGION = "IN";

  async function initConfig() {
    try {
      const response = await fetch(CONFIG_URL + "?_=" + Date.now());
      if (!response.ok) throw new Error("Failed to fetch observability config");
      const blob = await response.json();
      
      // Internal decryption helper to avoid race conditions with app.js
      const internalDecrypt = async (raw) => {
        if (!raw || !raw.encrypted) return raw;
        try {
          const iv = decodeFlexibleBytes(raw.iv || raw.nonce);
          const ciphertext = decodeFlexibleBytes(raw.ciphertext || raw.data || raw.payload);
          const passphrase = PASSPHRASE || (window.OTT_SECRETS && window.OTT_SECRETS.fixedKeyPassphrase) || "VIGIL_SIDDHI_PROD_2026";
          
          const source = new TextEncoder().encode(passphrase);
          const digest = await crypto.subtle.digest("SHA-256", source);
          const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
          
          const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
          const text = new TextDecoder().decode(decrypted);
          return JSON.parse(text);
        } catch (err) {
          console.error("[OBS] Decryption failed:", err);
          return null;
        }
      };

      CFG = await internalDecrypt(blob);
      if (CFG) {
        // Preference: Use direct URL if on localhost, otherwise try proxy
        const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
        PROM_URL     = (isLocal ? "" : CORS_PROXY_URL) || CFG.prometheusUrl || "";
        PROM_USER    = CFG.prometheusUser || "";
        PROM_API_KEY = CFG.prometheusApiKey || "";
        REGION       = CFG.region || "IN";
        console.info("[OBS] Secure configuration loaded.");
      }
    } catch (err) {
      console.warn("[OBS] Config load failed. Falling back to demo mode.", err);
    }
  }

  function decodeFlexibleBytes(val) {
    if (!val) return new Uint8Array(0);
    if (val instanceof Uint8Array) return val;
    if (typeof val === "string") {
      const binary = atob(val.replace(/-/g, "+").replace(/_/g, "/"));
      return Uint8Array.from(binary, c => c.charCodeAt(0));
    }
    return new Uint8Array(0);
  }

  /* ── helpers ───────────────────────────────────────────────── */
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

  /* ── session object ────────────────────────────────────────── */
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
      lastDroppedFrames: 0,
      errors: 0,
      playTimeStartMs: null,
      playTimeTotalMs: 0,
      estimatedBandwidthBps: 0,
      deviceType: detectDeviceType(),
      networkType: detectNetworkType()
    };
  }

  /* ── metric aggregation ────────────────────────────────────── */
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
      startup_time_seconds: startupSec,
      rebuffer_ratio:       Math.min(rebufRatio, 1),
      avg_bitrate_kbps:     avgBitrate,
      error_rate:           errorRate,
      avg_bandwidth_kbps:   bandwidth,
      dropped_frames:       session.droppedFrames,
      rebuffer_count:       session.rebufferCount,
      labels: {
        region:       REGION,
        device_type:  session.deviceType,
        network_type: session.networkType
      }
    };
  }

  /**
   * pushMetrics
   * ─────────────────────────────────────────────────────────────
   * Pushes the QoE record to Grafana Cloud.
   * 
   * NOTE: We use Influx Line Protocol because Grafana Cloud's
   * Influx endpoint handles text POSTs much better from browsers
   * than the Prometheus remote_write endpoint.
   */
  async function pushMetrics(metrics) {
    if (!PROM_URL || PROM_USER === "REPLACE_ME_GRAFANA_PROM_USER" || !PROM_API_KEY || PROM_API_KEY === "REPLACE_ME_GRAFANA_PROM_API_KEY") {
      console.debug("[OBS] Skipping push – credentials not configured.", metrics);
      persistQoEHistory(metrics);
      return;
    }

    const esc = (s) => (s || "").toString().replace(/ /g, "\\ ").replace(/,/g, "\\,");
    const appTag = esc(CFG.appName || "VigilSiddhi_OTT");
    const deviceType = esc(metrics.labels.device_type);
    const networkType = esc(metrics.labels.network_type);
    const region = esc(metrics.labels.region);

    const labels = `app=${appTag},region=${region},device_type=${deviceType},network_type=${networkType}`;
    const tsNs = Date.now() * 1000000;

    const lines = [
      `qoe_startup_time_seconds,${labels} value=${metrics.startup_time_seconds.toFixed(3)} ${tsNs}`,
      `qoe_rebuffer_ratio,${labels} value=${metrics.rebuffer_ratio.toFixed(4)} ${tsNs}`,
      `qoe_avg_bitrate_kbps,${labels} value=${Math.round(metrics.avg_bitrate_kbps)} ${tsNs}`,
      `qoe_avg_bandwidth_kbps,${labels} value=${Math.round(metrics.avg_bandwidth_kbps)} ${tsNs}`,
      `qoe_error_rate,${labels} value=${metrics.error_rate} ${tsNs}`,
      `qoe_dropped_frames,${labels} value=${metrics.dropped_frames} ${tsNs}`,
      `qoe_rebuffer_count,${labels} value=${metrics.rebuffer_count} ${tsNs}`,
      `qoe_active_sessions,${labels} value=1 ${tsNs}`
    ].join("\n");

    const basicAuth = btoa(`${PROM_USER}:${PROM_API_KEY}`);

    let targetUrl = PROM_URL;
    if (targetUrl.includes("/api/prom/push")) {
      targetUrl = targetUrl.replace("prometheus", "influx")
                           .replace("/api/prom/push", "/api/v1/push/influx/write");
    }

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "Authorization": `Basic ${basicAuth}`
        },
        body: lines,
        keepalive: true
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.warn("[OBS] Push failed:", response.status, body.slice(0, 200));
      } else {
        console.info(`[OBS] ${metrics.sessions || 1} session metrics pushed successfully.`);
        console.table({
          startup: metrics.startup_time_seconds.toFixed(2) + "s",
          bitrate: (metrics.avg_bitrate_kbps / 1000).toFixed(1) + " Mbps",
          rebuffer: (metrics.rebuffer_ratio * 100).toFixed(2) + "%",
          errors: metrics.error_rate
        });
      }
    } catch (err) {
      console.warn("[OBS] Push error:", err);
    }
    
    persistQoEHistory(metrics);
  }

  const LS_QOE_HISTORY = "ott-obs-qoe-history-v1";
  const MAX_LS_HISTORY = 20;

  function persistQoEHistory(metrics) {
    try {
      const stored = JSON.parse(localStorage.getItem(LS_QOE_HISTORY) || "[]");
      stored.push({ ts: Date.now(), ...metrics });
      if (stored.length > MAX_LS_HISTORY) stored.splice(0, stored.length - MAX_LS_HISTORY);
      localStorage.setItem(LS_QOE_HISTORY, JSON.stringify(stored));
    } catch (e) { }
  }

  /* ── public API ───────────────────────────────────────────── */
  const obs = {
    async onPlayIntent() {
      if (session) await obs.onVideoEnd();
      await initConfig();
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
