## Vercel Migration Workspace

This folder is named `versel` to match the request, but the plan and prompt inside target **Vercel** + **Supabase Postgres**.

## Contents

- `plan.md`: detailed migration plan, target architecture, file changes, auth model, metrics flow, CDN/origin strategy, and rollout steps
- `migration_prompt.md`: implementation prompt for carrying out the migration
- `schema.sql`: draft Supabase schema with DB-backed password auth, sessions, and private playback key storage
- `.env.example`: non-secret environment variable contract for Vercel
- `vercel.json`: cron scaffold for the 10-minute CDN metrics polling job
- `api/cron/cdn-metrics.js`: Vercel Function scaffold for scheduled Cloudflare CDN metric collection and Grafana forwarding
- `source_snapshot/`: curated copy of the current code and config that materially affect the migration

## Snapshot layout

- `source_snapshot/public_app/`: current web app, dashboard, service worker, keys, and helper tools
- `source_snapshot/pipeline/`: packaging/upload scripts and the current R2/CDN config inputs
- `source_snapshot/android_client/`: Android files that currently hardcode GitHub/CDN/metrics endpoints
- `source_snapshot/docs/`: current docs and ignore rules

## New architecture decisions captured here

- The old Cloudflare Worker CORS workaround is **no longer required** for the main app metrics flow once Vercel API routes exist.
- Client metrics should flow as:
  - browser or Android client -> Vercel endpoint -> Grafana Cloud
- CDN metrics should flow as:
  - Vercel cron every 10 minutes -> Cloudflare GraphQL -> Grafana Cloud
- Login/logout should be backed by:
  - `public.access_users` for account identity and authorization
  - `private.user_credentials` for password hashes
  - `private.user_sessions` for revocable server-side sessions
- The current Cloudflare Worker may still be kept only if you deliberately want a separate public Grafana proxy or iframe proxy path. It should not be required for auth, catalog, metrics ingest, or dashboard query APIs.

## Caching strategy

Use this as the deployment baseline.

- `index.html`, `dashboard.html`, `manifest.webmanifest`
  - `Cache-Control: public, max-age=0, must-revalidate`
  - Keep the shell fresh on each deployment.
- `sw.js`
  - `Cache-Control: public, max-age=0, must-revalidate`
  - Bump the cache version on every release that changes app shell behavior.
- `/assets/*`
  - `Cache-Control: public, max-age=31536000, immutable`
  - Fingerprint or rename assets when they change.
- `/api/auth/*`
  - `Cache-Control: private, no-store`
  - Never cache login, logout, or session reads in browsers or on Vercel CDN.
- `/api/license/*`
  - `Cache-Control: private, no-store`
  - Never cache playback key delivery.
- `/api/metrics/*`
  - `Cache-Control: private, no-store`
  - Metrics ingestion should always bypass caches.
- `/api/catalog` and `/api/catalog/rails`
  - If identical for all signed-in users: prefer `Vercel-CDN-Cache-Control: s-maxage=60, stale-while-revalidate=300`
  - If personalized by user or entitlement: use `Cache-Control: private, no-store`
- `/api/dashboard/summary`
  - For shared aggregate admin metrics: prefer `Vercel-CDN-Cache-Control: s-maxage=30, stale-while-revalidate=60`
  - If admin-personalized: use `Cache-Control: private, no-store`
- `ott.prashantkadam.in/*`
  - Keep media caching on Cloudflare CDN, not Vercel
  - Continue long TTLs for segments and manifests according to the current CDN strategy

Note:

- Per current Vercel docs, `Vercel-CDN-Cache-Control` takes precedence for Vercel cache behavior.
- Avoid CDN caching for any response that varies by session unless the response is truly identical and the cache key is designed correctly.

## Cron and scheduling notes

- The included `vercel.json` schedules CDN metric polling every 10 minutes using `/api/cron/cdn-metrics`.
- Per current Vercel docs, cron schedules more frequent than once per day require **Pro or Enterprise**. Hobby plans only support daily cron execution.
- Vercel cron schedules run in **UTC** and only on **Production** deployments.
- The included cron function expects `CRON_SECRET` so the invocation can verify the `Authorization: Bearer ...` header sent by Vercel.

## Important notes

- This snapshot intentionally includes files that currently contain secrets because they are part of the migration scope.
- Before any real deployment, rotate exposed secrets and remove them from git history or replace them in-place with non-secret configuration.
- The plan keeps video segments/manifests on the existing CDN path unless explicitly re-homed later; the GitHub-hosted JSON/config layer is what should move to Vercel/Supabase.
