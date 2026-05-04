# Implementation Prompt: Migrate OTT App to Vercel + Supabase

You are migrating the current OTT codebase into a deployable **Vercel frontend + Vercel API + Supabase Postgres** architecture.

## Primary goal

Remove all public GitHub JSON dependencies and all browser-visible or APK-visible secrets while preserving:

- the current OTT UI and playback behavior
- the current CDN/media origin pattern
- the current content catalog
- current DASH manifest paths where possible

## Hard constraints

1. Keep the project rooted under the existing workspace and use `versel/` as the migration workspace name.
2. Keep `webott.prashantkadam.in` as the frontend/app origin by deploying the app on Vercel with that custom domain.
3. Keep `ott.prashantkadam.in` as the media CDN/origin for manifests, segments, and public thumbnails unless there is a compelling technical reason to change it.
4. Do not proxy DASH media through Vercel unless absolutely necessary.
5. Do not expose any of the following to the frontend:
   - Supabase service-role or secret keys
   - Cloudflare tokens
   - Grafana credentials
   - R2 access keys
   - the full ClearKey store
   - any decryption passphrase
   - password hashes
   - session secrets
6. Remove all GitHub Raw runtime dependencies from the web app and Android app.
7. Replace the old no-backend workarounds from GitHub Pages:
   - file-based authentication
   - client-side secret decryption for operational config
   - Cloudflare Worker CORS workarounds for primary metrics flow
8. Preserve or improve current functionality for:
   - login
   - logout
   - catalog browsing
   - playback
   - metrics ingestion
   - dashboard viewing

## Current source material

Use the copied snapshot under `versel/source_snapshot/` as the migration reference:

- `public_app/`
- `pipeline/`
- `android_client/`
- `docs/`

Pay special attention to these current files:

- `public_app/config.js`
- `public_app/app.js`
- `public_app/secrets.js`
- `public_app/observability.js`
- `public_app/dashboard.js`
- `public_app/sw.js`
- `public_app/tools/obs_proxy_worker.js`
- `pipeline/config.json`
- `pipeline/run_package_upload.py`
- `pipeline/process_workdir.py`
- `pipeline/uploader/upload_r2.py`
- `android_client/AppConfig.kt`
- `android_client/CatalogRepository.kt`
- `android_client/OTTMetrics.kt`
- `android_client/PlayerActivity.kt`

## Required deliverables

Create a Vercel-ready implementation with:

1. A static frontend that keeps the current OTT experience.
2. Vercel API routes for:
   - `POST /api/auth/login`
   - `POST /api/auth/logout`
   - `GET /api/auth/session`
   - `GET /api/catalog`
   - `GET /api/catalog/rails`
   - `GET /api/videos/:videoId`
   - `GET /api/license/:videoId`
   - `POST /api/metrics/ingest`
   - `GET /api/dashboard/summary`
   - `POST /api/admin/sync-video`
   - `GET /api/cron/cdn-metrics`
3. Supabase schema and migration files based on `versel/schema.sql`.
4. A data migration script that imports:
   - `allowed_emails.json`
   - `allowed_userids.json`
   - `description.json`
   - `mpd_mapping.json`
   - `keys.json`
5. Refactored frontend code that calls same-origin Vercel APIs instead of GitHub Raw or direct secret-bearing endpoints.
6. A secure config system using Vercel environment variables for secrets and public runtime config for non-secret values.
7. Android client updates so it uses the new Vercel API base instead of GitHub Raw and embedded Grafana credentials.
8. A Vercel cron job configuration that polls CDN metrics every 10 minutes and forwards them to Grafana Cloud.
9. An `.env.example` or equivalent non-secret contract file documenting runtime variables.

## Security requirements

### Authentication

Implement a DB-backed password login/session model:

- frontend submits `identifier` and `password` to `POST /api/auth/login`
- `identifier` may be email or legacy user ID
- Vercel resolves the user from `public.access_users`
- Vercel loads the password hash from `private.user_credentials`
- verify passwords with **Argon2id** if possible, or bcrypt only if there is a clear deployment constraint
- Vercel creates a server-side session row in `private.user_sessions`
- Vercel sets a signed `HttpOnly`, `Secure`, `SameSite=Lax` session cookie
- `POST /api/auth/logout` revokes the server-side session row and clears the cookie
- remove hardcoded admin bypass

Also implement basic abuse controls:

- increment failed login counters
- support temporary lockout via DB fields
- avoid leaking whether the email/user ID exists

### Catalog and metadata

- Move catalog metadata from GitHub JSON into Supabase tables.
- Return a frontend-friendly response shape from the API so the UI can remain mostly unchanged.

### Playback keys

- Do not ship the full `keys.json` blob to the browser.
- Store per-video key material in a private Supabase table.
- Return only the current video's ClearKey material through a gated API route.
- Make it explicit in code comments that ClearKey is only a stopgap and not production-grade DRM.

### Metrics and dashboard

Implement these flows:

- browser client -> `POST /api/metrics/ingest` -> Vercel -> Grafana Cloud
- Android client -> `POST /api/metrics/ingest` -> Vercel -> Grafana Cloud
- Vercel cron every 10 minutes -> Cloudflare GraphQL -> Grafana Cloud
- dashboard UI -> `GET /api/dashboard/summary` -> Vercel server aggregation or Grafana query

