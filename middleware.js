import { NextResponse } from 'next/server';

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

export function middleware(req) {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Skip middleware for API routes and static files to avoid recursion and overhead
  if (pathname.startsWith('/api/') || pathname.includes('.')) {
    return NextResponse.next();
  }

  const start = Date.now();
  const res = NextResponse.next();

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

  // Vercel Middleware doesn't have an explicit 'event' object in the signature 
  // like Cloudflare Workers, but we can return the response.
  // In Vercel, waitUntil is available on the request object in some environments
  // or via the 'NextResponse' if using certain patterns.
  // However, for simple middleware, fire-and-forget fetch is often sufficient 
  // for small metrics, but may be unreliable.
  
  return res;
}
