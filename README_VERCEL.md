# VigilSiddhi OTT - Vercel Migration

This project has been migrated from a static, file-based GitHub Raw architecture to a dynamic **Vercel + Supabase** backend.

## Architecture Improvements

1.  **Secure Authentication**: Moved from client-side email/ID checks to server-side Argon2id hashing with `HttpOnly` secure cookies.
2.  **Dynamic Catalog**: Metadata is now fetched from a Supabase Postgres database via serverless functions, eliminating the need for `metadata.json` updates in Git.
3.  **Server-Gated DRM**: ClearKey licenses are delivered via `/api/license`, gated by active session verification. No keys are exposed in the frontend.
4.  **Observability Ingestion**: Client metrics are pushed to `/api/metrics/ingest`, which proxies them to Grafana Cloud, removing the need for a separate Cloudflare Worker.
5.  **Admin Sync**: A dedicated `/api/admin/sync-video` endpoint allows the processing pipeline to update the database directly.

## Deployment Steps

1.  **Supabase Setup**:
    - Create a new Supabase project.
    - Run the provided `schema.sql` in the Supabase SQL Editor.
    - Insert an initial user into the `users` table (use a tool to hash your desired password if not using the migration script).

2.  **Environment Variables**:
    Add the following to your Vercel project settings:
    - `SUPABASE_URL`: Your Supabase project URL.
    - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key (used for admin/sync authorization).
    - `SUPABASE_ANON_KEY`: Your Supabase anonymous key.
    - `SESSION_SECRET`: A long, random string for cookie encryption.
    - `GRAFANA_PROM_URL`: Your Grafana Cloud Influx/Prometheus push URL.
    - `GRAFANA_PROM_USER`: Your Grafana Cloud User ID.
    - `GRAFANA_PROM_API_KEY`: Your Grafana Cloud API Key.

3.  **Pipeline Update**:
    Update your `process_workdir.py` or similar build script to:
    - Instead of committing JSON files, call `POST /api/admin/sync-video` with the video metadata and `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.

## Local Development

```bash
npm install
vercel dev
```

The app will be available at `http://localhost:3000`.

## Files Updated

- `api/`: New serverless functions for all backend logic.
- `public/config.js`: Updated to point to `/api/*`.
- `public/app.js`: Refactored to use `fetch()` for auth and license.
- `public/observability.js`: Refactored to use Vercel metrics ingestion.
- `public/dashboard.js`: Refactored to fetch summary from DB.
- `public/sw.js`: Updated to bypass API routes.
