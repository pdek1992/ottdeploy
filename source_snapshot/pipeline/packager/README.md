# 📦 Packager Module

## Overview
The Packager Module converts parallel-encoded MP4 files into a production-grade Cloudflare R2 structure. It generates CMAF-compliant fMP4 segments and a DASH manifest with **relative paths**, ensuring the content is ready for instant CDN delivery and caching.

## Dependencies
- **Shaka Packager**: Must be installed and accessible via CLI.
- **Python 3.x**: Orchestrates the packaging and ID management.

## Installation (Linux)
```bash
wget https://github.com/shaka-project/shaka-packager/releases/download/v3.4.1/packager-linux-x64 -O packager
chmod +x packager
sudo mv packager /usr/local/bin/
```

## Command Explanation
- **Relative Addressing**: The packager is configured to output segments using relative paths in the MPD. This allows the same files to be served via any CDN base URL (e.g., Cloudflare R2).
- **CENC AES-128**: Encrypts content using Common Encryption with ClearKey support.
- **Segment Alignment**: Uses EXACTLY 6-second segments (aligned with the transcoder's GOP).

## Input / Output Structure
- **Input**: `{video_id}_{rendition}.mp4` from `workdir/`.
- **Output Hierarchy (R2 Ready)**:
  ```text
  /output/video_id/
      /360p/
          video.mp4 (init)
          v_1.m4s, v_2.m4s...
      /720p/
          video.mp4 (init)
          v_1.m4s, v_2.m4s...
      manifest.mpd
  ```

## Code Flow
1. Accept `video_id` as a command-line argument.
2. Load encryption keys from local key store/config.
3. Map video/audio streams from parallel-transcoded files.
4. Generate segments in subdirectories relative to the manifest.
5. Create DASH MPD with `ContentProtection` elements for Android players.

## Configuration Options
- `segment_duration`: 6 seconds.
- `encryption`: CENC (ClearKey).
- `storage`: Configurable output directory.
