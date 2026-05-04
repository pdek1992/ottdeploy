function readEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function escLabel(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/ /g, "\\ ")
    .replace(/,/g, "\\,")
    .replace(/=/g, "\\=");
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const metrics = req.body;
  if (!metrics) {
    return res.status(400).json({ error: 'Body required' });
  }

  try {
    const user = readEnv("GRAFANA_PROM_USER");
    const key = readEnv("GRAFANA_PROM_API_KEY");
    const promUrl = readEnv("GRAFANA_PROM_URL");
    
    // Convert to Influx Line Protocol for Grafana Cloud Influx endpoint if available
    // OR if it is a Prometheus pushgateway endpoint, use its format.
    // Given the previous scaffold used Line Protocol for Grafana Cloud, I will continue that pattern.
    
    const writeUrl = promUrl.includes("/api/prom/push") 
      ? promUrl.replace("/api/prom/push", "/api/v1/push/influx/write")
      : promUrl;

    console.log(`[DEBUG] Metrics Write URL: ${writeUrl}`);
    const auth = Buffer.from(`${user}:${key}`).toString("base64");
    
    // Example transformation of client metrics to line protocol
    // { type: 'playback_start', videoId: '...', ... }
    const tsNs = Date.now() * 1_000_000;
    let measurement = "client_metrics";
    const labels = [
      `app=${escLabel("VigilSiddhi_OTT")}`,
      `type=${escLabel(metrics.type || 'unknown')}`
    ];
    
    // Custom logic per metric type
    if (metrics.type === 'vercel_edge_request') {
      measurement = "vercel_edge_metrics";
      if (metrics.data?.region) labels.push(`region=${escLabel(metrics.data.region)}`);
      if (metrics.data?.cache) labels.push(`cache=${escLabel(metrics.data.cache)}`);
      if (metrics.data?.ip_country) labels.push(`country=${escLabel(metrics.data.ip_country)}`);
      if (metrics.data?.method) labels.push(`method=${escLabel(metrics.data.method)}`);
    } else if (metrics.type === 'web_vitals') {
      measurement = "web_vitals";
      labels.push(`client=web`);
      if (metrics.data?.device_type) labels.push(`device=${escLabel(metrics.data.device_type)}`);
      if (metrics.data?.url) labels.push(`page=${escLabel(metrics.data.url)}`);
    } else {
      labels.push(`client=web`);
    }

    const labelStr = labels.join(",");
    
    // Flatten metrics.data into fields if present
    const fields = [];
    if (metrics.data && typeof metrics.data === 'object') {
      for (const [k, v] of Object.entries(metrics.data)) {
        // Skip keys already used as labels to avoid redundancy
        if (['region', 'cache', 'ip_country', 'method', 'device_type', 'url', 'type'].includes(k)) continue;

        if (typeof v === 'number') {
          fields.push(`${escLabel(k)}=${v}`);
        } else if (typeof v === 'string') {
          // Use strings as tags if they are short/categorical, or fields if they are unique
          // For Influx, we'll keep them as fields (quoted)
          fields.push(`${escLabel(k)}="${escLabel(v)}"`);
        }
      }
    }
    
    if (fields.length === 0) {
      fields.push('count=1');
    }

    const body = `${measurement},${labelStr} ${fields.join(',')} ${tsNs}`;

    const response = await fetch(writeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Authorization": `Basic ${auth}`
      },
      body
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[METRICS ERROR] Grafana push failed (${response.status}): ${text}`);
      return res.status(502).json({ 
        error: 'Failed to forward metrics', 
        targetStatus: response.status,
        targetResponse: text 
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
