/**
 * dashboard.js
 * ─────────────────────────────────────────────────────────────
 * OTT Observability Dashboard – client-side data engine.
 *
 * Data sources:
 *  1. window.OTT_OBS   – live session metrics (if player is open in same tab)
 *  2. localStorage     – persisted metrics pushed by observability.js
 *  3. Simulated CDN    – until real Cloudflare data arrives via GitHub Actions
 *
 * All charts built with Chart.js 4.
 */

(() => {
  "use strict";

  const CFG = window.OTT_OBSERVABILITY || {};

  // ── Storage keys (shared with observability.js) ─────────────
  const LS_QOE_HISTORY = "ott_qoe_history";
  const LS_CDN_HISTORY = "ott_cdn_history";
  const MAX_HISTORY = 20;

  // ── DOM refs ────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  // ── Design tokens (match styles.css vars) ──────────────────
  const C = {
    accent: "#27d7ff",
    strong: "#72f0ff",
    amber: "#ffb347",
    green: "#7dffbf",
    red: "#ff5f7a",
    purple: "#c490ff",
    muted: "rgba(157,177,195,0.7)",
    grid: "rgba(157,230,255,0.1)",
    text: "#f5fbff"
  };

  const CHART_DEFAULTS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: true } },
    scales: {
      x: { display: false },
      y: { display: false }
    }
  };

  // ── State ───────────────────────────────────────────────────
  let qoeHistory = [];   // array of aggregated QoE objects
  let cdnHistory = [];   // array of CDN objects
  let charts = {};   // Chart.js instances
  let dummyInterval = null;

  /* ── boot ─────────────────────────────────────────────────── */
  window.addEventListener("DOMContentLoaded", () => {
    initGrafanaLink();
    buildCharts();
    startPolling();

    const dataToggle = $("dataToggle");

    // Initial load
    if (dataToggle && dataToggle.checked) {
      loadFromStorage();
      renderAll();
      if ($("nativeDataSection")) $("nativeDataSection").style.display = "block";
      if ($("realDataSection")) $("realDataSection").style.display = "none";
    } else {
      loadFromStorage();
      renderAll();
      if ($("nativeDataSection")) $("nativeDataSection").style.display = "none";
      if ($("realDataSection")) $("realDataSection").style.display = "block";
    }

    if ($("refreshDash")) {
      $("refreshDash").addEventListener("click", () => {
        loadFromStorage();
        renderAll();
        toast("Dashboard refreshed");
      });
    }

    if (dataToggle) {
      const toggleLabel = $("dataToggleLabel");
      if (toggleLabel) {
        toggleLabel.textContent = dataToggle.checked ? "Local Metrics" : "Grafana View";
      }

      dataToggle.addEventListener("change", (e) => {
        if (e.target.checked) {
          if ($("nativeDataSection")) $("nativeDataSection").style.display = "block";
          if ($("realDataSection")) $("realDataSection").style.display = "none";
          if (toggleLabel) toggleLabel.textContent = "Local Metrics";
          loadFromStorage();
          renderAll();
          toast("Showing local UI");
        } else {
          if ($("nativeDataSection")) $("nativeDataSection").style.display = "none";
          if ($("realDataSection")) $("realDataSection").style.display = "block";
          if (toggleLabel) toggleLabel.textContent = "Grafana View";
          toast("Showing Grafana iframe");
        }
      });
    }
  });

  /* ── Grafana link ─────────────────────────────────────────── */
  function initGrafanaLink() {
    const url = "https://grafana-proxy.pdekprof.workers.dev/public-dashboards/8d0dcd9a078a4737a2ba032a40b54e3a";
    const el = $("grafanaLink");
    if (el) el.href = url;
  }

  /* ── Storage helpers ──────────────────────────────────────── */
  function loadFromStorage() {
    qoeHistory = safeJson(LS_QOE_HISTORY) || [];
    cdnHistory = safeJson(LS_CDN_HISTORY) || [];

    // If local storage is empty, try to fetch global aggregated data from Grafana
    if (qoeHistory.length === 0 || cdnHistory.length === 0) {
      fetchGlobalMetrics();
    }
  }



  function safeJson(key) {
    try { return JSON.parse(localStorage.getItem(key)); }
    catch { return null; }
  }

  /* ── Chart initialization ─────────────────────────────────── */
  function buildCharts() {
    const createChart = (id, config) => {
      const el = $(id);
      if (!el) return null;
      try { return new Chart(el, config); }
      catch (e) { console.warn(`[DASH] Failed to init chart ${id}`, e); return null; }
    };

    // QoE time series
    charts.qoe = createChart("qoeTimeSeries", {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Startup (s)", data: [], borderColor: C.accent, tension: 0.4, pointRadius: 2, fill: false, borderWidth: 2 },
          { label: "Rebuffer %", data: [], borderColor: C.amber, tension: 0.4, pointRadius: 2, fill: false, borderWidth: 2 },
          { label: "Bitrate ÷ 100", data: [], borderColor: C.green, tension: 0.4, pointRadius: 2, fill: false, borderWidth: 2 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: C.text, boxWidth: 12 } },
          tooltip: { enabled: true }
        },
        scales: {
          x: { ticks: { color: C.muted, maxRotation: 0 }, grid: { color: C.grid } },
          y: { ticks: { color: C.muted }, grid: { color: C.grid } }
        }
      }
    });

    // CDN time series
    charts.cdn = createChart("cdnTimeSeries", {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Cache Hit %", data: [], borderColor: C.green, tension: 0.4, pointRadius: 2, fill: false, borderWidth: 2 },
          { label: "Error Rate %", data: [], borderColor: C.red, tension: 0.4, pointRadius: 2, fill: false, borderWidth: 2 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: C.text, boxWidth: 12 } },
          tooltip: { enabled: true }
        },
        scales: {
          x: { ticks: { color: C.muted, maxRotation: 0 }, grid: { color: C.grid } },
          y: { ticks: { color: C.muted }, grid: { color: C.grid } }
        }
      }
    });

    // Device pie
    charts.device = createChart("devicePie", {
      type: "doughnut",
      data: {
        labels: ["Mobile", "Desktop", "TV"],
        datasets: [{ data: [0, 0, 0], backgroundColor: [C.accent, C.green, C.amber], borderWidth: 0 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { color: C.text, boxWidth: 12 } } }
      }
    });

    // Network pie
    charts.network = createChart("networkPie", {
      type: "doughnut",
      data: {
        labels: ["WiFi", "4G", "5G", "Unknown"],
        datasets: [{ data: [0, 0, 0, 0], backgroundColor: [C.accent, C.green, C.purple, C.muted], borderWidth: 0 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { color: C.text, boxWidth: 12 } } }
      }
    });

    // Correlation: rebuffer vs cache hit
    charts.corrRC = createChart("corrRebufferCache", {
      type: "scatter",
      data: {
        datasets: [{
          label: "Session",
          data: [],
          backgroundColor: C.accent + "88",
          pointRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `Rebuf: ${(ctx.parsed.y * 100).toFixed(2)}%, Cache: ${(ctx.parsed.x * 100).toFixed(1)}%`
            }
          }
        },
        scales: {
          x: { title: { display: true, text: "Cache Hit Ratio", color: C.muted }, ticks: { color: C.muted }, grid: { color: C.grid } },
          y: { title: { display: true, text: "Rebuffer Ratio", color: C.muted }, ticks: { color: C.muted }, grid: { color: C.grid } }
        }
      }
    });

    // Correlation: bitrate vs bandwidth
    charts.corrBB = createChart("corrBitrateBandwidth", {
      type: "scatter",
      data: {
        datasets: [{
          label: "Session",
          data: [],
          backgroundColor: C.green + "88",
          pointRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: "Bandwidth kbps", color: C.muted }, ticks: { color: C.muted }, grid: { color: C.grid } },
          y: { title: { display: true, text: "Bitrate kbps", color: C.muted }, ticks: { color: C.muted }, grid: { color: C.grid } }
        }
      }
    });

    // Sparklines (tiny, no axes)
    const sparkIds = ["sparkStartup", "sparkRebuffer", "sparkBitrate", "sparkError", "sparkBandwidth", "sparkDropped", "sparkCacheHit", "sparkCdnRequests", "sparkCdnBandwidth", "sparkCdnError"];
    const sparkColors = [C.accent, C.amber, C.green, C.red, C.accent, C.purple, C.green, C.accent, C.accent, C.red];
    sparkIds.forEach((id, i) => {
      charts[id] = createChart(id, {
        type: "line",
        data: { labels: [], datasets: [{ data: [], borderColor: sparkColors[i], fill: false, borderWidth: 1.5, pointRadius: 0, tension: 0.4 }] },
        options: { ...CHART_DEFAULTS, animation: false }
      });
    });
  }

  /* ── Render helpers ───────────────────────────────────────── */
  function avg(arr, key) {
    if (!arr.length) return 0;
    return arr.reduce((s, r) => s + (r[key] || 0), 0) / arr.length;
  }

  function last(arr) { return arr[arr.length - 1] || null; }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function fmtBytes(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
    if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + " kB";
    return bytes + " B";
  }

  function setKpi(id, value, sub) {
    const el = $(id);
    if (el) el.textContent = value;
    if (sub) { const s = $(sub.id); if (s) s.textContent = sub.text; }
  }

  function setKpiState(cardId, state) {
    const card = $(cardId);
    if (!card) return;
    card.classList.remove("kpi-ok", "kpi-warn", "kpi-crit");
    if (state) card.classList.add(state);
  }

  function updateSparkline(chartId, values) {
    const c = charts[chartId];
    if (!c) return;
    c.data.labels = values.map((_, i) => i);
    c.data.datasets[0].data = values;
    c.update("none");
  }

  /* ── Main render ──────────────────────────────────────────── */
  function renderAll() {
    renderQoE();
    renderCDN();
    renderCorrelations();
    renderAlerts();
    renderLiveStatus();
    const tsEl = $("footerTs");
    if (tsEl) tsEl.textContent = "Last updated: " + new Date().toLocaleTimeString();
  }

  function renderQoE() {
    if (!qoeHistory.length) return;

    const avgStartup = avg(qoeHistory, "startup_time_seconds");
    const avgRebuf = avg(qoeHistory, "rebuffer_ratio");
    const avgBitrate = avg(qoeHistory, "avg_bitrate_kbps");
    const avgError = avg(qoeHistory, "error_rate");
    const avgBandwidth = avg(qoeHistory, "avg_bandwidth_kbps");
    const avgDropped = avg(qoeHistory, "dropped_frames");

    // KPI values
    setKpi("valStartup", avgStartup.toFixed(2) + " s");
    setKpi("valRebuffer", (avgRebuf * 100).toFixed(2) + " %");
    setKpi("valBitrate", Math.round(avgBitrate) + " kbps");
    setKpi("valError", (avgError * 100).toFixed(1) + " %");
    setKpi("valBandwidth", Math.round(avgBandwidth) + " kbps");
    setKpi("valDropped", Math.round(avgDropped));

    // KPI state
    setKpiState("kpiStartup", avgStartup > 3 ? "kpi-crit" : avgStartup > 2 ? "kpi-warn" : "kpi-ok");
    setKpiState("kpiRebuffer", avgRebuf > 0.03 ? "kpi-crit" : avgRebuf > 0.015 ? "kpi-warn" : "kpi-ok");
    setKpiState("kpiError", avgError > 0 ? "kpi-warn" : "kpi-ok");

    // Session count
    const sessCount = $("qoeSessionCount");
    if (sessCount) sessCount.textContent = qoeHistory.length + " data points";

    // Time-series chart
    if (charts.qoe) {
      const labels = qoeHistory.map(r => fmtTime(r.ts));
      charts.qoe.data.labels = labels;
      charts.qoe.data.datasets[0].data = qoeHistory.map(r => r.startup_time_seconds);
      charts.qoe.data.datasets[1].data = qoeHistory.map(r => r.rebuffer_ratio * 100);
      charts.qoe.data.datasets[2].data = qoeHistory.map(r => r.avg_bitrate_kbps / 100);
      charts.qoe.update();
    }

    // Sparklines
    updateSparkline("sparkStartup", qoeHistory.map(r => r.startup_time_seconds));
    updateSparkline("sparkRebuffer", qoeHistory.map(r => r.rebuffer_ratio * 100));
    updateSparkline("sparkBitrate", qoeHistory.map(r => r.avg_bitrate_kbps));
    updateSparkline("sparkError", qoeHistory.map(r => r.error_rate));
    updateSparkline("sparkBandwidth", qoeHistory.map(r => r.avg_bandwidth_kbps));
    updateSparkline("sparkDropped", qoeHistory.map(r => r.dropped_frames));

    // Device/network pies
    if (charts.device || charts.network) {
      const deviceCounts = { mobile: 0, desktop: 0, tv: 0 };
      const networkCounts = { wifi: 0, "4g": 0, "5g": 0, unknown: 0 };
      for (const r of qoeHistory) {
        const d = (r.labels?.device_type || "desktop").toLowerCase();
        const n = (r.labels?.network_type || "unknown").toLowerCase();
        if (d in deviceCounts) deviceCounts[d]++; else deviceCounts.desktop++;
        if (n in networkCounts) networkCounts[n]++; else networkCounts.unknown++;
      }
      if (charts.device) {
        charts.device.data.datasets[0].data = Object.values(deviceCounts);
        charts.device.update();
      }
      if (charts.network) {
        charts.network.data.datasets[0].data = Object.values(networkCounts);
        charts.network.update();
      }
    }
  }

  function renderCDN() {
    if (!cdnHistory.length) return;

    const latestCDN = last(cdnHistory);
    const avgCache = avg(cdnHistory, "cacheHitRatio");
    const avgErr = avg(cdnHistory, "errorRate");
    const totReq = latestCDN.requests;
    const totBytes = latestCDN.bytes;

    setKpi("valCacheHit", (avgCache * 100).toFixed(1) + " %");
    setKpi("valCdnRequests", totReq.toLocaleString());
    setKpi("valCdnBandwidth", fmtBytes(totBytes));
    setKpi("valCdnError", (avgErr * 100).toFixed(3) + " %");

    setKpiState("kpiCacheHit", avgCache < 0.7 ? "kpi-crit" : avgCache < 0.8 ? "kpi-warn" : "kpi-ok");
    setKpiState("kpiCdnError", avgErr > 0.02 ? "kpi-crit" : avgErr > 0.01 ? "kpi-warn" : "kpi-ok");

    const cdnLast = $("cdnLastUpdate");
    if (cdnLast) cdnLast.textContent = "Updated " + fmtTime(latestCDN.ts);

    // CDN time-series
    if (charts.cdn) {
      charts.cdn.data.labels = cdnHistory.map(r => fmtTime(r.ts));
      charts.cdn.data.datasets[0].data = cdnHistory.map(r => (r.cacheHitRatio * 100));
      charts.cdn.data.datasets[1].data = cdnHistory.map(r => (r.errorRate * 100));
      charts.cdn.update();
    }

    updateSparkline("sparkCacheHit", cdnHistory.map(r => r.cacheHitRatio * 100));
    updateSparkline("sparkCdnRequests", cdnHistory.map(r => r.requests));
    updateSparkline("sparkCdnBandwidth", cdnHistory.map(r => r.bytes / 1e6));
    updateSparkline("sparkCdnError", cdnHistory.map(r => r.errorRate * 100));
  }

  function renderCorrelations() {
    if (!qoeHistory.length || !cdnHistory.length) return;

    // Pair each QoE point with the closest CDN point
    const pairs = qoeHistory.map((q, i) => ({
      qoe: q,
      cdn: cdnHistory[Math.min(i, cdnHistory.length - 1)]
    }));

    if (charts.corrRC) {
      charts.corrRC.data.datasets[0].data = pairs.map(p => ({
        x: p.cdn.cacheHitRatio,
        y: p.qoe.rebuffer_ratio
      }));
      charts.corrRC.update();
    }

    if (charts.corrBB) {
      charts.corrBB.data.datasets[0].data = pairs.map(p => ({
        x: p.qoe.avg_bandwidth_kbps,
        y: p.qoe.avg_bitrate_kbps
      }));
      charts.corrBB.update();
    }
  }

  function renderAlerts() {
    const thresholds = CFG.alerts || {};
    const latestQoE = last(qoeHistory) || {};
    const latestCDN = last(cdnHistory) || {};

    const rules = [
      {
        name: "Rebuffer Ratio",
        threshold: `> ${(thresholds.rebufferRatioMax || 0.03) * 100} %`,
        current: (latestQoE.rebuffer_ratio || 0) * 100,
        firing: (latestQoE.rebuffer_ratio || 0) > (thresholds.rebufferRatioMax || 0.03),
        format: (v) => v.toFixed(2) + " %"
      },
      {
        name: "Startup Time",
        threshold: `> ${thresholds.startupTimeMaxSec || 3} s`,
        current: latestQoE.startup_time_seconds || 0,
        firing: (latestQoE.startup_time_seconds || 0) > (thresholds.startupTimeMaxSec || 3),
        format: (v) => v.toFixed(2) + " s"
      },
      {
        name: "Cache Hit Ratio",
        threshold: `< ${(thresholds.cacheHitRatioMin || 0.7) * 100} %`,
        current: (latestCDN.cacheHitRatio || 1) * 100,
        firing: (latestCDN.cacheHitRatio || 1) < (thresholds.cacheHitRatioMin || 0.7),
        format: (v) => v.toFixed(1) + " %"
      },
      {
        name: "CDN Error Rate",
        threshold: `> ${(thresholds.cdnErrorRateMax || 0.02) * 100} %`,
        current: (latestCDN.errorRate || 0) * 100,
        firing: (latestCDN.errorRate || 0) > (thresholds.cdnErrorRateMax || 0.02),
        format: (v) => v.toFixed(3) + " %"
      }
    ];

    const tbody = $("alertTableBody");
    if (tbody) {
      tbody.innerHTML = rules.map(r => `
        <tr>
          <td>${r.name}</td>
          <td style="color:var(--muted)">${r.threshold}</td>
          <td style="font-weight:700">${r.format(r.current)}</td>
          <td>
            <span class="alert-badge ${r.firing ? "firing" : "ok"}">
              ${r.firing ? "🔴 FIRING" : "✅ OK"}
            </span>
          </td>
        </tr>
      `).join("");
    }

    // Alert banner
    const banner = $("alertBanner");
    if (banner) {
      const firing = rules.filter(r => r.firing);
      if (firing.length) {
        banner.hidden = false;
        const text = $("alertText");
        if (text) text.textContent = "ALERT: " + firing.map(r => r.name).join(", ") + " threshold breached.";
      } else {
        banner.hidden = true;
      }
    }
  }

  async function fetchGlobalMetrics() {
    const queryUrl = CFG.prometheusQueryUrl;
    const user = CFG.prometheusUser;
    const key = CFG.prometheusApiKey;

    if (!queryUrl || !user || !key) {
      return;
    }

    // Proxy path to avoid CORS (configured on web server/worker)
    const proxyUrl = "/query-proxy" || queryUrl;

    try {
      const basicAuth = btoa(`${user}:${key}`);
      const now = Math.floor(Date.now() / 1000);
      const start = now - 3600; // Last hour

      // Fetch 1h trend for a few key metrics (standardized names)
      const metrics = ["qoe_startup_time_seconds", "qoe_avg_bitrate_kbps", "qoe_rebuffer_ratio"];
      const results = await Promise.all(metrics.map(async m => {
        const url = `${proxyUrl}?query=${m}&start=${start}&end=${now}&step=60`;
        const res = await fetch(url, {
          headers: { "Authorization": `Basic ${basicAuth}` }
        });
        return res.ok ? await res.json() : null;
      }));

      // Map Prometheus range results back into our history format
      if (results.some(r => r && r.data && r.data.result.length)) {
        const history = [];
        const startupRes = results[0]?.data?.result[0]?.values || [];
        const bitrateRes = results[1]?.data?.result[0]?.values || [];
        const rebufRes = results[2]?.data?.result[0]?.values || [];

        // Use timestamps from the first available result as a base
        const baseValues = startupRes.length ? startupRes : bitrateRes;

        baseValues.forEach((val, idx) => {
          history.push({
            ts: val[0] * 1000,
            startup_time_seconds: parseFloat(val[1]),
            avg_bitrate_kbps: parseFloat(bitrateRes[idx] ? bitrateRes[idx][1] : 0),
            rebuffer_ratio: parseFloat(rebufRes[idx] ? rebufRes[idx][1] : 0),
            labels: { region: "Global", device_type: "All", network_type: "All" }
          });
        });

        if (history.length > 0) {
          qoeHistory = history;
          renderAll();
          toast("Global QoE loaded from Grafana");
        }
      }
      // Also fetch CDN metrics
      const cdnMetrics = ["cdn_cache_hit_ratio", "cdn_requests_total", "cdn_error_rate"];
      const cdnResults = await Promise.all(cdnMetrics.map(async m => {
        const url = `${proxyUrl}?query=${m}&start=${start}&end=${now}&step=60`;
        const res = await fetch(url, {
          headers: { "Authorization": `Basic ${basicAuth}` }
        });
        return res.ok ? await res.json() : null;
      }));

      if (cdnResults.some(r => r && r.data && r.data.result.length)) {
        const history = [];
        const cacheRes = cdnResults[0]?.data?.result[0]?.values || [];
        const reqRes = cdnResults[1]?.data?.result[0]?.values || [];
        const errRes = cdnResults[2]?.data?.result[0]?.values || [];

        cacheRes.forEach((val, idx) => {
          history.push({
            ts: val[0] * 1000,
            cacheHitRatio: parseFloat(val[1]),
            requests: parseInt(reqRes[idx] ? reqRes[idx][1] : 0),
            errorRate: parseFloat(errRes[idx] ? errRes[idx][1] : 0),
            bytes: 0 // Aggregate bytes not fetched for simplicity
          });
        });

        if (history.length > 0) {
          cdnHistory = history;
          renderCDN();
        }
      }
    } catch (e) {
      console.error("[DASH] Global fetch failed", e);
    }
  }

  function renderLiveStatus() {
    const li = $("liveIndicator");
    const ls = $("liveStatus");
    if (!li || !ls) return;

    const latest = qoeHistory.length ? qoeHistory[qoeHistory.length - 1] : null;
    const isFresh = latest && (Date.now() - latest.ts < 300_000); // 5 mins
    const hasRealData = (qoeHistory.length > 0);

    const parent = $("liveIndicatorParent");
    if (parent) {
      if (hasRealData && isFresh) {
        parent.classList.remove("offline");
        ls.textContent = "Live";
      } else {
        parent.classList.add("offline");
        ls.textContent = hasRealData ? "Standby" : "No data";
      }
    } else {
      // Fallback
      if (hasRealData && isFresh) {
        li.classList.remove("offline");
        ls.textContent = "Live";
      } else {
        li.classList.add("offline");
        ls.textContent = hasRealData ? "Standby" : "No data";
      }
    }
  }

  /* ── Polling: integrate with live OTT_OBS ──────────────────── */
  function startPolling() {
    // Poll window.OTT_OBS for live session metrics every 5 s
    setInterval(async () => {
      const obs = window.OTT_OBS;
      if (obs && typeof obs.flush === "function") {
        // grab the current in-memory metrics snapshot
        await obs.flush();
        // observability.js stores aggregated snapshots;
        // reload from localStorage after each flush
        const fresh = safeJson(LS_QOE_HISTORY);
        if (fresh && fresh.length) {
          qoeHistory = fresh;
          renderQoE();
          renderCorrelations();
          renderAlerts();
          renderLiveStatus();
          const tsEl = $("footerTs");
          if (tsEl) tsEl.textContent = "Last updated: " + new Date().toLocaleTimeString();
        }
      }
    }, 5_000);
  }

  /* ── Toast ─────────────────────────────────────────────────── */
  function toast(msg, type = "") {
    const stack = $("toastStack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`.trim();
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  /* ── Icon init ─────────────────────────────────────────────── */
  window.addEventListener("load", () => {
    if (window.lucide) lucide.createIcons();
  });

})();
