# OTT Web Application: Architecture & Code Flow

This document outlines the end-to-end flow of the premium OTT web application, detailing how assets are prepared, how the client authorizes users, and how secure playback is handled using Shaka Player and ClearKey DRM.

## 1. System Overview

The application follows a decoupled architecture where the frontend client is a static Progressive Web App (PWA) that consumes dynamic metadata and encrypted video streams from external origins (Cloudflare R2 and GitHub).

### Components Involved:
- **Python Packager (`run_package_upload.py`)**: Automates transcoding (FFmpeg), packaging (Shaka Packager), encryption, and upload to R2.
- **Web Frontend (`app.js`, `index.html`)**: A Netflix-inspired UI built with vanilla JS and glassmorphic CSS.
- **Shaka Player**: The core engine for DASH playback and DRM management.
- **Config Layers**: `config.js` (static), `keys.json` (encrypted license store), `mpd_mapping.json` (dynamic catalog).
- **Service Worker (`sw.js`)**: Handles offline shell caching and network-first metadata updates.

---

## 2. Media Preparation Pipeline

The packaging workflow converts raw video files into encrypted DASH streams ready for adaptive bitrate (ABR) streaming.

### A. Transcoding (FFmpeg)
Handled by `transcoder/transcode.py`.
- **Codec**: `libx264` (H.264) for maximum device compatibility.
- **Profile/Level**: `main` / `4.0`
- **GOP (Group of Pictures)**: `-x264-params "keyint=60:min-keyint=60:no-scenecut=1"`. Fixed GOP is mandatory for DASH so that segment boundaries align across different bitrates.
- **Rate Control**: Constrained VBR using `-b:v`, `-maxrate`, and `-bufsize` (CBR-like behavior for stable CDN delivery).
- **Audio**: `aac` at standard stereo bitrates.
- **Optimization**: `-movflags +faststart` to move metadata to the front of the file.

### B. Packaging (Shaka Packager)
Handled by `run_package_upload.py`.
- **Stream Template**: `v_$Number$.m4s` for video and `a_$Number$.m4s` for audio.
- **Manifest**: Generates a `.mpd` (DASH) file.
- **DRM Encryption**: 
    - `--enable_raw_key_encryption`: Enables ClearKey mode.
    - `--protection_scheme cenc`: Uses the Common Encryption standard.
    - `--keys key_id={ID}:key={KEY}`: Binds the video to the specific license keys found in `keys.json`.

---

## 3. Web Client Functionality (`app.js`)

The web client is an SPA (Single Page Application) that manages state and player lifecycle.

### Main Functions Explained:

#### `handleLogin(event)`
- Captures `email` and `userId` from the login form.
- Calls `authorize()` to validate.
- Saves the user session to `localStorage` under `OTT_SESSION`.

#### `authorize(email, userId)`
- Fetches `allowed_userids.json`.
- Implements **Hardcoded Admin Fallback** for `adminuser` to ensure access during maintenance.
- Returns an `ok` status to `handleLogin`.

#### `loadCatalog()`
- The "Source of Truth" orchestrator.
- Fetches `description.json` (metadata) and `mpd_mapping.json` (URLs).
- Merges them with `config.staticVideos`.
- Standardizes all IDs to **lowercase** to prevent lookup failures.
- Populates `state.catalogById` for O(1) video retrieval.

#### `buildRails()`
- Dynamically generates UI rows.
- **"Just Added"**: Filters all IDs in the catalog that are not in the static list.
- **"Recommended"**: Uses recent additions and reverse-chronological ordering.

#### `playVideo(video)`
- **DRM Setup**: Calls `getClearKey()` and applies the **Dual-Format ClearKey** config (Hex + Base64Url).
- **Player Init**: Uses `ensureShaka()` to create the instance if it doesn't exist.
- **Observability**: Triggers `window.OTT_OBS.onPlayIntent()` to track start time and quality.

#### `getClearKey(videoId)`
- Decrypts and searches the `state.keyStore`.
- Returns the specific `{key_id, key}` required to unlock the manifest.

---

## 4. Shaka Player & DRM (ClearKey)

The application uses **AES-128 CENC (Common Encryption)** with **ClearKey** for content protection.

### The Decryption Pipeline
Shaka Player requires the matching Key to be provided before it can decrypt the media segments.

1. **Key Fetching**: The app reads `keys.json`.
2. **Dual-Format Configuration**: To ensure compatibility across different browsers (Chrome, Android, Desktop), the app configures Shaka using a "Shotgun" approach in `playVideo()`:
   ```javascript
   player.configure({
     drm: {
       clearKeys: {
         // Hex format (often required by manifest KID match)
         "ed0102030405060708090a0b0c0d0e0f": "f0e0d0c0b0a090807060504030201000",
         // Base64Url format (Industry standard for EME)
         "7QECBAUGBwgJCgsMDQ4PDw": "8ODQwLCgoJCgkJCQkJCQkQ"
       }
     }
   });
   ```
3. **Loading**: `player.load(manifestUrl)` is called. Shaka matches the KID in the manifest against the provided `clearKeys` object and starts decryption.

---

## 5. Summary of Data Flow Table

| Action | Component | Data Source | Result |
| :--- | :--- | :--- | :--- |
| **Transcoding** | `transcode.py` | Raw MP4 | Multi-bitrate H.264 Renditions |
| **Packaging** | `run_package_upload.py` | Renditions | Encrypted DASH + R2 Upload |
| **Cataloging** | `mpd_mapping.json` | JSON File | Map of ID -> R2 Manifest URL |
| **Login** | `app.js` | `allowed_userids.json` | Authorized Session |
| **Browsing** | `buildRails()` | `catalogById` Map | Netflix-style Rows |
| **Playback** | `playVideo()` | `keys.json` | Decrypted Shaka Player Session |
