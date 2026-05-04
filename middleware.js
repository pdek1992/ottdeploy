// Standard Web API Response for Edge Middleware
// No Next.js dependencies allowed here in a plain Vercel project

export const config = {
  matcher: ['/:path*'],
};

export function middleware(req, event) {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Skip middleware for API routes and static files to avoid recursion and overhead
  if (
    pathname.startsWith('/api/') || 
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/styles/') ||
    pathname.includes('.') ||
    pathname === '/favicon.ico'
  ) {
    return new Response(null, { headers: { 'x-middleware-next': '1' } });
  }

  const start = Date.now();
  const res = new Response(null, { headers: { 'x-middleware-next': '1' } });

  // We use event.waitUntil to push metrics without blocking the response
  // Note: middleware in Vercel runs at the Edge.
  
  const metricData = {
    type: 'vercel_edge_request',
    data: {
      path: new URL(req.url).pathname,
      method: req.method,
      region: req.headers.get('x-vercel-id') || 'unknown',
      ip_country: req.headers.get('x-vercel-ip-country') || 'unknown',
      cache: req.headers.get('x-vercel-cache') || 'miss',
      ua: req.headers.get('user-agent') || 'unknown',
      referer: req.headers.get('referer') || 'unknown',
      is_bot: /bot|spider|crawl/i.test(req.headers.get('user-agent') || '') ? 1 : 0
    }
  };

  // Push metrics in the background
  // We point to the absolute URL of our ingestor
  const ingestUrl = new URL('/api/metrics/ingest', req.url).href;
  
  // Use waitUntil if available (standard in Vercel Edge functions)
  // If not, we just fire and forget (though fetch might be killed if function exits)
  const pushPromise = fetch(ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metricData),
  }).catch(() => {});

  if (event && typeof event.waitUntil === 'function') {
    event.waitUntil(pushPromise);
  }
  
  return res;
}
