# VigilSiddhi OTT API Documentation

This document describes the backend endpoints available for the OTT platform. These are implemented as Vercel Serverless Functions.

## Base URL
`https://webott.prashantkadam.in/api`

---

## 🔐 Authentication

### POST `/auth/login`
Authenticates a user and sets a secure `httpOnly` session cookie.

**Request Body:**
```json
{
  "identifier": "user_id_or_email",
  "password": "your_password"
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

---

### GET `/auth/session`
Verifies the current session cookie and returns user metadata.

**Response (200 OK):**
```json
{
  "user": {
    "id": "uuid",
    "email": "...",
    "role": "admin|user",
    "display_name": "..."
  }
}
```

---

### POST `/auth/logout`
Revokes the current session and clears the cookie.

**Response (200 OK):**
```json
{
  "success": true
}
```

---

## 🎬 Catalog

### GET `/catalog`
Returns the full list of playable videos.

**Response (200 OK):**
```json
[
  {
    "id": "uuid",
    "slug": "angel_one",
    "title": "Angel One",
    "description": "...",
    "thumbnail": "...",
    "playable": true
  }
]
```

---

### GET `/catalog/rails`
Returns categorized rails (e.g., "Trending Now", "Sci-Fi") for the homepage.

**Response (200 OK):**
```json
[
  {
    "title": "🔥 Trending Now",
    "items": ["angel_one", "sintel", "tears_of_steel"]
  }
]
```

---

### GET `/videos/[slug]`
Returns detailed metadata for a specific video including its primary stream manifest.

**Response (200 OK):**
```json
{
  "id": "uuid",
  "title": "...",
  "mpdUrl": "https://ott.prashantkadam.in/video/manifest.mpd",
  "drmType": "clearkey",
  "isPlayable": true
}
```

---

## 🔑 Playback & DRM

### GET `/license/[slug]`
Retrieves ClearKey license keys for encrypted playback. Requires a valid session.

**Response (200 OK):**
```json
{
  "keys": [
    {
      "kid": "hex_key_id",
      "k": "hex_key"
    }
  ]
}
```

---

## 📊 Metrics & Observability

### POST `/metrics/ingest`
Receives client-side QoE metrics (buffering, bitrate, errors) and forwards them to Grafana Cloud.

**Request Body:**
```json
{
  "type": "playback_start",
  "data": {
    "videoId": "angel_one",
    "bitrate": 5000000,
    "latency": 150
  }
}
```

---

### GET `/dashboard/summary`
Returns a summary of CDN metrics and user activity for the admin dashboard. Requires `admin` role.

**Response (200 OK):**
```json
{
  "latestMetrics": [...],
  "activeUsers": 42,
  "timestamp": "2026-05-04T..."
}
```

---

## ⚙️ Administration & Automation

### POST `/admin/sync-video`
Syncs video metadata, streams, keys, and rail assignments from an external source.
**Requires:** `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`

**Request Body:**
```json
{
  "video": { "slug": "...", "title": "...", "thumbnail": "..." },
  "streams": [{ "manifest_url": "...", "drm_type": "clearkey" }],
  "keys": [{ "key_id_hex": "...", "key_hex": "..." }],
  "rails": [{ "rail_slug": "trending", "sort_order": 1 }]
}
```

---

### GET `/api/cron/cdn-metrics`
Scheduled task that collects Cloudflare CDN metrics and saves them to the DB. Usually triggered by Vercel Cron.