Rules:

- do not let frontend code construct Basic Auth headers for Grafana
- do not require the Cloudflare Worker CORS workaround for the main app flow
- retire `obs_proxy_worker.js` unless it is intentionally retained for a separate public dashboard proxy use case

### Service worker

- Remove sensitive route caching.
- Cache only shell assets and explicitly public resources.

## Data model to implement

Implement these tables using the schema plan:

- `public.access_users`
- `public.app_settings`
- `public.catalog_videos`
- `public.video_streams`
- `public.catalog_rails`
- `public.catalog_rail_items`
- `private.user_credentials`
- `private.user_sessions`
- `private.video_keys`
- `private.cdn_metrics_runs`
- `private.admin_audit_log`

Use RLS on public tables. Keep private tables accessible only via server-side credentials.

## Environment variable contract

Assume the following Vercel env vars exist and wire the code accordingly:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_SECRET`
- `CRON_SECRET`
- `APP_BASE_URL`
- `CDN_BASE_URL`
- `R2_ENDPOINT_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `GRAFANA_PROM_URL`
- `GRAFANA_INFLUX_WRITE_URL` optional direct write endpoint override
- `GRAFANA_PROM_USER`
- `GRAFANA_PROM_API_KEY`
- `CF_ACCOUNT_ID`
- `CF_ZONE_ID`
- `CF_API_TOKEN`
- `CLEARKEY_FALLBACK_PASSPHRASE`

Create an `.env.example` or equivalent non-secret contract file that documents these names.

## Frontend refactor requirements

Update the web frontend so:

1. `config.js` becomes public-only.
2. `app.js` no longer:
   - fetches GitHub Raw URLs
   - decrypts auth/catalog/key blobs in the browser
   - uses hardcoded admin login bypass
3. `observability.js` posts only to `/api/metrics/ingest`.
4. `dashboard.js` reads dashboard summary data only from `/api/dashboard/summary`.
5. `sw.js` excludes auth, session, license, and metrics responses from cache.

Keep the UI styling and current browsing/playback UX as intact as possible.

## Android refactor requirements

Update the Android files so:

1. `AppConfig.kt` points to the Vercel app/API origin.
2. `CatalogRepository.kt` uses Vercel APIs for login, logout, session, catalog, and per-video license retrieval.
3. `OTTMetrics.kt` posts to the Vercel metrics endpoint and no longer embeds Grafana credentials.
4. `PlayerActivity.kt` keeps playback working with server-fetched key material.

## Pipeline refactor requirements

Update the packaging/upload workflow so it stops treating git JSON files as the production source of truth.

Required behavior:

1. Package and upload video artifacts to the existing R2/CDN path.
2. After upload success, update Supabase rows for:
   - video metadata
   - stream mapping
   - per-video keys
3. Preserve current manifest URL shape under `https://ott.prashantkadam.in/<video_id>/manifest.mpd` unless there is a strong reason to change it.

## Cron requirements

Implement the scheduled CDN polling route to:

1. verify the `Authorization` header against `CRON_SECRET`
2. fetch Cloudflare CDN analytics for the current zone
3. compute stable aggregate metrics
4. forward those metrics from Vercel to Grafana Cloud
5. optionally persist a lightweight run log in `private.cdn_metrics_runs`

Use `*/10 * * * *` as the Vercel cron expression.

Important:

- note that this requires **Vercel Pro or Enterprise** for 10-minute cadence
- Vercel cron runs in UTC and only on Production deployments

## DNS/CDN/origin requirements

- Vercel app should own `webott.prashantkadam.in`.
- Cloudflare/CDN should continue serving `ott.prashantkadam.in`.
- API calls should be same-origin under the Vercel app domain.
- Media calls may remain cross-origin to the CDN domain if that is the current stable path.

## Testing checklist

Before considering the migration complete, verify:

1. No GitHub Raw URLs remain in active web runtime or Android runtime.
2. No secrets remain in client JS or Android constants.
3. Login works with DB-backed password verification.
4. Logout revokes the session server-side and clears the cookie.
5. Catalog loads from Vercel API.
6. Playback still works for:
   - CDN-hosted videos
   - external demo streams
7. Per-video ClearKey retrieval works without returning the whole key set.
8. Website client metrics reach Vercel, then Grafana Cloud.
9. Android client metrics reach Vercel, then Grafana Cloud.
10. CDN metrics cron runs every 10 minutes in Production and reaches Grafana Cloud.
11. Dashboard data works without browser-side Grafana Basic Auth.
12. Upload pipeline updates Supabase instead of git JSON.
13. Service worker does not cache sensitive responses.

## Migration strategy

Implement in this order:

1. Schema and data import.
2. Password auth and session APIs.
3. Web frontend refactor.
4. Metrics ingest and dashboard hardening.
5. CDN cron implementation.
6. Pipeline sync changes.
7. Android client updates.
8. Deployment config and DNS cutover.

## Coding style

- Keep code readable and minimal.
- Prefer same response shapes as the current app where possible to minimize UI churn.
- Add short comments only where the security boundary or data flow would otherwise be easy to misunderstand.
- If you must make a tradeoff, prefer security boundary correctness over preserving old helper abstractions.
