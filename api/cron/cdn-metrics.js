const CF_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

function readEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function resolveGrafanaWriteUrl() {
  const direct = process.env.GRAFANA_INFLUX_WRITE_URL;
  if (direct) {
    return direct;
  }

  const promUrl = readEnv("GRAFANA_PROM_URL");
  if (promUrl.includes("/api/prom/push")) {
    return promUrl.replace("/api/prom/push", "/influx/api/v1/push/influx/write");
  }
  return promUrl;
}

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function escLabel(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/ /g, "\\ ")
    .replace(/,/g, "\\,")
    .replace(/=/g, "\\=");
}

function buildLineProtocol(metrics) {
  const labels = [
    `app=${escLabel("VigilSiddhi_OTT")}`,
    `region=${escLabel("IN")}`,
    `provider=${escLabel("cloudflare")}`,
    `zone=${escLabel(metrics.zoneId)}`
  ].join(",");

  const tsNs = Date.now() * 1_000_000;
  return [
    `cdn_requests,${labels} value=${metrics.requests} ${tsNs}`,
    `cdn_cached_requests,${labels} value=${metrics.cachedRequests} ${tsNs}`,
    `cdn_bytes,${labels} value=${metrics.bytes} ${tsNs}`,
    `cdn_cached_bytes,${labels} value=${metrics.cachedBytes} ${tsNs}`,
    `cdn_page_views,${labels} value=${metrics.pageViews} ${tsNs}`,
    `cdn_cache_hit_ratio,${labels} value=${metrics.cacheHitRatio.toFixed(4)} ${tsNs}`,
    `cdn_error_rate,${labels} value=${metrics.errorRate.toFixed(4)} ${tsNs}`,
    `cdn_origin_offload_ratio,${labels} value=${metrics.cacheHitRatio.toFixed(4)} ${tsNs}`
  ].join("\n");
}

async function fetchCloudflareMetrics({ zoneId, apiToken }) {
  const query = `
    query GetCloudflareAnalytics($zoneTag: String, $start: Time!, $end: Time!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 1
            filter: { datetime_geq: $start, datetime_leq: $end }
          ) {
            sum {
              requests
              cachedRequests
              bytes
              cachedBytes
              pageViews
              responseStatusMap {
                edgeResponseStatus
                requests
              }
            }
          }
        }
      }
    }
  `;

  const variables = {
    zoneTag: zoneId,
    start: isoMinutesAgo(10),
    end: new Date().toISOString()
  };

  const response = await fetch(CF_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiToken}`
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`Cloudflare GraphQL failed with status ${response.status}`);
  }

  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(`Cloudflare GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  const sum = json?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups?.[0]?.sum;
  if (!sum) {
    return {
      requests: 0,
      cachedRequests: 0,
      bytes: 0,
      cachedBytes: 0,
      pageViews: 0,
      errorRate: 0
    };
  }

  const statusMap = Array.isArray(sum.responseStatusMap) ? sum.responseStatusMap : [];
  const errorRequests = statusMap.reduce((acc, item) => {
    const code = Number(item.edgeResponseStatus || 0);
    return acc + (code >= 400 ? Number(item.requests || 0) : 0);
  }, 0);

  const requests = Number(sum.requests || 0);
  const cachedRequests = Number(sum.cachedRequests || 0);

  return {
    requests,
    cachedRequests,
    bytes: Number(sum.bytes || 0),
    cachedBytes: Number(sum.cachedBytes || 0),
    pageViews: Number(sum.pageViews || 0),
    errorRate: requests > 0 ? errorRequests / requests : 0
  };
}

async function pushToGrafana(metrics) {
  const url = resolveGrafanaWriteUrl();
  const user = readEnv("GRAFANA_PROM_USER");
  const key = readEnv("GRAFANA_PROM_API_KEY");
  const auth = Buffer.from(`${user}:${key}`).toString("base64");
  const body = buildLineProtocol(metrics);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "Authorization": `Basic ${auth}`
    },
    body
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Grafana push failed with status ${response.status}: ${text.slice(0, 200)}`);
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const cronSecret = readEnv("CRON_SECRET");
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const zoneId = readEnv("CF_ZONE_ID");
    const apiToken = readEnv("CF_API_TOKEN");
    const metrics = await fetchCloudflareMetrics({ zoneId, apiToken });
    const cacheHitRatio = metrics.requests > 0 ? metrics.cachedRequests / metrics.requests : 0;

    await pushToGrafana({
      ...metrics,
      cacheHitRatio,
      zoneId
    });

    return res.status(200).json({
      ok: true,
      polledAt: new Date().toISOString(),
      schedule: "*/10 * * * *",
      zoneId,
      summary: {
        requests: metrics.requests,
        cachedRequests: metrics.cachedRequests,
        cacheHitRatio,
        errorRate: metrics.errorRate,
        bytes: metrics.bytes,
        pageViews: metrics.pageViews
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
