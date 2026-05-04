/**
 * observability_config.js  –  VigilSiddhi OTT
 * ─────────────────────────────────────────────────────────────
 * Central configuration for OTT observability / metrics pipeline.
 *
 * ⚠️  SECRETS REQUIRED – fill in the values marked "REPLACE_ME"
 *      before deploying.  Never commit real credentials to git.
 *
 * ─────────────────────────────────────────────────────────────
 * HOW TO GET EACH CREDENTIAL
 * ─────────────────────────────────────────────────────────────
 *
 *  1. prometheusUrl
 *       Grafana Cloud → Connections → Prometheus → Details
 *       Format: https://prometheus-prod-XX.grafana.net/api/prom/push
 *       → Already filled in below (ap-south-1 region)
 *
 *  2. prometheusUser  (Metrics instance ID)
 *       Same Grafana Cloud details page, labelled "Instance ID" (numeric)
 *       Example: 1234567
 *
 *  3. prometheusApiKey  (API key with MetricsPublisher role)
 *       Grafana Cloud → Security → API keys → Add
 *       Role required: MetricsPublisher
 *
 *  4. grafanaBaseUrl
 *       Your Grafana Cloud instance URL
 *       Example: https://vigilsiddhi.grafana.net
 *
 *  5. cfAccountId
 *       Cloudflare Dashboard → right sidebar → Account ID
 *
 *  6. cfZoneId
 *       Cloudflare Dashboard → your domain → Overview → right rail → Zone ID
 *
 *  7. cfApiToken
 *       Cloudflare Dashboard → My Profile → API Tokens → Create Token
 *       Template: "Read Analytics" or Custom with Analytics:Read scope
 *
 * ─────────────────────────────────────────────────────────────
 * LOCAL CDN RUNNER (no GitHub Actions needed)
 * ─────────────────────────────────────────────────────────────
 *   Double-click: start_metrics.bat    (sets env vars → runs run_metrics.js)
 *   Or:           node run_metrics.js  (uses env vars already in shell)
 *   Push interval: every 60 s
 */

window.OTT_OBSERVABILITY = {

  appName: "VigilSiddhi OTT",

  // ── Grafana Cloud / Prometheus ─────────────────────────────

  /** Full Prometheus remote_write URL (ap-south-1 region). */
  prometheusUrl: "https://prometheus-prod-43-prod-ap-south-1.grafana.net/api/prom/push",

  /**
   * Grafana Cloud metrics instance username (numeric string).
   * REPLACE with your actual Instance ID from Grafana Cloud → Connections.
   */
  prometheusUser: "2490227",

  /**
   * Grafana Cloud API key with MetricsPublisher role.
   * Pulls from local-only secrets.js
   */
  prometheusApiKey: (window.OTT_SECRETS && window.OTT_SECRETS.prometheusApiKey) || "",

  /** Grafana Cloud dashboard base URL. */
  grafanaBaseUrl: "https://vigilsiddhi.grafana.net",

  // ── Cloudflare CDN (used by cdn_collector.js / run_metrics.js) ──

  /** Cloudflare Account ID. */
  cfAccountId: "e63579be88693f2808e148ec66d99bb4",

  /** Cloudflare Zone ID. */
  cfZoneId: "2050063a1247fd46857e5c7c28f7f756",

  /** Cloudflare API token (Analytics:Read). Pulls from local secrets.js */
  cfApiToken: (window.OTT_SECRETS && window.OTT_SECRETS.cfApiToken) || "",

  // ── Metric push settings ────────────────────────────────────

  /**
   * How often (ms) the client aggregates and pushes QoE metrics.
   * 30 s → ~2 pushes/min per active viewer.
   * Free tier headroom: 10 k series/5 m samples per min.
   */
  pushIntervalMs: 30_000,

  /** Low-cardinality region label applied to every metric. */
  region: "IN",

  // ── Alert thresholds ────────────────────────────────────────
  //   Enforced on the local dashboard page; mirror these in
  //   Grafana Alerting rules for cloud notifications.

  alerts: {
    rebufferRatioMax: 0.03,   // > 3 % rebuffer → WARNING
    startupTimeMaxSec: 3.0,    // > 3 s startup  → CRITICAL
    cacheHitRatioMin: 0.70,   // < 70 % cache   → WARNING
    cdnErrorRateMax: 0.02    // > 2 % errors   → CRITICAL
  }
};
