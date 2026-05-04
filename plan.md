# OTT to Vercel + Supabase Migration Plan

## 1. Objective

Migrate the current OTT app away from GitHub Pages-era workarounds into a backend-backed architecture with:

- **Vercel** for the frontend and server-side APIs
- **Supabase Postgres** for application data, password-backed login data, sessions, and private playback metadata
- **Existing Cloudflare CDN/R2 origin** for media delivery so the current playback path and CDN behavior remain stable

This migration must:

- replace file-based authentication
- stop exposing secrets in browser code and Android constants
- stop using public GitHub JSON as the production control plane
- forward client metrics through Vercel to Grafana Cloud
- poll CDN metrics on a fixed schedule from Vercel and push them to Grafana Cloud

## 2. Current Codebase Findings

### 2.1 Web app

The current root web app is a static SPA served by:

- `index.html`
- `app.js`
- `config.js`
- `styles.css`
- `mobile.css`
- `mobile.js`
- `sw.js`
- `observability.js`
- `dashboard.html`
- `dashboard.js`

Current runtime behavior:

- `config.js` points to public GitHub Raw JSON for:
  - `allowed_emails.json`
  - `allowed_userids.json`
  - `description.json`
  - `mpd_mapping.json`
  - `keys.json`
- `config.js` also includes:
  - CDN and R2 URLs
  - fallback allowlists
  - a fixed client-side decryption passphrase
- `app.js` authorizes users directly in the browser
- `app.js` decrypts JSON in the browser with `crypto.subtle`
- `app.js` loads the full key store for playback
- `sw.js` caches auth JSON and playback JSON
- `observability.js` can push metrics using credential-bearing client config
- `dashboard.js` can construct Basic Auth in the browser

### 2.2 Cloudflare Worker workaround

There is an existing worker helper at:

- `tools/obs_proxy_worker.js`

This exists because the current app had no backend and needed CORS-safe proxy behavior from the browser.

Under the target architecture:

- this worker is **not needed** for the primary auth, catalog, metrics ingest, or dashboard query flows
- Vercel same-origin APIs should replace it
- keep it only if you intentionally want a separate public Grafana proxy or iframe proxy URL outside the app backend

### 2.3 Android app

The Android client mirrors the static-hosting assumptions:

- `AppConfig.kt` hardcodes GitHub Raw URLs, CDN URLs, and Grafana credentials
- `CatalogRepository.kt` fetches auth, metadata, mappings, and keys directly
- `PlayerActivity.kt` consumes ClearKey material
- `OTTMetrics.kt` ships Grafana credentials in the app

### 2.4 Packaging / upload pipeline

The media upload path is local-script driven:

- `config.json` contains R2 credentials and shared key material
- `run_package_upload.py`, `uploader/upload_r2.py`, and `process_workdir.py` update:
  - `keys/mpd_mapping.json`
  - `keys/keys.json`
  - `keys/description.json`
- current manifest URLs are emitted as:
  - `https://ott.prashantkadam.in/<video_id>/manifest.mpd`

### 2.5 Domain and origin layout

- frontend domain in repo: `webott.prashantkadam.in`
- media origin in config and metadata: `https://ott.prashantkadam.in`
- direct R2 origin is also present as a fallback

## 3. Main Problems to Fix

### Critical

1. `secrets.js` contains live secrets in a tracked file.
2. `config.json` contains live R2 credentials in a tracked file.
3. The browser can access secret-bearing JSON and a shared decryption passphrase.
4. The browser currently downloads the full playback key store.
5. Metrics credentials can be used from the client path.
6. Android currently ships operational secrets.
7. There is no real backend login or logout flow.

### Structural

1. Authentication is file-based and browser-side.
2. Hardcoded admin fallback exists in the frontend.
3. The old Cloudflare Worker exists mainly because there was no backend.
4. Catalog, auth, keys, and metrics config are mixed across code, JSON files, and helper scripts.

## 4. Security Reality Check

Vercel + Supabase will materially improve the security model, but **ClearKey remains a weak DRM choice** because authorized clients still need the decryption key.

