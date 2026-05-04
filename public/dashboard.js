/**
 * dashboard.js
 * ─────────────────────────────────────────────────────────────
 * OTT Observability Dashboard – client-side data engine.
 */

(() => {
  "use strict";

  const config = window.OTT_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  // ── Design tokens ──────────────────
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
  let qoeHistory = [];
  let cdnHistory = [];
  let charts = {};

  /* ── boot ─────────────────────────────────────────────────── */
  window.addEventListener("DOMContentLoaded", async () => {
    // 1. Check session
    const hasAccess = await checkAdminAccess();
    if (!hasAccess) {
      showLoginModal();
    } else {
      initDashboard();
    }

    // Handle Login Form
    const loginForm = $("dashLoginForm");
    if (loginForm) {
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const identifier = $("dashUser").value;
        const password = $("dashPass").value;
        
        try {
          const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier, password })
          });
          
          if (res.ok) {
            const access = await checkAdminAccess();
            if (access) {
              hideLoginModal();
              initDashboard();
            } else {
              $("dashLoginError").textContent = "Access denied: Admin role required.";
              $("dashLoginError").style.display = "block";
            }
          } else {
            $("dashLoginError").textContent = "Invalid admin credentials.";
            $("dashLoginError").style.display = "block";
          }
        } catch (err) {
          console.error("Login failed:", err);
        }
      });
    }
  });

  function initDashboard() {
    buildCharts();
    refreshDashboard();
    setInterval(refreshDashboard, 30_000);

    if ($("refreshDash")) {
      $("refreshDash").addEventListener("click", () => {
        refreshDashboard();
        toast("Refreshing...");
      });
    }

    const dataToggle = $("dataToggle");
    if (dataToggle) {
        dataToggle.addEventListener("change", (e) => {
            const native = $("nativeDataSection");
            const real = $("realDataSection");
            if (e.target.checked) {
                if (native) native.style.display = "block";
                if (real) real.style.display = "none";
            } else {
                if (native) native.style.display = "none";
                if (real) real.style.display = "block";
            }
        });
    }
  }

  async function checkAdminAccess() {
    try {
      const res = await fetch("/api/auth/session");
      if (!res.ok) return false;
      const data = await res.json();
      return data.user && data.user.role === "admin";
    } catch (err) {
      return false;
    }
  }

  function showLoginModal() {
    const modal = $("dashLoginModal");
    if (modal) modal.style.display = "flex";
  }

  function hideLoginModal() {
    const modal = $("dashLoginModal");
    if (modal) modal.style.display = "none";
  }

  async function refreshDashboard() {
    if (!config.api?.dashboard) return;

    try {
      const res = await fetch(config.api.dashboard);
      if (res.status === 401) {
        showLoginModal();
        return;
      }
      if (!res.ok) throw new Error("Dashboard fetch failed");
      const data = await res.json();

      // In real scenario, data format would match summary.js output
      // transformed for the existing dashboard renderer
      if (data.latestMetrics) {
        cdnHistory = data.latestMetrics.map(m => ({
          ts: m.started_at,
          cacheHitRatio: m.cached_request_count / (m.request_count || 1),
          requests: m.request_count
        })).reverse();
      }
      
      setKpi("valUsers", data.activeUsers || 0);

      renderAll();
    } catch (err) {
      console.warn("[DASH] Load failed:", err);
    }
  }

  /* ── Chart initialization ─────────────────────────────────── */
  function buildCharts() {
    const createChart = (id, config) => {
      const el = $(id);
      if (!el) return null;
      return new Chart(el, config);
    };

    charts.qoe = createChart("qoeTimeSeries", {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Startup (s)", data: [], borderColor: C.accent, tension: 0.4, pointRadius: 2, borderWidth: 2 },
          { label: "Rebuffer %", data: [], borderColor: C.amber, tension: 0.4, pointRadius: 2, borderWidth: 2 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: C.text } }
        },
        scales: {
          x: { ticks: { color: C.muted }, grid: { color: C.grid } },
          y: { ticks: { color: C.muted }, grid: { color: C.grid } }
        }
      }
    });

    charts.cdn = createChart("cdnTimeSeries", {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Cache Hit %", data: [], borderColor: C.green, tension: 0.4, pointRadius: 2, borderWidth: 2 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: C.text } }
        },
        scales: {
          x: { ticks: { color: C.muted }, grid: { color: C.grid } },
          y: { ticks: { color: C.muted }, grid: { color: C.grid } }
        }
      }
    });

    // Sparklines
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

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function setKpi(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
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
    const tsEl = $("footerTs");
    if (tsEl) tsEl.textContent = "Last updated: " + new Date().toLocaleTimeString();
  }

  function renderQoE() {
    if (!qoeHistory.length) return;

    const avgStartup = avg(qoeHistory, "startup_time_seconds");
    const avgRebuf = avg(qoeHistory, "rebuffer_ratio");
    const avgBitrate = avg(qoeHistory, "avg_bitrate_kbps");

    setKpi("valStartup", avgStartup.toFixed(2) + " s");
    setKpi("valRebuffer", (avgRebuf * 100).toFixed(2) + " %");
    setKpi("valBitrate", Math.round(avgBitrate) + " kbps");

    if (charts.qoe) {
      charts.qoe.data.labels = qoeHistory.map(r => fmtTime(r.ts));
      charts.qoe.data.datasets[0].data = qoeHistory.map(r => r.startup_time_seconds);
      charts.qoe.data.datasets[1].data = qoeHistory.map(r => r.rebuffer_ratio * 100);
      charts.qoe.update();
    }

    updateSparkline("sparkStartup", qoeHistory.map(r => r.startup_time_seconds));
    updateSparkline("sparkRebuffer", qoeHistory.map(r => r.rebuffer_ratio * 100));
  }

  function renderCDN() {
    if (!cdnHistory.length) return;

    const latest = cdnHistory[cdnHistory.length - 1];
    setKpi("valCacheHit", (latest.cacheHitRatio * 100).toFixed(1) + " %");
    setKpi("valCdnRequests", (latest.requests || 0).toLocaleString());

    if (charts.cdn) {
      charts.cdn.data.labels = cdnHistory.map(r => fmtTime(r.ts));
      charts.cdn.data.datasets[0].data = cdnHistory.map(r => r.cacheHitRatio * 100);
      charts.cdn.update();
    }

    updateSparkline("sparkCacheHit", cdnHistory.map(r => r.cacheHitRatio * 100));
  }

  function toast(msg) {
    const stack = $("toastStack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

})();
