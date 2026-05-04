/**
 * Cloudflare Worker: OTT Observability Proxy
 * ─────────────────────────────────────────────────────────────
 * Deploy this to your domain (e.g., webott.prashantkadam.in) to 
 * handle CORS-safe metric pushing and dashboard querying.
 *
 * Routes:
 *  - /metrics-proxy  -> Grafana Influx Push
 *  - /query-proxy    -> Grafana Prometheus Query
 */

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);

  // 1. Handle CORS Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      }
    });
  }

  // 2. Metrics Push Proxy (/metrics-proxy)
  if (url.pathname === "/metrics-proxy") {
    // Forward to Grafana Influx endpoint
    // You can hardcode your Grafana URL here or pass it in a header
    const target = "https://influx-prod-13-prod-us-east-0.grafana.net/api/v1/push/influx/write";
    
    const response = await fetch(target, {
      method: "POST",
      headers: request.headers,
      body: request.body
    });

    return corsResponse(response);
  }

  // 3. Prometheus Query Proxy (/query-proxy)
  if (url.pathname === "/query-proxy") {
    const target = "https://prometheus-prod-13-prod-us-east-0.grafana.net/api/v1/query_range" + url.search;
    
    const response = await fetch(target, {
      method: "GET",
      headers: request.headers
    });

    return corsResponse(response);
  }

  return new Response("Not Found", { status: 404 });
}

function corsResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