Therefore:

- short-term secure target:
  - stop publishing the full key store
  - return only the needed key for one video through Vercel APIs
  - remove client-visible operational secrets
  - rotate all already-exposed credentials
- long-term secure target:
  - move to production DRM such as Widevine / FairPlay / PlayReady

## 5. Target Architecture

### 5.1 Hosting split

- **Vercel**
  - serves the frontend at `webott.prashantkadam.in`
  - exposes same-origin APIs for login, logout, session, catalog, playback key lookup, client metrics ingestion, dashboard summary, and admin sync
  - runs a scheduled cron job for CDN metrics every 10 minutes
  - stores runtime secrets in environment variables
- **Supabase**
  - stores users, password hashes, sessions, catalog metadata, stream mappings, rails, and private playback keys
  - uses RLS on exposed public tables
  - keeps private tables accessible only to server-side code
- **Cloudflare CDN / R2**
  - continues serving manifests, segments, and thumbnails from `ott.prashantkadam.in`

### 5.2 Origin strategy

Keep this split:

- `webott.prashantkadam.in` -> Vercel frontend + APIs
- `ott.prashantkadam.in` -> Cloudflare CDN / R2 media

Why:

- avoids serving DASH media through Vercel
- preserves current cache behavior
- minimizes playback regression risk
- lets Vercel own all secure control-plane traffic

### 5.3 API surface on Vercel

Primary API routes:

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

## 6. Authentication Model

### 6.1 Login

Replace file-based allowlist login with DB-backed password login:

1. frontend sends `identifier` and `password` to `POST /api/auth/login`
2. `identifier` may be email or legacy user ID
3. Vercel resolves the user from `public.access_users`
4. Vercel loads the password hash from `private.user_credentials`
5. Vercel verifies the password using **Argon2id** where possible
6. Vercel creates a session row in `private.user_sessions`
7. Vercel sets a signed `HttpOnly` cookie

### 6.2 Logout

1. frontend calls `POST /api/auth/logout`
2. Vercel marks the session row as revoked
3. Vercel clears the cookie

### 6.3 Session handling

- session cookie should be:
  - `HttpOnly`
  - `Secure`
  - `SameSite=Lax`
- session tokens should be stored hashed in the DB
- include expiry, revocation, and last-seen fields

### 6.4 Abuse controls

Implement:

- failed login counters
- lockout windows
- generic invalid-credentials responses
- optional rate limiting per IP and per identifier

## 7. What Goes Where

### 7.1 Vercel environment variables

Store these on Vercel:

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
- `GRAFANA_INFLUX_WRITE_URL` optional override for direct Influx write endpoint
- `GRAFANA_PROM_USER`
- `GRAFANA_PROM_API_KEY`
- `CF_ACCOUNT_ID`
- `CF_ZONE_ID`
- `CF_API_TOKEN`
- `CLEARKEY_FALLBACK_PASSPHRASE` only if the legacy encrypted blobs still need transitional decode support

### 7.2 Supabase public tables

Store non-secret application data in public tables:

- access identity and authorization metadata
- catalog metadata
- rails and ordering
- featured settings
- public manifest URLs
- public thumbnail URLs
- non-secret app settings

### 7.3 Supabase private schema

Store server-only data in the private schema:

- password hashes
- session records
- per-video ClearKey material
- cron run logs
- admin audit logs

### 7.4 Supabase Vault

Use Vault only if the secret must be used **inside Postgres** itself, such as from SQL-triggered integrations.

Do **not** use Vault as the default home for app secrets if only Vercel Functions need them. For this migration, Vercel env vars should remain the primary secret store.

## 8. Proposed Supabase Schema

The draft is in `schema.sql`.

### Public tables

1. `public.access_users`
   - identity, role, status, and authorization data
2. `public.app_settings`
   - app-level public settings
3. `public.catalog_videos`
   - catalog metadata
4. `public.video_streams`
   - manifest and public stream mapping
5. `public.catalog_rails`
   - rails
6. `public.catalog_rail_items`
   - rail contents

