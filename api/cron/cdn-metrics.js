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
  const commonLabels = [
    `app=${escLabel("VigilSiddhi_OTT")}`,
    `region=${escLabel("IN")}`,
    `provider=${escLabel("cloudflare")}`,
    `zone=${escLabel(metrics.zoneId)}`
  ].join(",");

  const tsNs = Date.now() * 1_000_000;
  const lines = [
    `cdn_summary,${commonLabels} requests=${metrics.requests},cached_requests=${metrics.cachedRequests},bytes=${metrics.bytes},cached_bytes=${metrics.cachedBytes},page_views=${metrics.pageViews},error_rate=${metrics.errorRate.toFixed(4)},cache_hit_ratio=${metrics.cacheHitRatio.toFixed(4)} ${tsNs}`
  ];

  // Add Status Code breakdown
  if (metrics.statusCodes) {
    for (const [status, count] of Object.entries(metrics.statusCodes)) {
      lines.push(`cdn_status_codes,${commonLabels},status=${status} value=${count} ${tsNs}`);
    }
  }

  // Add Data Center (Colo) breakdown
  if (metrics.colos) {
    for (const [colo, count] of Object.entries(metrics.colos)) {
      lines.push(`cdn_colos,${commonLabels},colo=${escLabel(colo)} requests=${count} ${tsNs}`);
    }
  }

  // Add Country breakdown
  if (metrics.countries) {
    for (const [country, count] of Object.entries(metrics.countries)) {
      lines.push(`cdn_countries,${commonLabels},country=${escLabel(country)} requests=${count} ${tsNs}`);
    }
  }

  // Add Device breakdown
  if (metrics.devices) {
    for (const [device, count] of Object.entries(metrics.devices)) {
      lines.push(`cdn_devices,${commonLabels},device=${escLabel(device)} requests=${count} ${tsNs}`);
    }
  }

  return lines.join("\n");
}

async function fetchCloudflareMetrics({ zoneId, apiToken }) {
  const query = `
    query GetCloudflareAnalytics($zoneTag: String, $start: Time!, $end: Time!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 100
            filter: { datetime_geq: $start, datetime_leq: $end }
            orderBy: [datetime_ASC]
          ) {
            sum {
              requests
              cachedRequests
              bytes
              cachedBytes
              pageViews
            }
            dimensions {
              edgeResponseStatus
              edgeColoName
              clientCountryName
              clientDeviceType
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

  const groups = json?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups;
  if (!groups || groups.length === 0) {
    return {
      requests: 0,
      cachedRequests: 0,
      bytes: 0,
      cachedBytes: 0,
      pageViews: 0,
      errorRate: 0,
      statusCodes: {},
      colos: {},
      countries: {},
      devices: {}
    };
  }

  const result = {
    requests: 0,
    cachedRequests: 0,
    bytes: 0,
    cachedBytes: 0,
    pageViews: 0,
    statusCodes: {},
    colos: {},
    countries: {},
    devices: {}
  };

  let totalErrorRequests = 0;

  for (const group of groups) {
    const s = group.sum;
    const d = group.dimensions;
    const reqs = Number(s.requests || 0);

    result.requests += reqs;
    result.cachedRequests += Number(s.cachedRequests || 0);
    result.bytes += Number(s.bytes || 0);
    result.cachedBytes += Number(s.cachedBytes || 0);
    result.pageViews += Number(s.pageViews || 0);

    // Aggregate Dimensions
    const status = d.edgeResponseStatus;
    result.statusCodes[status] = (result.statusCodes[status] || 0) + reqs;
    if (status >= 400) totalErrorRequests += reqs;

    const colo = d.edgeColoName;
    result.colos[colo] = (result.colos[colo] || 0) + reqs;

    const country = d.clientCountryName;
    result.countries[country] = (result.countries[country] || 0) + reqs;

    const device = d.clientDeviceType;
    result.devices[device] = (result.devices[device] || 0) + reqs;
  }

  return {
    ...result,
    errorRate: result.requests > 0 ? totalErrorRequests / result.requests : 0
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