### Private tables

1. `private.user_credentials`
   - password hashes, lockout tracking, password update timestamps
2. `private.user_sessions`
   - revocable session rows
3. `private.video_keys`
   - per-video ClearKey data
4. `private.cdn_metrics_runs`
   - 10-minute cron run log and summary
5. `private.admin_audit_log`
   - admin and migration audit trail

## 9. Mapping Current Files to New Storage

| Current file | New home |
| --- | --- |
| `keys/allowed_emails.json` | `public.access_users.email` |
| `keys/allowed_userids.json` | `public.access_users.legacy_user_id` |
| `keys/description.json` | `public.catalog_videos` |
| `keys/mpd_mapping.json` | `public.video_streams` |
| `keys/keys.json` | `private.video_keys` |
| hardcoded login fallback data | `public.access_users` + `private.user_credentials` |
| client session state only | `private.user_sessions` + cookie |
| `observability.json` secrets | Vercel env vars |
| `config.js` runtime data | split between Vercel env vars, API responses, and public app settings |

## 10. File-by-File Update Plan

### Web app files

1. `index.html`
   - remove `secrets.js`
   - keep only public runtime config loading

2. `config.js`
   - remove GitHub Raw references
   - remove hardcoded allowlists and passphrases
   - keep only public display and origin config

3. `app.js`
   - replace browser auth with API login/logout/session
   - remove hardcoded admin bypass
   - load catalog from `/api/catalog`
   - load playback key only from `/api/license/:videoId`
   - remove client-side decryption of auth/catalog/key blobs

4. `observability.js`
   - send metrics only to `/api/metrics/ingest`
   - remove all direct Grafana credentials and direct proxy logic

5. `dashboard.js`
   - load aggregates only from `/api/dashboard/summary`
   - remove browser-generated Basic Auth

6. `dashboard.html`
   - public Grafana iframe can remain if intentionally public
   - do not mix it with privileged query logic

7. `sw.js`
   - stop caching auth, session, license, or metrics endpoints
   - cache only shell and public resources

8. `tools/obs_proxy_worker.js`
   - mark as legacy
   - remove from core deployment path unless intentionally retained for a separate public proxy

### Android files

1. `AppConfig.kt`
   - replace GitHub and metrics secrets with Vercel API base URL

2. `CatalogRepository.kt`
   - use Vercel APIs for login, logout, session, catalog, and playback key retrieval

3. `PlayerActivity.kt`
   - fetch playback key through backend route

4. `OTTMetrics.kt`
   - send metrics to Vercel only
   - remove Grafana credentials from the APK

### Pipeline files

1. `config.json`
   - remove tracked secret usage in active deployment path
   - replace with env-driven operational config

2. `run_package_upload.py` and `uploader/upload_r2.py`
   - stop updating Git-managed JSON as production source of truth
   - update Supabase after successful upload

3. `process_workdir.py`
   - emit DB sync payloads instead of GitHub JSON mutations

### New Vercel files

1. `vercel.json`
   - configure the 10-minute cron route

2. `api/cron/cdn-metrics.js`
   - scheduled Cloudflare metrics collector and Grafana forwarder

3. `.env.example`
   - environment contract for deployment

## 11. Proposed Vercel Project Structure

```text
versel/
  api/
    auth/
      login.js
      logout.js
      session.js
    catalog/
      index.js
      rails.js
    videos/
      [videoId].js
    license/
      [videoId].js
    metrics/
      ingest.js
    dashboard/
      summary.js
    admin/
      sync-video.js
    cron/
      cdn-metrics.js
  public/
    assets/
    index.html
    dashboard.html
    manifest.webmanifest
    sw.js
  src/
    app.js
    dashboard.js
    observability.js
    lib/
      api.js
      auth.js
      catalog.js
      metrics.js
  supabase/
    migrations/
      001_initial_schema.sql
  .env.example
  vercel.json
```

## 12. Detailed Data Flows

### 12.1 Login flow

1. client posts `identifier` and `password` to `POST /api/auth/login`
2. Vercel resolves the user in `public.access_users`
3. Vercel loads the password hash from `private.user_credentials`
4. Vercel verifies the password
5. Vercel creates `private.user_sessions` row
6. Vercel returns success and sets cookie

### 12.2 Session flow

1. client calls `GET /api/auth/session`
2. Vercel validates cookie against `private.user_sessions`
3. Vercel returns current session user state

### 12.3 Logout flow

1. client posts to `POST /api/auth/logout`
2. Vercel revokes the matching DB session row
3. cookie is cleared

### 12.4 Catalog flow

1. client calls `GET /api/catalog`
2. Vercel reads:
   - `public.catalog_videos`
   - `public.video_streams`
   - `public.app_settings`
3. Vercel returns a client-ready catalog payload

### 12.5 Playback / license flow

1. client requests `GET /api/license/:videoId`
2. Vercel verifies the session
3. Vercel checks the user's access rights
4. Vercel reads exactly one row from `private.video_keys`
5. Vercel returns only the key needed for that one video

### 12.6 Client metrics flow

1. website client posts metrics to `POST /api/metrics/ingest`
2. Android client posts metrics to `POST /api/metrics/ingest`
3. Vercel validates and normalizes payloads
4. Vercel forwards the metrics to Grafana Cloud using server-held credentials
5. optional failures can be logged or sampled for diagnostics

### 12.7 CDN metrics cron flow

1. Vercel cron calls `GET /api/cron/cdn-metrics` every 10 minutes
2. route validates `Authorization` against `CRON_SECRET`
3. route queries Cloudflare GraphQL analytics
4. route computes stable aggregate values
5. route pushes those metrics to Grafana Cloud
6. route writes a summary row to `private.cdn_metrics_runs`

### 12.8 Content ingest flow

1. local packaging pipeline uploads media to R2/CDN
2. after upload success, an admin sync writes:
   - catalog metadata
   - stream mapping
   - playback keys
3. frontend sees updated content through the API, not GitHub JSON

## 13. Secret Handling Decision Matrix

### Keep on Vercel

- Supabase service key
- session signing secret
- cron secret
- Grafana credentials
- Cloudflare API token
- R2 credentials
- legacy decryption passphrase if temporarily needed

### Keep in Supabase private schema

- password hashes
- hashed session tokens
- playback keys
- cron run logs
- audit logs

### Keep in Supabase Vault only when DB code needs it

- SQL-triggered integration secrets

### Never keep in frontend or Android runtime

- password hashes
- session secrets
- Grafana credentials
- Cloudflare tokens
- service-role keys
- R2 credentials
- the full key store
- decryption passphrases

## 14. Vercel Configuration Plan

### Deployment

- create a dedicated Vercel project
- bind `webott.prashantkadam.in` to that project
- keep media on Cloudflare/CDN

### Headers

Set strict headers:

- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`
- `Content-Security-Policy`

### Caching

Recommended baseline:

- `/assets/*`
  - `Cache-Control: public, max-age=31536000, immutable`
- shell HTML and manifest
  - `Cache-Control: public, max-age=0, must-revalidate`
- `/api/auth/*`, `/api/license/*`, `/api/metrics/*`
  - `Cache-Control: private, no-store`
- `/api/catalog*`
  - use `Vercel-CDN-Cache-Control` only if the response is not personalized
- `/api/dashboard/summary`
  - short edge cache only if shared and not per-user

### Cron

- use `*/10 * * * *` for `/api/cron/cdn-metrics`
- protect with `CRON_SECRET`
- note that this cadence requires **Vercel Pro or Enterprise**
- note that cron jobs run in UTC and only on Production

## 15. Supabase Configuration Plan

### Database

- run `schema.sql`
- enable RLS on public tables
- keep private tables outside browser access

### Auth

Phase 1 target:

- custom DB-backed user/password login backed by:
  - `public.access_users`
  - `private.user_credentials`
  - `private.user_sessions`

Future optional phase:

- evaluate Supabase Auth only if it aligns with the password and session requirements without breaking the existing login UX

### Operational safety

- rotate all already-exposed secrets
- remove old GitHub Raw dependencies
- remove direct client Grafana auth paths
- retire the old Cloudflare Worker from the critical path

## 16. CDN and DNS Plan

### Keep

- `ott.prashantkadam.in` as the media CDN/origin
- current manifest and segment path shape

### Move

- `webott.prashantkadam.in` to Vercel

### Why

- preserves media performance
- preserves CDN cache hit behavior
- keeps the app backend same-origin

## 17. Rollout Sequence

### Phase 0: preparation

1. create Supabase project
2. create Vercel project
3. rotate exposed secrets
4. run schema migration

### Phase 1: auth boundary

1. implement DB-backed password login
2. implement logout and revocable sessions
3. remove hardcoded admin bypass

### Phase 2: data migration

1. import current auth and catalog JSON into Supabase
2. validate rows and indexes

### Phase 3: frontend cutover

1. move web app to same-origin APIs
2. remove `secrets.js`
3. update service worker caching

### Phase 4: observability cutover

1. route website metrics through Vercel
2. route Android metrics through Vercel
3. replace dashboard browser auth logic
4. remove Cloudflare Worker dependence for primary metrics flow

### Phase 5: scheduled CDN metrics

1. add Vercel cron route
2. secure with `CRON_SECRET`
3. poll Cloudflare every 10 minutes
4. push results to Grafana Cloud

### Phase 6: pipeline sync

1. make packaging/upload pipeline update Supabase instead of GitHub JSON

### Phase 7: Android cutover

1. point Android app to Vercel APIs
2. remove embedded metrics secrets
3. regression-test login, playback, and metrics

### Phase 8: production cutover

1. point `webott.prashantkadam.in` to Vercel
2. verify HTTPS, cookies, API routes, and cron
3. monitor playback, API error rate, and CDN hit rate

## 18. Acceptance Checklist

- no secrets remain in client JS or Android constants
- no GitHub Raw URLs remain in active runtime code
- login uses DB-backed password verification
- logout revokes DB sessions and clears cookies
- no service worker cache contains auth, session, license, or metrics responses
- frontend catalog loads only from Vercel API
- dashboard summary loads only from Vercel API
- website metrics go to Vercel first, then Grafana Cloud
- Android metrics go to Vercel first, then Grafana Cloud
- CDN metrics cron runs every 10 minutes in Production
- Cloudflare Worker is no longer required for the primary metrics path
- Vercel env vars hold runtime secrets
- Supabase private tables are not browser-readable
- `webott.prashantkadam.in` serves the app from Vercel
- `ott.prashantkadam.in` still serves manifests and segments

## 19. Risks and Mitigations

### Risk: ClearKey still leaks to authorized clients

Mitigation:

- return per-video keys only
- rotate keys
- plan DRM upgrade

### Risk: stale service worker or API cache

Mitigation:

- bump service worker version
- use `private, no-store` for auth, session, license, and metrics routes
- keep catalog caching conservative at first

### Risk: cron cadence unsupported on Hobby

Mitigation:

- use Pro or Enterprise for 10-minute polling
- call this out before deployment approval

### Risk: Android regressions

Mitigation:

- keep response shapes close to current JSON structure
- cut web APIs first, then Android

### Risk: accidental DB exposure

Mitigation:

- use Vercel backend as the main read/write path
- keep private tables out of browser access
- enable RLS on public tables

## 20. Implementation Prompt

Use `migration_prompt.md` as the implementation brief.

## 21. Official Reference Links

- Vercel environment variables: https://vercel.com/docs/environment-variables
- Vercel Cache-Control headers: https://vercel.com/docs/headers/cache-control-headers
- Vercel cron jobs: https://vercel.com/docs/cron-jobs
- Vercel managing cron jobs: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Vercel cron job limits: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Vercel custom domains: https://vercel.com/docs/domains/set-up-custom-domain
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase function secrets: https://supabase.com/docs/guides/functions/secrets
- Supabase Vault: https://supabase.com/docs/guides/database/vault
